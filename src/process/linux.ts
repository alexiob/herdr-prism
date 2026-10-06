import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {ProcessSample,SampleBatch} from '../model/types.ts';
const exec=promisify(execFile);
export interface LinuxOptions {procRoot?:string;clockTicks?:number;pageSize?:number;}
export function parseStat(text:string,hz:number,pageSize:number,uptimeNs?:bigint):ProcessSample {
 const end=text.lastIndexOf(')'),start=text.indexOf('(');if(start<0||end<start)throw new Error('Malformed proc stat');const pid=Number(text.slice(0,start).trim()),f=text.slice(end+2).trim().split(/\s+/);if(f.length<22||!Number.isSafeInteger(pid)||pid<1)throw new Error('Malformed proc stat');
 const startTime=BigInt(f[19]!);const elapsed=uptimeNs===undefined?undefined:uptimeNs-startTime*1000000000n/BigInt(hz);const ms=elapsed!==undefined&&elapsed>=0n?elapsed/1000000n:undefined;
 return {uptimeMs:ms!==undefined&&ms<=BigInt(Number.MAX_SAFE_INTEGER)?Number(ms):undefined,pid,ppid:Number(f[1]),name:text.slice(start+1,end),startTime:BigInt(f[19]!).toString(),cpuNs:((BigInt(f[11]!)+BigInt(f[12]!))*1000000000n/BigInt(hz)).toString(),rssBytes:(BigInt(f[21]!)<0n?0n:BigInt(f[21]!)*BigInt(pageSize)).toString(),threads:Number(f[17]),availability:'known'};
}
export class LinuxSampler {
 private closed=false;private constants?:Promise<[number,number]>;
 private options:LinuxOptions; constructor(options:LinuxOptions={}){this.options=options;}
 async sample():Promise<SampleBatch>{if(this.closed)throw new Error('sampler closed');const root=this.options.procRoot??'/proc';
  this.constants??=Promise.all([this.options.clockTicks??exec('getconf',['CLK_TCK'],{timeout:2000}).then(x=>Number(x.stdout.trim())),this.options.pageSize??exec('getconf',['PAGESIZE'],{timeout:2000}).then(x=>Number(x.stdout.trim()))]);
  const [hz,pages]=await this.constants;if(!Number.isInteger(hz)||hz<=0||!Number.isInteger(pages)||pages<=0)throw new Error('OS clock/page units unavailable');
  const bootId=(await readFile(join(root,'sys/kernel/random/boot_id'),'utf8')).trim();const entries=(await readdir(root)).filter(x=>/^\d+$/.test(x));const processes:ProcessSample[]=[],errors:string[]=[];
  let uptimeNs:bigint|undefined;try{const text=await readFile(join(root,'uptime'),'utf8');const m=/^(\d+)(?:\.(\d+))?/.exec(text);if(m)uptimeNs=BigInt(m[1])*1000000000n+BigInt((m[2]??'').slice(0,9).padEnd(9,'0'));}catch{/* Uptime remains unavailable while resource sampling can continue. */}
  // Bounded batches avoid one pending file operation per host process.
  for(let offset=0;offset<entries.length;offset+=32)await Promise.all(entries.slice(offset,offset+32).map(async id=>{try{processes.push(parseStat(await readFile(join(root,id,'stat'),'utf8'),hz,pages,uptimeNs));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')errors.push(`pid ${id}: ${(error as NodeJS.ErrnoException).code??'invalid stat'}`);}}));
  return {version:1,platform:'linux',bootId,sampledAt:Date.now(),monotonicNs:process.hrtime.bigint().toString(),processes:processes.sort((a,b)=>a.pid-b.pid),errors};
 }
 async close():Promise<void>{this.closed=true;}
}
