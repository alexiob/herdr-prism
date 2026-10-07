import test from 'node:test';
import assert from 'node:assert/strict';
import {SampleHistory} from '../src/metrics/history.ts';
import {ProcessTracker} from '../src/process/ownership.ts';
import type {ProcessSample,SampleBatch} from '../src/model/types.ts';

test('earlier panel render times do not delete a newer retained history observation',()=>{
 const history=new SampleHistory({windowMs:10000});
 history.add('a','self',{at:1000,cpuPercent:25,memoryBytes:'100'});
 history.add('a','self',{at:2000,cpuPercent:50,memoryBytes:'200'});
 assert.deepEqual(history.view('a','self',1500).cpu,[25]);
 assert.deepEqual(history.view('a','self',2000).cpu,[25,50]);
 assert.equal(history.view('a','self',2000).peakMemoryBytes,'200');
});

test('reading one clock window does not erase another panel snapshot or a different scope',()=>{
 const history=new SampleHistory({windowMs:10000});
 history.add('a','self',{at:1000,cpuPercent:25});
 history.add('a','subtree',{at:1000,cpuPercent:75});
 history.add('b','self',{at:1000,cpuPercent:50});
 assert.equal(history.view('a','self',20000).points.length,0);
 assert.deepEqual(history.view('a','self',1000).cpu,[25]);
 assert.deepEqual(history.view('a','subtree',1000).cpu,[75]);
 assert.deepEqual(history.view('b','self',1000).cpu,[50]);
});

test('read-only history views remain detached and writes bound points, time and series',()=>{
 const history=new SampleHistory({windowMs:1000,maxPoints:2,maxSeries:2});
 history.add('a','self',{at:0,cpuPercent:10});
 history.add('a','self',{at:500,cpuPercent:20});
 history.add('a','self',{at:1000,cpuPercent:30});
 assert.deepEqual(history.view('a','self',1000).cpu,[20,30]);
 const view=history.view('a','self',1000);view.points[0]!.cpuPercent=999;view.cpu[0]=999;
 assert.deepEqual(history.view('a','self',1000).cpu,[20,30]);
 history.add('a','self',{at:2500,cpuPercent:40});
 assert.deepEqual(history.view('a','self',2500).cpu,[40]);
 history.add('b','self',{at:2500,cpuPercent:50});
 history.add('c','self',{at:2500,cpuPercent:60});
 assert.equal(history.view('a','self',2500).points.length,0);
 assert.deepEqual(history.view('b','self',2500).cpu,[50]);
 assert.deepEqual(history.view('c','self',2500).cpu,[60]);
});

test('a new short-lived job leaves current aggregate CPU unknown while retaining measured history',()=>{
 const history=new SampleHistory(),tracker=new ProcessTracker();
 const process=(pid:number,ppid:number,startTime:string,cpuNs:string):ProcessSample=>({pid,ppid,startTime,cpuNs,rssBytes:'100',name:'fixture'});
 const sample=(at:number,processes:ProcessSample[]):SampleBatch=>({platform:'linux',bootId:'boot',sampledAt:at,monotonicNs:String(BigInt(at)*1000000n),processes});
 const roots=[{sessionKey:'a',pid:10,startTime:'5'},{sessionKey:'b',pid:20,startTime:'6'}];
 const record=(at:number)=>{for(const key of ['a','b']){const resource=tracker.view(key);history.add(key,'self',{at,cpuPercent:resource.cpuPercent,memoryBytes:resource.memoryBytes});}};
 tracker.update(sample(1000,[process(10,1,'5','0'),process(20,1,'6','0')]),roots);record(1000);
 tracker.update(sample(2000,[process(10,1,'5','500000000'),process(20,1,'6','250000000')]),roots);record(2000);
 tracker.update(sample(3000,[process(10,1,'5','1000000000'),process(11,10,'7','10000000'),process(20,1,'6','500000000')]),roots);record(3000);
 assert.equal(tracker.view('a').cpuPercent,undefined);
 assert.deepEqual(tracker.view('a').coverage,{readable:2,total:2});
 assert.deepEqual(tracker.view('a').cpuCoverage,{readable:1,total:2});
 assert.equal(tracker.view('a').memoryBytes,'200');
 assert.deepEqual(history.view('a','self',3000).cpu,[undefined,50,undefined]);
 assert.equal(history.view('a','self',3000).peakCpuPercent,50);
 assert.deepEqual(history.view('b','self',3000).cpu,[undefined,25,25]);
 tracker.update(sample(4000,[process(10,1,'5','1500000000'),process(20,1,'6','750000000')]),roots);record(4000);
 assert.equal(tracker.view('a').cpuPercent,50);
 assert.deepEqual(history.view('a','self',4000).cpu,[undefined,50,undefined,50]);
});
