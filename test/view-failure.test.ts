import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readFile,rm,lstat} from 'node:fs/promises';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {ViewFailureReporter} from '../src/runtime/view-failure.ts';
import {StateStore} from '../src/state/store.ts';
import {MailboxClient} from '../src/state/mailbox.ts';
import {RemoteCollector} from '../src/runtime/remote-collector.ts';

test('one private per-view failure records only bounded phase and message before cleanup',async t=>{
 const dir=await freshPrivateDirectory(join(tmpdir(),'prism-view-failure-'));t.after(()=>rm(dir,{recursive:true,force:true}));const reporter=new ViewFailureReporter(dir,'own-pane');
 const error=Object.assign(new Error('view.register: collector unavailable'),{transcript:'PRIVATE_BODY',notes:'PRIVATE_NOTES',token:'PRIVATE_TOKEN'});
 await Promise.all([reporter.record('register',error),reporter.record('cleanup',new Error('later'))]);
 const raw=await readFile(reporter.path,'utf8'),receipt=JSON.parse(raw);assert.equal(receipt.phase,'register');assert.equal(receipt.error,error.message);assert.equal(receipt.pid,process.pid);assert.equal(typeof receipt.at,'number');
 assert.equal(/PRIVATE_BODY|PRIVATE_NOTES|PRIVATE_TOKEN|stack/.test(raw),false);assert.deepEqual(Object.keys(receipt).sort(),['at','error','phase','pid']);if(process.platform!=='win32')assert.equal((await lstat(reporter.path)).mode&0o777,0o600);
 const bounded=new ViewFailureReporter(dir,'another-pane');await bounded.record('x'.repeat(1000),new Error('e'.repeat(10000)));const small=JSON.parse(await readFile(bounded.path,'utf8'));assert.equal(small.phase.length,128);assert.equal(small.error.length,512);
});

test('a failure diagnostic never resurrects removed server state',async t=>{
 const dir=await freshPrivateDirectory(join(tmpdir(),'prism-view-failure-purge-'));t.after(()=>rm(dir,{recursive:true,force:true}));const reporter=new ViewFailureReporter(dir,'own-pane');await rm(dir,{recursive:true,force:true});
 await assert.rejects(reporter.record('initial-poll',new Error('failure')),{code:'ENOENT'});await assert.rejects(lstat(dir),{code:'ENOENT'});
});

test('remote startup identifies register versus first-poll failure without marking the failed frontend ready',async t=>{
 const dir=await freshPrivateDirectory(join(tmpdir(),'prism-view-phase-'));t.after(()=>rm(dir,{recursive:true,force:true}));const context={stateDir:dir,configDir:dir,configPath:join(dir,'config.toml'),serverStateDir:join(dir,'server'),endpoint:'fixture'} as any;
 await new StateStore(context.serverStateDir).write('controller',{token:'fixture-token',pid:process.pid});const original=MailboxClient.prototype.request;let failedOp='view.register';let readyCalls=0;
 (MailboxClient.prototype as any).request=async(op:string)=>{if(op==='ping')return{kind:'collector-service',ready:true,stale:false};if(op===failedOp)throw new Error(op+': collector unavailable');if(op==='view.ready')readyCalls++;return{};};
 try{for(const phase of ['register','initial-poll']){failedOp=phase==='register'?'view.register':'view.poll';const remote=new RemoteCollector(context,'pane','terminal');try{await assert.rejects(remote.start(),/collector unavailable/);assert.equal(remote.startupPhase,phase);}finally{await remote.close();}}assert.equal(readyCalls,0);}finally{MailboxClient.prototype.request=original;}
});
