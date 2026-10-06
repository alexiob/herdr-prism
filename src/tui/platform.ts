import{spawn}from'node:child_process';
import path from'node:path';
function command(program:string,args:string[],input?:string):Promise<void>{return new Promise((resolve,reject)=>{const child=spawn(program,args,{stdio:[input===undefined?'ignore':'pipe','ignore','pipe'],windowsHide:true});let errorText='';const timer=setTimeout(()=>child.kill(),5000);child.stderr?.on('data',v=>{if(errorText.length<4096)errorText+=v;});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(errorText.trim()||`${program} exited ${code}`));});if(input!==undefined)child.stdin?.end(input);});}
/** Herdr forwards child OSC 52 writes to the foreground viewing client, including over SSH. */
export function clipboardSequence(text:string):string {
 if(Buffer.byteLength(text)>1024*1024)throw new Error('Clipboard size limit exceeded');
 return '\x1b]52;c;'+Buffer.from(text,'utf8').toString('base64')+'\x07';
}
export async function copyText(text:string):Promise<void>{
 if(process.env.HERDR_ENV==='1'&&process.stdout.isTTY)return new Promise((resolve,reject)=>process.stdout.write(clipboardSequence(text),error=>error?reject(error):resolve()));
 if(process.platform==='darwin')return command('pbcopy',[],text);
 if(process.platform==='win32')return command('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','$text=[Console]::In.ReadToEnd(); Set-Clipboard -Value $text'],text);
 for(const[program,args]of [['wl-copy',[]],['xclip',['-selection','clipboard']],['xsel',['--clipboard','--input']]]as[string,string[]][]){try{await command(program,args,text);return;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 throw new Error('Clipboard unavailable: install wl-copy, xclip or xsel');
}
export async function openTarget(target:string):Promise<void>{if(/[\x00-\x1f\x7f]/.test(target))throw new Error('Unsafe reference target');if(/^[a-z][a-z\d+.-]*:/i.test(target)&&!/^[A-Za-z]:[\\/]/.test(target)){const url=new URL(target);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Unsupported URL scheme');}else if(!path.isAbsolute(target)&&!path.win32.isAbsolute(target))throw new Error('Reference must be an absolute path');
 if(process.platform==='darwin')return command('open',['--',target]);
 if(process.platform==='win32')return new Promise((resolve,reject)=>{const script='Start-Process -FilePath $env:HAT_OPEN_TARGET';const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,HAT_OPEN_TARGET:target},stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Windows default open failed')));});
 return command('xdg-open',[target]);
}
