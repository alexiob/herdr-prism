import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Diagnostic only: every child is created suspended, assigned to our kill-on-close
// job, then resumed. Capability files and counts replace arbitrary terminal output.
if(process.platform!=='win32')throw Error('This diagnostic requires actual Windows');
const exec=promisify(execFile),output=path.resolve('artifacts/windows-diagnostics');
await mkdir(output,{recursive:true});
const directory=await mkdtemp(path.join(tmpdir(),'prism-conpty-diagnostic-'));
const probe=fileURLToPath(new URL('./console-probe.mjs',import.meta.url));
const native=String.raw`param([string]$NodePath,[string]$ProbePath,[string]$ReportPath,[string]$Variant)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class PrismConsoleDiagnostic {
 [StructLayout(LayoutKind.Sequential)] struct Coord {public short X,Y;public Coord(short x,short y){X=x;Y=y;}}
 [StructLayout(LayoutKind.Sequential)] struct StartupInfo {public uint cb;public IntPtr reserved,desktop,title;public uint x,y,xSize,ySize,xChars,yChars,fill,flags;public ushort show,reserved2;public IntPtr reservedPtr,input,output,error;}
 [StructLayout(LayoutKind.Sequential)] struct StartupInfoEx {public StartupInfo startup;public IntPtr attributes;}
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr process,thread;public uint pid,tid;}
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,IntPtr attr,uint size);
 [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(Coord size,IntPtr input,IntPtr output,uint flags,out IntPtr console);
 [DllImport("kernel32.dll")] static extern int ResizePseudoConsole(IntPtr console,Coord size);
 [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr console);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attr,IntPtr value,IntPtr size,IntPtr prev,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupInfoEx startup,out ProcessInfo info);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool ReadFile(IntPtr file,byte[] data,uint size,out uint read,IntPtr overlapped);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool WriteFile(IntPtr file,byte[] data,uint size,out uint written,IntPtr overlapped);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attr,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,IntPtr info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetStdHandle(int kind,IntPtr handle);
 [DllImport("kernel32.dll")] static extern uint GetFileType(IntPtr handle);
 static void Check(bool ok,string label){if(!ok)throw new Exception(label+" win32="+Marshal.GetLastWin32Error());}
 static void HR(int value,string label){if(value<0)throw new Exception(label+" hresult="+value);}
 static string Quote(string value){var b=new StringBuilder("\"");int n=0;foreach(char c in value){if(c=='\\'){n++;continue;}if(c=='\"'){b.Append('\\',n*2+1);b.Append(c);}else{b.Append('\\',n);b.Append(c);}n=0;}b.Append('\\',n*2);b.Append('\"');return b.ToString();}
 static void Close(ref IntPtr h){if(h!=IntPtr.Zero){CloseHandle(h);h=IntPtr.Zero;}}
 static void Send(IntPtr h,string s){var b=Encoding.UTF8.GetBytes(s);uint n;Check(WriteFile(h,b,(uint)b.Length,out n,IntPtr.Zero)&&n==b.Length,"input write");}
 public static string Run(string node,string probe,string report,string variant){
  IntPtr ir=IntPtr.Zero,iw=IntPtr.Zero,or=IntPtr.Zero,ow=IntPtr.Zero,console=IntPtr.Zero,attrs=IntPtr.Zero,job=IntPtr.Zero;var child=new ProcessInfo();Thread reader=null;bool initialized=false,eof=false,exitObserved=false;int count=0,readError=0;uint exit=259;string failure=null;
  IntPtr oldIn=GetStdHandle(-10),oldOut=GetStdHandle(-11),oldErr=GetStdHandle(-12);uint inType=GetFileType(oldIn),outType=GetFileType(oldOut),errType=GetFileType(oldErr);
  bool cleared=false;
  try{
   if(IntPtr.Size!=8)throw new Exception("requires x64");
   Check(CreatePipe(out ir,out iw,IntPtr.Zero,0),"input pipe");Check(CreatePipe(out or,out ow,IntPtr.Zero,0),"output pipe");HR(CreatePseudoConsole(new Coord(80,24),ir,ow,0,out console),"create console");
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);attrs=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(attrs,1,0,ref size),"attributes");initialized=true;Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x20016),console,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"console attribute");
   job=CreateJobObjectW(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"owned job");var limits=Marshal.AllocHGlobal(144);try{Marshal.Copy(new byte[144],0,limits,144);Marshal.WriteInt32(limits,16,0x2000);Check(SetInformationJobObject(job,9,limits,144),"job limits");}finally{Marshal.FreeHGlobal(limits);}
   var si=new StartupInfoEx();si.startup.cb=(uint)Marshal.SizeOf(typeof(StartupInfoEx));si.attributes=attrs;
   if(variant.EndsWith("Null"))si.startup.flags=0x100;
   if(variant=="directInvalid"){si.startup.flags=0x100;si.startup.input=si.startup.output=si.startup.error=new IntPtr(-1);}
   if(variant=="directClearParent"){cleared=true;Check(SetStdHandle(-10,IntPtr.Zero)&&SetStdHandle(-11,IntPtr.Zero)&&SetStdHandle(-12,IntPtr.Zero),"clear own host std slots");}
   bool wrapper=variant.StartsWith("cmd");string app=wrapper?Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"cmd.exe"):node;
   string command=wrapper?Quote(app)+" /d /s /c \""+Quote(node)+" "+Quote(probe)+" "+Quote(report)+"\"":Quote(node)+" "+Quote(probe)+" "+Quote(report);
   Check(CreateProcessW(app,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x80004,IntPtr.Zero,null,ref si,out child),"create child");
   if(cleared){SetStdHandle(-10,oldIn);SetStdHandle(-11,oldOut);SetStdHandle(-12,oldErr);cleared=false;}
   Check(AssignProcessToJobObject(job,child.process),"assign owned job");Close(ref ir);Close(ref ow);IntPtr rh=or;
   reader=new Thread(delegate(){var b=new byte[4096];for(;;){uint n;if(!ReadFile(rh,b,(uint)b.Length,out n,IntPtr.Zero)){int code=Marshal.GetLastWin32Error();if(code!=109&&code!=232)Interlocked.Exchange(ref readError,code);break;}if(n==0)break;if(Interlocked.Add(ref count,(int)n)>65536){Interlocked.Exchange(ref readError,-1);break;}}eof=true;});reader.IsBackground=true;reader.Start();Check(ResumeThread(child.thread)!=UInt32.MaxValue,"resume child");
   for(int i=0;i<100&&!File.Exists(report)&&WaitForSingleObject(child.process,0)!=0;i++)Thread.Sleep(30);
   if(WaitForSingleObject(child.process,0)!=0){Send(iw,"\x1b[B");Thread.Sleep(300);HR(ResizePseudoConsole(console,new Coord(26,12)),"resize narrow");Thread.Sleep(500);HR(ResizePseudoConsole(console,new Coord(80,24)),"resize wide");Thread.Sleep(500);Send(iw,"q");}
   exitObserved=WaitForSingleObject(child.process,3000)==0;Check(GetExitCodeProcess(child.process,out exit),"exit status");
  }catch(Exception error){failure=error.Message;}finally{
   if(cleared){SetStdHandle(-10,oldIn);SetStdHandle(-11,oldOut);SetStdHandle(-12,oldErr);}
   if(child.process!=IntPtr.Zero&&WaitForSingleObject(child.process,0)!=0){TerminateProcess(child.process,1);WaitForSingleObject(child.process,3000);}Close(ref job);Close(ref iw);Close(ref ir);Close(ref ow);if(console!=IntPtr.Zero){ClosePseudoConsole(console);console=IntPtr.Zero;}if(reader!=null)reader.Join(3000);Close(ref or);Close(ref child.thread);Close(ref child.process);if(initialized)DeleteProcThreadAttributeList(attrs);if(attrs!=IntPtr.Zero)Marshal.FreeHGlobal(attrs);
  }
  return "{\"variant\":\""+variant+"\",\"startupBytes\":"+Marshal.SizeOf(typeof(StartupInfoEx))+",\"hostHandleTypes\":["+inType+","+outType+","+errType+"],\"childPid\":"+child.pid+",\"exitObserved\":"+exitObserved.ToString().ToLower()+",\"exitCode\":"+exit+",\"capturedBytes\":"+count+",\"eof\":"+eof.ToString().ToLower()+",\"readError\":"+readError+",\"nativeError\":"+(failure==null?"null":"\""+failure+"\"")+"}";
 }
}
'@
try{[PrismConsoleDiagnostic]::Run($NodePath,$ProbePath,$ReportPath,$Variant)}catch{[Console]::Error.WriteLine('Diagnostic native invocation failed');exit 1}
`;
const script=path.join(directory,'probe.ps1');
const evidence={kind:'actual-Windows-ConPTY-launch-diagnostic',platform:process.platform,arch:process.arch,node:process.version,variants:[]};
try{
 await writeFile(script,native);
 for(const variant of ['directDefault','directNull','directInvalid','directClearParent','cmdDefault','cmdNull']){
  const report=path.join(directory,variant+'.json');let result={variant};
  try{const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-NodePath',process.execPath,'-ProbePath',probe,'-ReportPath',report,'-Variant',variant],{timeout:18000,maxBuffer:1024*1024,windowsHide:true});result=JSON.parse(stdout.trim());}catch(error){result.launcherError=String(error.code??'unknown');result.compilerCodes=[...new Set(String(error.stderr??'').match(/\bCS\d{4}\b/g)??[])];}
  try{result.console=JSON.parse(await readFile(report,'utf8'));}catch(error){result.consoleReportMissing=error.code??'invalid-report';}
  for(const [label,pid]of [['launcherChildReaped',result.childPid],['consoleChildReaped',result.console?.pid]])if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);result[label]=false;}catch(error){result[label]=error.code==='ESRCH';}}
  result.interactive=result.exitCode===0&&result.exitObserved===true&&result.eof===true&&result.readError===0&&result.launcherChildReaped===true&&result.consoleChildReaped===true&&result.console?.rawEnabled===true&&result.console?.rawRestored===true&&result.console?.down===true&&result.console?.resizes?.some(size=>size[0]===26&&size[1]===12)&&result.console?.resizes?.some(size=>size[0]===80&&size[1]===24);
  evidence.variants.push(result);
 }
}finally{await rm(directory,{recursive:true,force:true});await writeFile(path.join(output,'conpty.json'),JSON.stringify(evidence,null,2)+'\n');}
console.log(JSON.stringify(evidence,null,2));
