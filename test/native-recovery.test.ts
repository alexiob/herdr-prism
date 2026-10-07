import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeSampler,validateBatch} from '../src/process/native-helper.ts';

test('native timing metadata is optional and validates bounded exact counters',()=>{
 const batch={version:1,platform:'darwin',bootId:'fixture',sampledAt:1,monotonicNs:'1',processes:[]};
 assert.equal(validateBatch(batch).monotonicNs,'1');
 const timed={...batch,timings:{collectionNs:'9007199254740993123',serializationNs:'123'}};
 assert.equal(validateBatch(timed).timings?.collectionNs,'9007199254740993123');
 assert.throws(()=>validateBatch({...batch,timings:{collectionNs:'NaN',serializationNs:'123'}}),/Invalid sampler/);
 assert.throws(()=>validateBatch({...batch,clockEpoch:'x'.repeat(257)}),/Invalid sampler/);
});

test('only an owned failed helper is restarted boundedly with a new clock epoch',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'prism-native-recovery-')),file=join(dir,'helper.cjs'),starts=join(dir,'starts');
 await writeFile(file,`const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});const path=${JSON.stringify(starts)};const count=Number(fs.existsSync(path)?fs.readFileSync(path,'utf8'):0)+1;fs.writeFileSync(path,String(count));let requests=0;rl.on('line',()=>{if(++requests===2)process.exit(2);process.stdout.write(JSON.stringify({version:1,platform:'darwin',bootId:'fixture',sampledAt:1,monotonicNs:'1000000000',processes:[]})+'\\n');});rl.on('close',()=>process.exit(0));`);
 const sampler=new NativeSampler(process.execPath,1000,[file],{cooldownMs:0,maxRestarts:1});
 try{
  const first=await sampler.sample();assert.ok(first.clockEpoch);
  await assert.rejects(sampler.sample(),/exited/i);
  const recovered=await sampler.sample();assert.ok(recovered.clockEpoch);assert.notEqual(recovered.clockEpoch,first.clockEpoch);
  await assert.rejects(sampler.sample(),/exited/i);
  await assert.rejects(sampler.sample(),/exited/i);
  assert.equal(await readFile(starts,'utf8'),'2','restart budget must not launch more helpers');
 }finally{await sampler.close();await rm(dir,{recursive:true,force:true});}
});

test('native helper recovery cooldown rejects without spawning a replacement',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'prism-native-cooldown-')),file=join(dir,'helper.cjs'),starts=join(dir,'starts');
 await writeFile(file,`const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(starts)},'started\\n');process.stdin.once('data',()=>process.exit(2));`);
 const sampler=new NativeSampler(process.execPath,1000,[file],{cooldownMs:60000,maxRestarts:1});
 try{await assert.rejects(sampler.sample(),/exited/i);await assert.rejects(sampler.sample(),/exited/i);assert.equal((await readFile(starts,'utf8')).trim(),'started');}finally{await sampler.close();await rm(dir,{recursive:true,force:true});}
});

test('a timed-out helper recovers on a subsequent request and all spawned fixtures are reaped',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'prism-native-timeout-')),file=join(dir,'helper.cjs'),starts=join(dir,'starts');
 await writeFile(file,`const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});const path=${JSON.stringify(starts)};const lines=fs.existsSync(path)?fs.readFileSync(path,'utf8'):'';fs.appendFileSync(path,String(process.pid)+'\\n');if(!lines)process.on('SIGTERM',()=>{});rl.on('line',()=>{if(!lines)return;process.stdout.write(JSON.stringify({version:1,platform:'darwin',bootId:'fixture',sampledAt:1,monotonicNs:'1',processes:[]})+'\\n');});rl.on('close',()=>process.exit(0));`);
 const sampler=new NativeSampler(process.execPath,1000,[file],{cooldownMs:0,maxRestarts:1});
 try{await assert.rejects(sampler.sample(),/timeout/i);assert.ok((await sampler.sample()).clockEpoch);await sampler.close();for(const pid of (await readFile(starts,'utf8')).trim().split('\n').map(Number))assert.throws(()=>process.kill(pid,0),'only owned helper processes must be reaped');}finally{await sampler.close();await rm(dir,{recursive:true,force:true});}
});
