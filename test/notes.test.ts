import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,symlink,lstat,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
const notes=await import('../src/state/notes.ts').catch(()=>({})) as any;
async function fixture(t:any){const dir=await freshPrivateDirectory(join(tmpdir(),'prism-notes-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('Markdown notes persist by canonical agent identity on the collecting server',async t=>{
 assert.equal(typeof notes.NotesStore,'function');const dir=await fixture(t),store=new notes.NotesStore(dir);const initial=await store.load('codex:agent');assert.equal(initial.text,'');
 const saved=await store.save('codex:agent','# Agent notes\n\nKeep full Markdown.\n',initial.revision);assert.equal(saved.conflict,false);
 assert.deepEqual((await new notes.NotesStore(dir).load('codex:agent')).text,'# Agent notes\n\nKeep full Markdown.\n');assert.equal((await store.load('pi:agent')).text,'');const other=await fixture(t);assert.equal((await new notes.NotesStore(other).load('codex:agent')).text,'');
 assert.match(saved.path,/notes[/\\][a-f0-9]{64}[/\\]note.md$/);if(process.platform!=='win32'){assert.equal((await lstat(saved.path)).mode&0o777,0o600);assert.equal((await lstat(join(saved.path,'..'))).mode&0o777,0o700);}
});
test('stale drafts never overwrite external or simultaneous edits and are recovered privately',async t=>{
 assert.equal(typeof notes.NotesStore,'function');const dir=await fixture(t),a=new notes.NotesStore(dir),b=new notes.NotesStore(dir),initial=await a.load('codex:agent');
 const outcomes=await Promise.all([a.save('codex:agent','Panel A',initial.revision),b.save('codex:agent','Panel B',initial.revision)]);assert.equal(outcomes.filter((o:any)=>o.conflict).length,1);const conflict=outcomes.find((o:any)=>o.conflict);assert.ok(['Panel A','Panel B'].includes(await readFile(conflict.path,'utf8')));
 const loaded=await a.load('codex:agent');await writeFile(loaded.path,'External edit',{mode:0o600});const stale=await a.save('codex:agent','Stale draft',loaded.revision);assert.equal(stale.conflict,true);assert.equal(await readFile(loaded.path,'utf8'),'External edit');assert.equal(await readFile(stale.path,'utf8'),'Stale draft');
});
test('Notes refuse unsafe files and do not recreate removed server state',async t=>{
 assert.equal(typeof notes.NotesStore,'function');const dir=await fixture(t),store=new notes.NotesStore(dir),loaded=await store.load('codex:agent'),target=join(dir,'outside.md');await writeFile(target,'Outside');
 try{await symlink(target,loaded.path);}catch(e){if(process.platform==='win32'&&['EPERM','EACCES'].includes((e as any).code)){t.skip('Symlink privileges unavailable');return;}throw e;}await assert.rejects(store.load('codex:agent'),/Unsafe|symlink/i);await assert.rejects(store.save('codex:agent','Replace',loaded.revision),/Unsafe|symlink/i);assert.equal(await readFile(target,'utf8'),'Outside');
 await rm(dir,{recursive:true,force:true});await assert.rejects(store.save('codex:agent','After removal',loaded.revision));await assert.rejects(lstat(dir),{code:'ENOENT'});
});
