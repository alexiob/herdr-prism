import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import type {ProcessSample,SampleBatch} from '../model/types.ts';
const wide=(x:unknown)=>typeof x==='string'&&/^\d+$/.test(x)&&x.length<=40;
export function validateBatch(x:unknown):SampleBatch {
 if(!x||typeof x!=='object')throw new Error('Invalid sampler response');const error=(x as {error?:unknown}).error;if(typeof error==='string')throw new Error(`metrics unavailable: ${error}`);const b=x as SampleBatch;
 if(b.version!==1||typeof b.platform!=='string'||typeof b.bootId!=='string'||!b.bootId||!Number.isFinite(b.sampledAt)||!wide(b.monotonicNs)||!Array.isArray(b.processes)||b.processes.length>200000||b.errors!==undefined&&(!Array.isArray(b.errors)||!b.errors.every(e=>typeof e==='string')))throw new Error('Invalid sampler batch');
 const ids=new Set<number>();for(const p of b.processes){if(!p||!Number.isSafeInteger(p.pid)||p.pid<1||ids.has(p.pid)||!wide(p.startTime)||!wide(p.cpuNs)||!wide(p.rssBytes)||typeof p.name!=='string'||p.name.length>1024||p.ppid!==undefined&&(!Number.isSafeInteger(p.ppid)||p.ppid<0)||p.uptimeMs!==undefined&&(!Number.isSafeInteger(p.uptimeMs)||p.uptimeMs<0)||p.availability!==undefined&&!['known','unavailable','partial'].includes(p.availability))throw new Error('Invalid sampler process');ids.add(p.pid);}return b;
}
/** Release artifacts are locally pinned. Explicit developer helper paths are trusted by the caller. */
export async function verifyHelperArtifact(path:string,platform=process.platform,arch=process.arch):Promise<void>{
 const manifestText=await readFile(join(dirname(path),'sha256.json'),'utf8');if(manifestText.length>16384)throw new Error('Invalid sampler manifest');const x=JSON.parse(manifestText) as Record<string,unknown>;
 if(x.version!==1||x.platform!==platform||x.arch!==arch||x.filename!==basename(path)||typeof x.sha256!=='string'||!/^[a-f0-9]{64}$/.test(x.sha256))throw new Error('Invalid sampler manifest');
 const hash=createHash('sha256').update(await readFile(path)).digest('hex');if(hash!==x.sha256)throw new Error('Sampler checksum mismatch');
}
export class NativeSampler {
 private child?:ChildProcessWithoutNullStreams;private buffer='';private closed=false;private failed?:Error;private pending?:{resolve:(b:SampleBatch)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout};private running?:Promise<SampleBatch>;
 private helperPath:string;private timeoutMs:number;private verifyPackaged:boolean;private helperArgs:string[];
 constructor(helperPath?:string,timeoutMs=5000,helperArgs:string[]=[]){this.helperArgs=[...helperArgs];this.verifyPackaged=helperPath===undefined;this.helperPath=helperPath??fileURLToPath(new URL(`../../bin/${process.platform}-${process.arch}/hat-sampler${process.platform==='win32'?'.exe':''}`,import.meta.url));this.timeoutMs=timeoutMs;}
 private async start(){if(this.child)return;if(this.verifyPackaged){try{await verifyHelperArtifact(this.helperPath);}catch(error){throw new Error(`metrics unavailable: sampler artifact (${String(error)})`);}}if(this.closed)throw new Error('sampler closed');const child=spawn(this.helperPath,this.helperArgs,{stdio:'pipe',windowsHide:true,detached:false});this.child=child;
  child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{this.buffer+=chunk;if(this.buffer.length>32*1024*1024){this.fail(new Error('Sampler response too large'));child.kill();return;}let pos:number;while((pos=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,pos);this.buffer=this.buffer.slice(pos+1);try{const batch=validateBatch(JSON.parse(line));if(!this.pending){this.fail(new Error('Unsolicited sampler response'));child.kill();return;}clearTimeout(this.pending.timer);this.pending.resolve(batch);this.pending=undefined;}catch(e){this.fail(e as Error);child.kill();}}});
  child.stderr.resume();child.on('error',e=>this.fail(new Error(`metrics unavailable: sampler missing or failed (${e.message})`)));child.on('exit',()=>{if(!this.closed)this.fail(new Error('Sampler exited'));});child.stdin.on('error',e=>this.fail(e));
 }
 private fail(e:Error){this.failed=e;if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(e);this.pending=undefined;}}
 sample():Promise<SampleBatch>{if(this.closed)return Promise.reject(new Error('sampler closed'));if(this.failed)return Promise.reject(this.failed);if(this.running)return this.running;
 this.running=(async()=>{await this.start();if(this.closed)throw new Error('sampler closed');if(this.failed)throw this.failed;return await new Promise<SampleBatch>((resolve,reject)=>{const timer=setTimeout(()=>{this.fail(new Error('Sampler timeout'));this.child?.kill();},Math.max(1000,this.timeoutMs));this.pending={resolve,reject,timer};this.child!.stdin.write('sample\n');});})().catch(error=>{this.fail(error as Error);throw error;}).finally(()=>{this.running=undefined;});return this.running;}

 async close():Promise<void>{if(this.closed)return;this.closed=true;this.fail(new Error('sampler closed'));const c=this.child;if(!c||c.exitCode!==null)return;await new Promise<void>(resolve=>{let force:NodeJS.Timeout|undefined;const timer=setTimeout(()=>{c.kill();force=setTimeout(()=>c.kill('SIGKILL'),1000);},1000);const done=()=>{clearTimeout(timer);if(force)clearTimeout(force);resolve();};c.once('exit',done);c.once('error',done);c.stdin.end();});}
}
