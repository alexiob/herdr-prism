import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProcessTracker} from '../src/process/ownership.ts';
import {LaunchLedger} from '../src/process/ledger.ts';
import {createSampler} from '../src/process/sampler.ts';
import type {ProcessSample,SampleBatch} from '../src/model/types.ts';
const p=(pid:number,ppid:number,startTime='9007199254740993000',cpuNs='0',rssBytes='100'):ProcessSample=>({pid,ppid,startTime,cpuNs,rssBytes,name:`p${pid}`});
const b=(processes:ProcessSample[],ns='1000000000',bootId='boot'):SampleBatch=>({platform:'linux',bootId,sampledAt:Number(BigInt(ns)/1000000n),monotonicNs:ns,processes});
test('nearest roots are disjoint and subtree unions count each process once',()=>{
 const t=new ProcessTracker(); const roots=[{sessionKey:'a',pid:10},{sessionKey:'b',pid:20}];
 t.update(b([p(10,1),p(11,10),p(20,10),p(21,20)]),roots);
 assert.deepEqual(t.view('a').processes.map(x=>x.pid),[10,11]);
 assert.deepEqual(t.view('b').processes.map(x=>x.pid),[20,21]);
 assert.equal(t.view('a',true,['b','b']).memoryBytes,'400');
 assert.equal(t.view('a').cpuPercent,undefined);
 t.update(b([p(10,1,undefined,'1000000000'),p(11,10,undefined,'500000000'),p(20,10),p(21,20)],'2000000000'),roots);
 assert.equal(t.view('a').cpuPercent,150);
});
test('reparenting remembers only observed identities and CPU resets warm up again',()=>{
 const t=new ProcessTracker(), roots=[{sessionKey:'a',pid:10,startTime:'5'}];
 t.update(b([p(10,1,'5'),p(11,10,'7')]),roots);
 t.update(b([p(10,1,'5','1000000000'),p(11,1,'7','1000000000')],'2000000000'),roots);
 assert.equal(t.view('a').cpuPercent,200); assert.equal(t.view('a').processes.length,2);
 t.update(b([p(10,1,'5','0'),p(11,1,'8')],'3000000000'),roots);
 assert.deepEqual(t.view('a').processes.map(x=>x.pid),[10]); assert.equal(t.view('a').cpuPercent,undefined);
 t.update(b([p(10,1,'5','0')],'4000000000'),roots); assert.equal(t.view('a').cpuPercent,0);
 t.update(b([p(10,1,'5','0')],'5000000000','reboot'),roots); assert.equal(t.view('a').cpuPercent,undefined);
});
test('root PID reuse cannot inherit session and shared roots never duplicate resources',()=>{
 const t=new ProcessTracker();
 t.update(b([p(10,1,'5')]),[{sessionKey:'a',pid:10}]);
 t.update(b([p(10,1,'6')],'2000000000'),[{sessionKey:'a',pid:10}]);
 assert.equal(t.view('a').processes.length,0);
 const s=new ProcessTracker(); s.update(b([p(10,1,'5')]),[{sessionKey:'a',pid:10},{sessionKey:'child',pid:10}]);
 assert.equal(s.view('child').sharedWith,'a'); assert.equal(s.view('child').memoryBytes,undefined);
});
test('launch ownership requires validated exact live identity and expires on reuse',()=>{
 const ledger=new LaunchLedger(), t=new ProcessTracker(ledger);
 const batch=b([p(77,1,'9007199254740993001')]);
 assert.throws(()=>ledger.add({id:'bad',sessionKey:'a',pid:77,startTime:'9007199254740993000'},batch));
 ledger.add({id:'job',sessionKey:'a',pid:77,startTime:'9007199254740993001'},batch);
 t.update(batch,[]); assert.equal(t.view('a').processes.length,1);
 t.update(b([p(77,1,'9007199254740993002')],'2000000000'),[]); assert.equal(t.view('a').processes.length,0);
});
test('partial reads never turn inaccessible resources into measured zero',()=>{
 const t=new ProcessTracker(); const batch=b([{...p(10,1,'5'),availability:'unavailable'},p(11,10,'6')]); batch.errors=['pid 10 denied'];
 t.update(batch,[{sessionKey:'a',pid:10,startTime:'5'}]);
 assert.equal(t.view('a').memoryBytes,'100'); assert.equal(t.view('a').availability,'partial');
 assert.deepEqual(t.view('a').coverage,{readable:1,total:2}); assert.equal(t.view('missing').memoryBytes,undefined);
});
test('Linux stat parser respects comm parentheses, boot/start ticks, pages and own CPU only',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hat-proc-'));
 try {
 await mkdir(join(root,'sys/kernel/random'),{recursive:true}); await writeFile(join(root,'sys/kernel/random/boot_id'),'fixtureboot\n');
 await mkdir(join(root,'42'));
 // fields 3..24: child CPU deliberately huge, start ticks exact, RSS 3 pages.
 await writeFile(join(root,'42/stat'),'42 (name (a) b) S 1 0 0 0 0 0 0 0 0 0 12 8 99999 99999 0 0 4 0 9007199254740993 0 3\n');
 const s=createSampler({platform:'linux',procRoot:root,clockTicks:100,pageSize:4096});
 const x=await s.sample(); assert.equal(x.bootId,'fixtureboot'); assert.equal(x.processes[0]?.startTime,'9007199254740993');
 assert.equal(x.processes[0]?.cpuNs,'200000000'); assert.equal(x.processes[0]?.rssBytes,'12288'); assert.equal(x.processes[0]?.threads,4);
 await s.close(); await assert.rejects(s.sample(),/closed/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a denied known child stays partial and resumes remembered detached ownership without bridging CPU gap',()=>{
 const t=new ProcessTracker(),roots=[{sessionKey:'a',pid:10,startTime:'5'}];t.update(b([p(10,1,'5'),p(11,10,'7')]),roots);
 const denied=b([p(10,1,'5')],'2000000000');denied.errors=['pid 11: EACCES'];t.update(denied,roots);
 assert.deepEqual(t.view('a').coverage,{readable:1,total:2});assert.equal(t.view('a').availability,'partial');
 t.update(b([p(10,1,'5'),p(11,1,'7','99999999')],'3000000000'),roots);assert.deepEqual(t.view('a').processes.map(p=>p.pid),[10,11]);assert.equal(t.view('a').cpuPercent,undefined);
});
test('explicitly validated new root can replace a reused PID without inheriting old counter',()=>{const t=new ProcessTracker();t.update(b([p(10,1,'5')]),[{sessionKey:'a',pid:10,startTime:'5'}]);t.update(b([p(10,1,'6')],'2000000000'),[{sessionKey:'a',pid:10,startTime:'6'}]);assert.equal(t.view('a').processes[0]?.startTime,'6');assert.equal(t.view('a').cpuPercent,undefined);});
test('persisted launch records restore only with exact boot and live identity, malformed records are ignored',()=>{
 const ledger=new LaunchLedger();ledger.restore([{id:'valid',sessionKey:'a',pid:10,startTime:'9007199254740993001',bootId:'boot'},{id:'unproven',sessionKey:'b',pid:11,startTime:'7'},{id:'invalid',sessionKey:'b',pid:12,startTime:9007199254740993001,bootId:'boot'}]);
 const t=new ProcessTracker(ledger);t.update(b([p(10,1,'9007199254740993001'),p(11,1,'7')]),[]);assert.equal(t.view('a').processes.length,1);assert.equal(t.view('b').processes.length,0);
 t.update(b([p(10,1,'9007199254740993001')],'2000000000','reboot'),[]);assert.equal(t.view('a').processes.length,0);
});
test('Linux uptime uses exact wide birth ticks and leaves missing or future timing unavailable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hat-uptime-'));try{await mkdir(join(root,'sys/kernel/random'),{recursive:true});await writeFile(join(root,'sys/kernel/random/boot_id'),'boot');await mkdir(join(root,'42'));await writeFile(join(root,'42/stat'),'42 (worker) S 1 0 0 0 0 0 0 0 0 0 12 8 999 999 0 0 4 0 9007199254740993 0 3');await writeFile(join(root,'uptime'),'90071992547410.93 0\n');const sampler=createSampler({platform:'linux',procRoot:root,clockTicks:100,pageSize:4096});const first=await sampler.sample();assert.equal(first.processes[0]?.startTime,'9007199254740993');assert.equal(first.processes[0]?.uptimeMs,1000);await writeFile(join(root,'uptime'),'90071992547411.18 0\n');assert.equal((await sampler.sample()).processes[0]?.uptimeMs,1250);await rm(join(root,'uptime'));assert.equal((await sampler.sample()).processes[0]?.uptimeMs,undefined);await writeFile(join(root,'uptime'),'1.0 0\n');assert.equal((await sampler.sample()).processes[0]?.uptimeMs,undefined);await sampler.close();}finally{await rm(root,{recursive:true,force:true});}
});
test('only validated root identities are harnesses; owned descendants and ledger jobs are not',()=>{const ledger=new LaunchLedger();const batch=b([p(10,1,'5'),p(11,10,'6'),p(77,1,'7')]);ledger.add({id:'job',sessionKey:'a',pid:77,startTime:'7'},batch);const tracker=new ProcessTracker(ledger);tracker.update(batch,[{sessionKey:'a',pid:10,startTime:'5'}]);const rows=tracker.view('a').processes;assert.equal(rows.find(p=>p.pid===10)?.isHarness,true);assert.equal(rows.find(p=>p.pid===11)?.isHarness,false);assert.equal(rows.find(p=>p.pid===77)?.isHarness,false);});
test('duplicate verified roots for the same session never report shared ownership with itself',()=>{const tracker=new ProcessTracker();const roots=[{sessionKey:'a',pid:10,startTime:'5'},{sessionKey:'a',pid:10,startTime:'5'}];tracker.update(b([p(10,1,'5')]),roots);assert.equal(tracker.view('a').availability,'known');assert.equal(tracker.view('a').sharedWith,undefined);assert.equal(tracker.view('a').processes.length,1);});
test('resuming sampling warms CPU once while retaining detached ownership and bound root identity',()=>{
 const tracker=new ProcessTracker(),roots=[{sessionKey:'a',pid:10}];
 tracker.update(b([p(10,1,'5'),p(11,10,'7')]),roots);
 tracker.update(b([p(10,1,'5','1000000000'),p(11,10,'7','1000000000')],'2000000000'),roots);
 assert.equal(tracker.view('a').cpuPercent,200);
 tracker.update(b([p(10,1,'5','9000000000'),p(11,1,'7','9000000000')],'10000000000'),roots,{resetCpuBaseline:true});
 const resumed=tracker.view('a');
 assert.deepEqual(resumed.processes.map(p=>p.pid),[10,11]);
 assert.equal(resumed.memoryBytes,'200');
 assert.equal(resumed.availability,'known');
 assert.equal(resumed.cpuPercent,undefined);
 assert.deepEqual(resumed.cpuCoverage,{readable:0,total:2});
 tracker.update(b([p(10,1,'5','9500000000'),p(11,1,'7','9500000000')],'11000000000'),roots);
 assert.equal(tracker.view('a').cpuPercent,100);
 tracker.update(b([p(10,1,'6'),p(11,1,'8')],'12000000000'),roots,{resetCpuBaseline:true});
 assert.equal(tracker.view('a').processes.length,0,'baseline reset must not bind a reused root PID');
 tracker.update(b([p(11,1,'7')],'13000000000','new-boot'),roots,{resetCpuBaseline:true});
 assert.equal(tracker.view('a').processes.length,0,'baseline reset must not carry remembered ownership across boots');
});
test('a newborn job preserves measured CPU as a lower bound without presenting a complete total',()=>{
 const tracker=new ProcessTracker(),roots=[{sessionKey:'a',pid:10,startTime:'5'},{sessionKey:'shared',pid:10,startTime:'5'}];
 tracker.update(b([p(10,1,'5')]),roots);assert.equal(tracker.view('a').cpuLowerBound,undefined);
 tracker.update(b([p(10,1,'5','1200000000'),p(11,10,'6','999000000000')],'2000000000'),roots);
 const partial=tracker.view('a');assert.equal(partial.cpuPercent,undefined);assert.equal(partial.cpuLowerBound,120);assert.deepEqual(partial.cpuCoverage,{readable:1,total:2});assert.equal(partial.memoryBytes,'200');assert.equal(tracker.view('shared').cpuLowerBound,undefined);
 tracker.update(b([p(10,1,'5','1200000000'),p(11,10,'6','999000000000')],'3000000000'),roots,{resetCpuBaseline:true});assert.equal(tracker.view('a').cpuLowerBound,undefined,'full warmup cannot imply a measured zero');
 tracker.update(b([p(10,1,'5','1200000000'),p(11,10,'6','999000000000')],'4000000000'),roots);assert.equal(tracker.view('a').cpuPercent,0);assert.equal(tracker.view('a').cpuLowerBound,undefined,'complete zero remains a measured total');
});
