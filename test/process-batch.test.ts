import test from 'node:test';
import assert from 'node:assert/strict';
import {ProcessTracker} from '../src/process/ownership.ts';
import type {ProcessSample,SampleBatch} from '../src/model/types.ts';
const p=(pid:number,ppid:number,startTime='1',cpuNs='0'):ProcessSample=>({pid,ppid,startTime,cpuNs,rssBytes:'100',name:'fixture'});
const batch=(processes:ProcessSample[],at=1000,clockEpoch?:string):SampleBatch=>({platform:'linux',bootId:'boot',sampledAt:at,monotonicNs:String(BigInt(at)*1000000n),processes,...clockEpoch?{clockEpoch}:{}});

test('deep compilation ancestry is attributed with linear identity inspection',()=>{
 const tracker=new ProcessTracker(),count=600;let inspections=0;
 const processes=Array.from({length:count},(_,index)=>{const process=p(index+1,index,String(index+1));Object.defineProperty(process,'startTime',{enumerable:true,get(){inspections++;return String(index+1);}});return process;}).reverse();
 tracker.update(batch(processes),[{sessionKey:'a',pid:1,startTime:'1'}]);
 assert.equal(tracker.view('a').coverage.total,count);
 assert.ok(inspections<count*15,`Deep parent traversal repeated ${inspections} identity inspections for ${count} processes`);
});

test('returned process and aggregate snapshots cannot corrupt the next CPU baseline',()=>{
 const tracker=new ProcessTracker(),roots=[{sessionKey:'a',pid:1,startTime:'1'}];
 tracker.update(batch([p(1,0)]),roots);
 const first=tracker.view('a');first.processes[0]!.cpuNs='99999999999';first.processes[0]!.rssBytes='1';first.processes.length=0;first.coverage.total=99;
 assert.equal(tracker.view('a').memoryBytes,'100');
 tracker.update(batch([p(1,0,'1','500000000')],2000),roots);
 assert.equal(tracker.view('a').cpuPercent,50);
});

test('a helper clock epoch change preserves ownership and requires a new CPU baseline',()=>{
 const tracker=new ProcessTracker(),roots=[{sessionKey:'a',pid:1,startTime:'1'}];
 tracker.update(batch([p(1,0),p(2,1,'2')],1000,'helper-1'),roots);
 tracker.update(batch([p(1,0,'1','500000000'),p(2,1,'2','500000000')],2000,'helper-1'),roots);
 assert.equal(tracker.view('a').cpuPercent,100);
 tracker.update(batch([p(1,0,'1','1000000000'),p(2,0,'2','1000000000')],5000,'helper-2'),roots);
 assert.deepEqual(tracker.view('a').processes.map(process=>process.pid),[1,2]);
 assert.equal(tracker.view('a').cpuPercent,undefined);
 tracker.update(batch([p(1,0,'1','1500000000'),p(2,0,'2','1500000000')],6000,'helper-2'),roots);
 assert.equal(tracker.view('a').cpuPercent,100);
});

test('preaggregated owner views preserve exclusive, shared and descendant coverage',()=>{
 const tracker=new ProcessTracker(),roots=[{sessionKey:'a',pid:1,startTime:'1'},{sessionKey:'b',pid:2,startTime:'2'},{sessionKey:'alias',pid:1,startTime:'1'}];
 const processes=[p(1,0),p(2,1,'2'),p(3,2,'3'),{...p(4,1,'4'),availability:'unavailable' as const}];
 tracker.update(batch(processes),roots);
 tracker.update(batch(processes.map(process=>({...process,cpuNs:'500000000'})),2000),roots);
 const parent=tracker.view('a'),subtree=tracker.view('a',true,['b','b']);
 assert.deepEqual(parent.coverage,{readable:1,total:2});assert.equal(parent.cpuPercent,undefined);assert.equal(parent.memoryBytes,'100');
 assert.deepEqual(subtree.coverage,{readable:3,total:4});assert.deepEqual(subtree.cpuCoverage,{readable:3,total:4});assert.equal(subtree.cpuPercent,undefined);assert.equal(subtree.memoryBytes,'300');
 assert.equal(tracker.view('b').cpuPercent,100);assert.equal(tracker.view('b').memoryBytes,'200');
 assert.equal(tracker.view('alias').sharedWith,'a');assert.equal(tracker.view('alias').availability,'not_applicable');
});

test('memoized unowned cycles and remembered detached identities cannot manufacture new ownership',()=>{
 const tracker=new ProcessTracker(),roots=[{sessionKey:'a',pid:9,startTime:'1'}];
 tracker.update(batch([p(9,0),p(3,9)]),roots);
 tracker.update(batch([p(9,0),p(1,2),p(2,1),p(3,2),p(4,3)]),roots);
 assert.deepEqual(new Set(tracker.view('a').processes.map(process=>process.pid)),new Set([9,3]));
 assert.equal(tracker.view('missing').processes.length,0);
});
