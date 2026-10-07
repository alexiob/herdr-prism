import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createSampler} from '../src/process/sampler.ts';
import {validateBatch} from '../src/process/native-helper.ts';
import {ProcessTracker} from '../src/process/ownership.ts';
const helper=process.env.HAT_NATIVE_HELPER??'native/sampler/target/debug/hat-sampler';
const hasHelper=process.env.HAT_REQUIRE_NATIVE==='1'||await access(helper).then(()=>true,()=>false);
test('native boundary rejects rounded identities, protocol mismatch and duplicate pids',()=>{
 const p={pid:1,name:'x',startTime:'9007199254740993',cpuNs:'1',rssBytes:'2'};const b={version:1,platform:'darwin',bootId:'boot',monotonicNs:'1',sampledAt:1,processes:[p]};
 assert.equal(validateBatch(b).processes[0]?.startTime,'9007199254740993');
 assert.throws(()=>validateBatch({...b,processes:[{...p,startTime:9007199254740993}]}));assert.throws(()=>validateBatch({...b,version:2}));assert.throws(()=>validateBatch({...b,processes:[{...p,uptimeMs:-1}]}));assert.throws(()=>validateBatch({...b,processes:[p,p]}));
});
test('missing native artifact reports unavailable and close does not leave a child',async()=>{const s=createSampler({platform:'darwin',helperPath:'/private/tmp/hat-does-not-exist'});await assert.rejects(s.sample(),/unavailable/);await s.close();});
test('live native sampler measures controlled CPU worker, units, wide identity and owned shutdown',{skip:!hasHelper||!['darwin','win32'].includes(process.platform),timeout:20000},async(ctx)=>{
 const worker=spawn(process.execPath,['-e',`const a=Buffer.alloc(16*1024*1024,1);process.on('message',()=>{const cpu=process.cpuUsage();process.send({cpuUs:cpu.user+cpu.system});});console.log('ready');function burn(){const end=performance.now()+20;while(performance.now()<end)Math.sqrt(Math.random());setImmediate(burn);}burn();`],{stdio:['ignore','pipe','pipe','ipc']});
 const workerCpu=async()=>{const response=once(worker,'message');worker.send('cpu');return BigInt((await response)[0].cpuUs)*1000n;};
 const s=createSampler({helperPath:helper});
 try {await once(worker.stdout!,'data');const firstBefore=await workerCpu();let first;try{first=await s.sample();}catch(error){if(process.env.HAT_REQUIRE_NATIVE!=='1'&&/boot identity unavailable|enumeration denied/.test(String(error))){ctx.skip(`Restricted OS sampler: ${String(error)}`);return;}throw error;}const firstAfter=await workerCpu();const initial=first.processes.find(p=>p.pid===worker.pid);assert.ok(initial,'sampler must read worker');assert.equal(initial.availability,'known');assert.ok(BigInt(initial.rssBytes)>16n*1024n*1024n);assert.match(initial.startTime,/^\d+$/);assert.ok(initial.uptimeMs!==undefined&&initial.uptimeMs>=0);
 const t=new ProcessTracker();t.update(first,[{sessionKey:'worker',pid:worker.pid!,startTime:initial.startTime}]);assert.equal(t.view('worker').cpuPercent,undefined);await delay(400);const secondBefore=await workerCpu(),second=await s.sample(),secondAfter=await workerCpu();const later=second.processes.find(p=>p.pid===worker.pid);assert.equal(later?.startTime,initial.startTime);assert.ok(later?.uptimeMs!==undefined&&later.uptimeMs>initial.uptimeMs!);t.update(second,[{sessionKey:'worker',pid:worker.pid!,startTime:initial.startTime}]);const v=t.view('worker');
 // Shared runners need not allocate 40% of a core. Independently bracket each
 // OS sample with the worker's CPU counter instead of assuming scheduler share.
 const delta=BigInt(later!.cpuNs)-BigInt(initial.cpuNs),lower=secondBefore-firstAfter,upper=secondAfter-firstBefore,tolerance=20000000n;
 assert.ok(delta>0n&&delta>=lower-tolerance&&delta<=upper+tolerance,`Native CPU delta ${delta} outside worker counter bracket ${lower}..${upper}`);
 const expected=Number(delta)*100/Number(BigInt(second.monotonicNs)-BigInt(first.monotonicNs));assert.ok(v.cpuPercent!==undefined&&v.cpuPercent>0&&v.cpuPercent<180&&Math.abs(v.cpuPercent-expected)<1e-9,`CPU one-core percentage ${v.cpuPercent}, expected ${expected}`);assert.ok(BigInt(v.memoryBytes!)>16n*1024n*1024n);
 await s.close();await assert.rejects(s.sample(),/closed/);
 }finally{await s.close();const exited=once(worker,'exit');worker.kill();await exited;}
});
test('native helper exits cleanly on stdin EOF',{skip:!hasHelper,timeout:5000},async()=>{const child=spawn(helper,[],{stdio:['pipe','pipe','pipe']});child.stdout.resume();child.stderr.resume();const done=once(child,'exit');child.stdin.end();assert.equal((await done)[0],0);});
