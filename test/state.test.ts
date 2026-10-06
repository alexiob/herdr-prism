import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {test}from'node:test';import assert from'node:assert/strict';import {rm,writeFile,readFile}from'node:fs/promises';import path from'node:path';import os from'node:os';
const state=await import('../src/state/store.ts').catch(()=>({}))as any;const ipc=await import('../src/state/mailbox.ts').catch(()=>({}))as any;
test('private state persists atomic JSON and refuses filename traversal',async()=>{
 assert.equal(typeof state.StateStore,'function','state store missing');const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'hat-state-'));try{const store=new state.StateStore(dir);await store.init();await store.write('preferences',{pin:'codex:a'});assert.deepEqual(await store.read('preferences'),{pin:'codex:a'});await assert.rejects(store.write('../escape',{}),/name/);await writeFile(path.join(dir,'preferences.json'),'not json');await assert.rejects(store.read('preferences'),/JSON/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('mailbox authenticates requests and removes transient response payloads',async()=>{
 assert.equal(typeof ipc.MailboxServer,'function','mailbox missing');const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'hat-ipc-'));const server=new ipc.MailboxServer(dir,'secret',async(op:string,p:any)=>{if(op==='ping')return {ok:true};return {echo:p.text};});await server.start();try{const client=new ipc.MailboxClient(dir,'secret',500);assert.deepEqual(await client.request('echo',{text:'日本語'}),{echo:'日本語'});await assert.rejects(new ipc.MailboxClient(dir,'wrong',500).request('ping',{}),/authentication/);const fs=await import('node:fs/promises');assert.equal((await fs.readdir(path.join(dir,'responses'))).length,0);}finally{await server.close();await rm(dir,{recursive:true,force:true});}
});
test('a late caller cannot recreate purged collector state',async()=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'hat-gone-'));await rm(dir,{recursive:true});const client=new ipc.MailboxClient(dir,'expired',100);await assert.rejects(client.request('exit-launch',{id:'old'}),/ENOENT/);const fs=await import('node:fs/promises');await assert.rejects(fs.lstat(dir),/ENOENT/);
});
