import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {access} from 'node:fs/promises';
const exec=promisify(execFile);
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2);let entry=path.join(root,'dist/entrypoints/inspector.js');
for(let i=0;i<args.length;i++){if(args[i]==='--entry'&&args[i+1])entry=path.resolve(args[++i]);else throw new Error(`Unsupported smoke argument: ${args[i]}`);}
try{
 await access(entry);
 let command,argv;
 if(process.platform==='win32'){command='powershell.exe';argv=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/smoke/conpty.ps1'),'-NodePath',process.execPath,'-EntryPath',entry];}
 else if(process.platform==='darwin'||process.platform==='linux'){command='python3';argv=['-B',path.join(root,'scripts/smoke/unix_pty.py'),process.execPath,entry];}
 else throw new Error(`Unsupported terminal platform ${process.platform}`);
 const {stdout,stderr}=await exec(command,argv,{cwd:root,timeout:22000,maxBuffer:2*1024*1024,windowsHide:true});
 if(stderr.trim())process.stderr.write(stderr);
 const result=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
 if(result.ok!==true||result.keyboard!==true||result.resize!==true||result.eof!==true||result.exitCode!==0||result.transport!==(process.platform==='win32'?'ConPTY':'PTY'))throw new Error('Incomplete real terminal evidence');
 console.log(JSON.stringify(result));
}catch(error){console.error(`terminal smoke failed: ${error.stderr?.trim()||error.message}`);process.exitCode=1;}
