import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rm} from 'node:fs/promises';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {StateStore} from '../src/state/store.ts';
import {MailboxClient,MailboxServer} from '../src/state/mailbox.ts';
import {ensureCollectorService} from '../src/runtime/collector-service.ts';

test('a busy authoritative collector retries its initial ping within readiness polling without spawning another owner',async()=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-owner-readiness-'));
 const context={stateDir:directory,configDir:directory,configPath:join(directory,'config.toml'),serverStateDir:join(directory,'server'),endpoint:'fixture'};
 const store=new StateStore(context.serverStateDir),marker={token:'fixture-token',pid:process.pid};await store.write('controller',marker);
 let entered!:()=>void,release!:()=>void;const busy=new Promise<void>(resolve=>{entered=resolve;}),blocked=new Promise<void>(resolve=>{release=resolve;});
 const server=new MailboxServer(context.serverStateDir,marker.token,async op=>{if(op==='block'){entered();await blocked;return{finished:true};}return{kind:'collector-service',ready:true,stale:false};});
 await server.start();const original=StateStore.prototype.acquire;let admissionAttempts=0;
 StateStore.prototype.acquire=async function(...args){if(this.dir===context.stateDir){admissionAttempts++;throw new Error('Busy live collector must not spawn another owner');}return original.apply(this,args);};
 let timer:NodeJS.Timeout|undefined;const queued=new MailboxClient(context.serverStateDir,marker.token,10000).request('block');
 try{
  await busy;timer=setTimeout(release,2300);
  const owner=await ensureCollectorService(context as any);assert.deepEqual(owner.marker,marker);assert.equal(admissionAttempts,0);assert.deepEqual(await store.read('controller'),marker);
 }finally{clearTimeout(timer);release();await queued;StateStore.prototype.acquire=original;await server.close();await rm(directory,{recursive:true,force:true});}
});

test('an authenticated legacy collector response is rejected instead of retried or replaced',async()=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-owner-legacy-'));const context={stateDir:directory,configDir:directory,configPath:join(directory,'config.toml'),serverStateDir:join(directory,'server'),endpoint:'fixture'};
 const store=new StateStore(context.serverStateDir),marker={token:'fixture-token',pid:process.pid};await store.write('controller',marker);
 const server=new MailboxServer(context.serverStateDir,marker.token,async()=>({kind:'legacy',ready:true,stale:false}));await server.start();
 try{await assert.rejects(ensureCollectorService(context as any),/upgrade its legacy collector/);assert.deepEqual(await store.read('controller'),marker);}finally{await server.close();await rm(directory,{recursive:true,force:true});}
});
