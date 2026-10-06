import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createSampler} from '../src/process/sampler.ts';
import {ProcessTracker} from '../src/process/ownership.ts';
test('Linux procfs reads a live controlled worker CPU interval and resident pages',{skip:process.platform!=='linux',timeout:20000},async()=>{
 const worker=spawn(process.execPath,['-e','const a=Buffer.alloc(16*1024*1024,1); console.log("ready"); for(;;){Math.sqrt(Math.random());}'],{stdio:['ignore','pipe','pipe']});const sampler=createSampler();
 try{await once(worker.stdout!,'data');const first=await sampler.sample();const own=first.processes.find(p=>p.pid===worker.pid);assert.ok(own);assert.ok(own.uptimeMs!==undefined&&own.uptimeMs>=0);assert.ok(BigInt(own.rssBytes)>16n*1024n*1024n);const tracker=new ProcessTracker();const root=[{sessionKey:'linux-worker',pid:worker.pid!,startTime:own.startTime}];tracker.update(first,root);assert.equal(tracker.view('linux-worker').cpuPercent,undefined);await delay(400);tracker.update(await sampler.sample(),root);const v=tracker.view('linux-worker');assert.ok(v.cpuPercent!==undefined&&v.cpuPercent>40&&v.cpuPercent<180,`One-core CPU ${v.cpuPercent}`);assert.equal(v.memoryLabel,'RSS sum');assert.equal(v.processes[0]?.startTime,own.startTime);assert.ok(v.processes[0]?.uptimeMs!==undefined&&v.processes[0].uptimeMs>own.uptimeMs!);assert.ok(BigInt(v.memoryBytes!)>16n*1024n*1024n);await sampler.close();await assert.rejects(sampler.sample(),/closed/);
 }finally{await sampler.close();const exited=once(worker,'exit');worker.kill();await exited;}
});
