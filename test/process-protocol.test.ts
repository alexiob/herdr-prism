import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createSampler} from '../src/process/sampler.ts';
const helper=resolve(process.env.HAT_NATIVE_HELPER??'native/sampler/target/debug/hat-sampler');const hasHelper=await access(helper).then(()=>true,()=>false);
test('JSONL helper sample requests are coalesced and fragmented wide data validates',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hat-helper-'));const file=join(dir,'helper with spaces.cjs');
 try {await writeFile(file,`#!${process.execPath}\nconst rl=require('node:readline').createInterface({input:process.stdin});let count=0;rl.on('line',()=>{const b={version:1,platform:'darwin',bootId:'real-fixture',monotonicNs:'1',sampledAt:1,processes:[{pid:12,name:'worker',cpuNs:'9007199254740993123',rssBytes:'12288',startTime:'9007199254740993124'}]};const text=JSON.stringify(b)+'\\n';process.stdout.write(text.slice(0,30));setTimeout(()=>process.stdout.write(text.slice(30)),10);});rl.on('close',()=>process.exit(0));\n`);await chmod(file,0o700);
 const s=createSampler({platform:'darwin',helperPath:process.execPath,helperArgs:[file]});try{const a=s.sample(),b=s.sample();assert.equal(a,b);assert.equal((await a).processes[0]?.cpuNs,'9007199254740993123');await s.close();await assert.rejects(s.sample(),/closed/);}finally{await s.close();}
 }finally{await rm(dir,{force:true,recursive:true});}
});
test('malformed JSON from a supervised helper fails boundedly and shuts down',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hat-helper-bad-'));const file=join(dir,'helper.cjs');
 try {await writeFile(file,`#!${process.execPath}\nprocess.stdin.once('data',()=>process.stdout.write('{bad}\\n'));setInterval(()=>{},1000);\n`);await chmod(file,0o700);const s=createSampler({platform:'darwin',helperPath:process.execPath,helperArgs:[file]});try{await assert.rejects(s.sample(),/JSON|position|property/i);}finally{await s.close();}}finally{await rm(dir,{recursive:true,force:true});}
});
test('native helper receives EOF and exits when its foreground owner dies',{skip:!hasHelper,timeout:5000},async()=>{
 const script=`const {spawn}=require('node:child_process');const c=spawn(${JSON.stringify(helper)},[],{stdio:['pipe','ignore','ignore']});console.log(c.pid);setInterval(()=>{},1000);`;
 const parent=spawn(process.execPath,['-e',script],{stdio:['ignore','pipe','pipe']});const [data]=await once(parent.stdout!,'data');const pid=Number(String(data).trim());assert.ok(pid>0);const parentExit=once(parent,'exit');parent.kill('SIGKILL');await parentExit;
 let alive=true;for(let i=0;i<40;i++){try{process.kill(pid,0);}catch{alive=false;break;}await delay(25);}assert.equal(alive,false,'owned helper must exit after foreground death');
});
