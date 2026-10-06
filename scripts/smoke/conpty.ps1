param([Parameter(Mandatory=$true)][string]$NodePath, [Parameter(Mandatory=$true)][string]$EntryPath)
$ErrorActionPreference = 'Stop'
# Fixed native declarations and control flow. Paths are passed as data to CreateProcessW, never evaluated.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class HatConPtySmoke {
 [StructLayout(LayoutKind.Sequential)] struct Coord { public short X,Y; public Coord(short x,short y){X=x;Y=y;} }
 [StructLayout(LayoutKind.Sequential)] struct StartupInfo {
  public uint cb; public IntPtr reserved,desktop,title;
  public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
  public ushort show,reserved2; public IntPtr reservedPtr,input,output,error;
 }
 [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx {public StartupInfo startup;public IntPtr attributes;}
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr process,thread;public uint pid,tid;}
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,IntPtr attributes,uint size);
 [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(Coord size,IntPtr input,IntPtr output,uint flags,out IntPtr console);
 [DllImport("kernel32.dll")] static extern int ResizePseudoConsole(IntPtr console,Coord size);
 [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr console);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupInfoEx startup,out ProcessInfo info);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadFile(IntPtr file,byte[] data,uint size,out uint read,IntPtr overlapped);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool WriteFile(IntPtr file,byte[] data,uint size,out uint written,IntPtr overlapped);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,IntPtr info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 sealed class Capture {
  public readonly object Gate=new object(); public readonly List<byte> Bytes=new List<byte>();public bool Eof;public string Error;
  public string Text(){lock(Gate){return Encoding.UTF8.GetString(Bytes.ToArray());}}
  public int Count(){lock(Gate){return Bytes.Count;}}
 }
 static void Check(bool value,string label){if(!value)throw new Win32Exception(Marshal.GetLastWin32Error(),label);}
 static void HResult(int value,string label){if(value<0)throw new Exception(label+" unavailable HRESULT "+value);}
 static string Quote(string value){var b=new StringBuilder("\"");int backslashes=0;foreach(char c in value){if(c=='\\'){backslashes++;continue;}if(c=='"'){b.Append('\\',backslashes*2+1);b.Append(c);}else{b.Append('\\',backslashes);b.Append(c);}backslashes=0;}b.Append('\\',backslashes*2);b.Append('"');return b.ToString();}
 static void Send(IntPtr input,string text){byte[] bytes=Encoding.UTF8.GetBytes(text);uint written;Check(WriteFile(input,bytes,(uint)bytes.Length,out written,IntPtr.Zero),"ConPTY input");if(written!=bytes.Length)throw new Exception("ConPTY partial input write");}
 static void Expect(Capture capture,Func<string,bool> predicate,string label,int timeout=3000){var timer=Stopwatch.StartNew();while(timer.ElapsedMilliseconds<timeout){string text=capture.Text();if(predicate(text))return;lock(capture.Gate){if(capture.Error!=null)throw new Exception(capture.Error);if(capture.Eof)throw new Exception("interactive ConPTY ended before "+label);}Thread.Sleep(20);}throw new Exception("ConPTY timeout waiting for "+label);}
 static void Close(ref IntPtr handle){if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;}}
 static bool Capability(string report,string name){if(!File.Exists(report))return false;string json=File.ReadAllText(report);if(json.Length>4096)throw new Exception("ConPTY capability report exceeded bound");return json.Contains("\""+name+"\":true");}
 public static string Run(string node,string entry,string bootstrap){
  IntPtr inputRead=IntPtr.Zero,inputWrite=IntPtr.Zero,outputRead=IntPtr.Zero,outputWrite=IntPtr.Zero,console=IntPtr.Zero,attributes=IntPtr.Zero,job=IntPtr.Zero;
  var process=new ProcessInfo();Thread reader=null;var capture=new Capture();bool attrInitialized=false;
  string reportDirectory=Path.Combine(Path.GetTempPath(),"prism-conpty-smoke-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(reportDirectory);string report=Path.Combine(reportDirectory,"capabilities.json");
  try{
   if(IntPtr.Size!=8)throw new Exception("ConPTY smoke requires the supported Windows x64 host");
   Check(CreatePipe(out inputRead,out inputWrite,IntPtr.Zero,0),"ConPTY input pipe");Check(CreatePipe(out outputRead,out outputWrite,IntPtr.Zero,0),"ConPTY output pipe");
   HResult(CreatePseudoConsole(new Coord(80,24),inputRead,outputWrite,0,out console),"CreatePseudoConsole");
   IntPtr needed=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref needed);if(needed==IntPtr.Zero)throw new Exception("ConPTY startup attributes unavailable");
   attributes=Marshal.AllocHGlobal(needed);Check(InitializeProcThreadAttributeList(attributes,1,0,ref needed),"ConPTY attributes initialization");attrInitialized=true;
   Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20016),console,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"ConPTY process attribute");
   job=CreateJobObjectW(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"Owned smoke job");
   IntPtr limits=Marshal.AllocHGlobal(144);try{Marshal.Copy(new byte[144],0,limits,144);Marshal.WriteInt32(limits,16,0x2000);Check(SetInformationJobObject(job,9,limits,144),"Owned job kill-on-close");}finally{Marshal.FreeHGlobal(limits);}
   var startup=new StartupInfoEx();startup.startup.cb=(uint)Marshal.SizeOf(typeof(StartupInfoEx));startup.attributes=attributes;
   // ConPTY fills NULL standard slots with console handles. Explicitly request these slots:
   // otherwise the redirected PowerShell host's standard pipes can survive console attachment.
   // This is the Microsoft/node-pty ConPTY launch pattern; transport pipes are NOT child stdio.
   startup.startup.flags=0x100; // STARTF_USESTDHANDLES
   startup.startup.input=IntPtr.Zero;startup.startup.output=IntPtr.Zero;startup.startup.error=IntPtr.Zero;
   var command=new StringBuilder(Quote(node)+" "+Quote(bootstrap)+" "+Quote(report)+" "+Quote(entry)+" --demo --ascii --monochrome");
   // Start suspended so teardown ownership is installed before any child code can execute.
   Check(CreateProcessW(node,command,IntPtr.Zero,IntPtr.Zero,false,0x80004,IntPtr.Zero,null,ref startup,out process),"CreateProcessW attached to ConPTY");
   Check(AssignProcessToJobObject(job,process.process),"Assign owned ConPTY process job");
   Close(ref inputRead);Close(ref outputWrite);
   IntPtr readHandle=outputRead;
   reader=new Thread(delegate(){try{var bytes=new byte[8192];for(;;){uint count;bool ok=ReadFile(readHandle,bytes,(uint)bytes.Length,out count,IntPtr.Zero);if(!ok){int code=Marshal.GetLastWin32Error();if(code!=109&&code!=232)throw new Win32Exception(code,"ConPTY read");break;}if(count==0)break;lock(capture.Gate){for(int i=0;i<count;i++)capture.Bytes.Add(bytes[i]);if(capture.Bytes.Count>1048576)throw new Exception("ConPTY output exceeded bounded capture");}}lock(capture.Gate){capture.Eof=true;}}catch(Exception error){lock(capture.Gate){capture.Error=error.Message;capture.Eof=true;}}});reader.IsBackground=true;reader.Start();
   if(ResumeThread(process.thread)==UInt32.MaxValue)throw new Win32Exception(Marshal.GetLastWin32Error(),"Resume ConPTY child");
   // System ConPTY may consume 1049 h/l and emit reconstructed screen content.
   // Entry/exit are verified through actual buffer restoration below, not passthrough.
   Expect(capture,s=>s.Contains("[Overview]"),"interactive ConPTY Overview");Thread.Sleep(150);
   foreach(string name in new[]{"stdinTTY","stdoutTTY","stderrTTY","rawEnabled"})if(!Capability(report,name))throw new Exception("ConPTY missing measured capability "+name);
   int at=capture.Text().Length;Send(inputWrite,"\t");Expect(capture,s=>s.Substring(Math.Min(at,s.Length)).Contains("[Agents]"),"Tab changing Agents view");Thread.Sleep(150);
   at=capture.Text().Length;Send(inputWrite,"\x1b[B");Expect(capture,s=>s.Length>at,"Down arrow changing selection");Thread.Sleep(150);
   at=capture.Text().Length;Send(inputWrite,"\x1b[A");Expect(capture,s=>s.Length>at,"Up arrow changing selection");Thread.Sleep(150);
   at=capture.Text().Length;HResult(ResizePseudoConsole(console,new Coord(26,12)),"ResizePseudoConsole narrow");Expect(capture,s=>s.Substring(Math.Min(at,s.Length)).Contains("[Agents]"),"80x24 to 26x12 resize repaint");Thread.Sleep(150);
   at=capture.Text().Length;HResult(ResizePseudoConsole(console,new Coord(80,24)),"ResizePseudoConsole wide");Expect(capture,s=>s.Substring(Math.Min(at,s.Length)).Contains("[Agents]"),"26x12 to 80x24 resize repaint");Thread.Sleep(150);
   at=capture.Text().Length;Send(inputWrite,"q");Expect(capture,s=>s.Substring(Math.Min(at,s.Length)).Contains("PRISM_SAVED_SCREEN"),"saved original-screen restoration on quit");
   if(WaitForSingleObject(process.process,3000)!=0)throw new Exception("ConPTY child did not terminate on quit capabilities="+(File.Exists(report)?File.ReadAllText(report):"missing"));uint exit;Check(GetExitCodeProcess(process.process,out exit),"ConPTY exit status");if(exit!=0)throw new Exception("ConPTY child exit "+exit);
   if(!Capability(report,"rawRestored"))throw new Exception("ConPTY raw mode was not restored on clean exit");
   if(!Capability(report,"stdinDestroyed"))throw new Exception("Owned ConPTY input stream was not closed on quit");
   Close(ref inputWrite);ClosePseudoConsole(console);console=IntPtr.Zero;
   if(!reader.Join(3000))throw new Exception("ConPTY output did not reach EOF after owned console closed");lock(capture.Gate){if(!capture.Eof||capture.Error!=null)throw new Exception(capture.Error??"ConPTY EOF missing");}
   return "{\"ok\":true,\"transport\":\"ConPTY\",\"keyboard\":true,\"resize\":true,\"exitCode\":0,\"eof\":true,\"screenRestored\":true,\"rawRestored\":true,\"alternateEnterForwarded\":"+capture.Text().Contains("\x1b[?1049h").ToString().ToLower()+",\"alternateExitForwarded\":"+capture.Text().Contains("\x1b[?1049l").ToString().ToLower()+",\"sizes\":[[80,24],[26,12],[80,24]],\"capturedBytes\":"+capture.Count()+",\"consoleCapabilities\":"+File.ReadAllText(report)+"}";
  }catch(Exception error){
   // Only expose the fixture's capability marker, never arbitrary captured terminal content.
   var diagnostic=System.Text.RegularExpressions.Regex.Match(capture.Text(),@"SMOKE_CONSOLE [^\r\n\x1b]{1,200}");
   string facts=" capturedBytes="+capture.Count()+" overviewSeen="+capture.Text().Contains("[Overview]").ToString().ToLower()+" alternateEnterForwarded="+capture.Text().Contains("\x1b[?1049h").ToString().ToLower();
   throw new Exception(error.Message+(diagnostic.Success?" "+diagnostic.Value:"")+facts+" childPid="+process.pid);
  }finally{
   if(process.process!=IntPtr.Zero&&WaitForSingleObject(process.process,0)!=0){TerminateProcess(process.process,1);WaitForSingleObject(process.process,3000);}
   Close(ref inputWrite);Close(ref inputRead);Close(ref outputWrite);
   if(console!=IntPtr.Zero){ClosePseudoConsole(console);console=IntPtr.Zero;}
   if(reader!=null)reader.Join(3000);Close(ref outputRead);Close(ref process.thread);Close(ref process.process);Close(ref job);
   if(attrInitialized)DeleteProcThreadAttributeList(attributes);if(attributes!=IntPtr.Zero)Marshal.FreeHGlobal(attributes);
   Directory.Delete(reportDirectory,true);
  }
 }
}
'@
try { [HatConPtySmoke]::Run($NodePath,$EntryPath,(Join-Path $PSScriptRoot 'conpty-bootstrap.mjs')) } catch { [Console]::Error.WriteLine('ConPTY smoke unavailable or failed: ' + $_.Exception.Message); exit 1 }
