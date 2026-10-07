import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,symlink,lstat,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
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

test('exact own placeholder Notes are copied to an absent canonical session without losing the original or overwriting an intentional empty note',async t=>{
 const directory=await freshPrivateDirectory(join(tmpdir(),'prism-note-adopt-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new notes.NotesStore(directory),source='codex:pane-own-terminal',target='codex:verified-thread';
 const original=await store.save(source,'Owned placeholder fixture\n',null);const copied=await store.adoptOwnPlaceholder({provider:'codex',terminalId:'own-terminal',canonicalKey:target});assert.equal(copied,true);assert.equal((await store.load(target)).text,'Owned placeholder fixture\n');assert.equal((await store.load(source)).text,'Owned placeholder fixture\n');assert.notEqual((await store.load(source)).path,(await store.load(target)).path);
 await store.save(source,'Updated source fixture\n',original.revision);assert.equal((await store.load(target)).text,'Owned placeholder fixture\n','the canonical copy must have an independent inode');assert.equal(await store.adoptOwnPlaceholder({provider:'codex',terminalId:'own-terminal',canonicalKey:target}),false);
 const empty='codex:intentionally-empty';await store.save(empty,'',null);assert.equal(await store.adoptOwnPlaceholder({provider:'codex',terminalId:'own-terminal',canonicalKey:empty}),false);assert.equal((await store.load(empty)).text,'');
 assert.equal(await store.adoptOwnPlaceholder({provider:'codex',terminalId:'foreign-terminal',canonicalKey:'codex:other'}),false);assert.equal(await store.adoptOwnPlaceholder({provider:'codex',terminalId:'own-terminal',canonicalKey:source}),false);
});

test('concurrent adoption is serialized, unsafe placeholder paths are refused, and removed state is never recreated',async t=>{
 const dir=await fixture(t),store=new notes.NotesStore(dir),identity={provider:'codex',terminalId:'own',canonicalKey:'codex:verified'};await store.save('codex:pane-own','Private fixture copy\n',null);
 const results=await Promise.all([store.adoptOwnPlaceholder(identity),store.adoptOwnPlaceholder(identity)]);assert.deepEqual(results.sort(),[false,true]);assert.equal((await store.load(identity.canonicalKey)).text,'Private fixture copy\n');
 const source=await store.load('codex:pane-unsafe'),external=join(dir,'external.md');await writeFile(external,'External fixture',{mode:0o600});let linked=false;try{await symlink(external,source.path);linked=true;}catch(error){if(process.platform!=='win32'||!['EPERM','EACCES'].includes((error as any).code))throw error;t.diagnostic('Symlink privilege unavailable; concurrent adoption and removal checks still run');}if(linked)await assert.rejects(store.adoptOwnPlaceholder({provider:'codex',terminalId:'unsafe',canonicalKey:'codex:other'}),/Unsafe/);assert.equal(await readFile(external,'utf8'),'External fixture');
 await rm(dir,{recursive:true,force:true});assert.equal(await store.adoptOwnPlaceholder(identity),false);await assert.rejects(lstat(dir),{code:'ENOENT'});
});


test('a canonical note created after the initial adoption check wins without being overwritten',async t=>{
 const dir=await fixture(t),store=new notes.NotesStore(dir);await store.save('codex:pane-own','Placeholder fixture',null);const target=(await store.load('codex:verified')).path,read=store.read.bind(store);let injected=false;
 t.mock.method(store,'read',async(path:string)=>{const value=await read(path);if(path===target&&!injected){injected=true;await writeFile(target,'Later intentional canonical fixture',{mode:0o600});}return value;});
 assert.equal(await store.adoptOwnPlaceholder({provider:'codex',terminalId:'own',canonicalKey:'codex:verified'}),false);assert.equal(await readFile(target,'utf8'),'Later intentional canonical fixture');assert.equal((await store.load('codex:pane-own')).text,'Placeholder fixture');
});

test('a retained placeholder revision is adopted by one canonical conversation only, including restored old revisions',async t=>{
 const {NotesStore}=await import('../src/state/notes.ts');const dir=await freshPrivateDirectory(join(tmpdir(),'prism-note-adopt-once-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new NotesStore(dir);
 const source='codex:pane-own',identity={provider:'codex',terminalId:'own',canonicalKey:'codex:first'};
 const original=await store.save(source,'First private fixture',null);assert.equal(await store.adoptOwnPlaceholder(identity),true);
 assert.equal(await store.adoptOwnPlaceholder({...identity,canonicalKey:'codex:second'}),false);assert.equal((await store.load('codex:second')).revision,null);
 const updated=await store.save(source,'Changed private fixture',original.revision);assert.equal(await store.adoptOwnPlaceholder({...identity,canonicalKey:'codex:third'}),true);
 await store.save(source,original.text,updated.revision);assert.equal(await store.adoptOwnPlaceholder({...identity,canonicalKey:'codex:fourth'}),false);
 assert.equal((await store.load(source)).text,original.text);assert.equal((await store.load('codex:first')).text,original.text);assert.equal((await store.load('codex:third')).text,updated.text);
});

test('an interrupted source reservation resumes only its original canonical key before and after publication',async t=>{
 const {NotesStore}=await import('../src/state/notes.ts');const dir=await freshPrivateDirectory(join(tmpdir(),'prism-note-adopt-crash-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const phase of ['before','after']){
  const store=new NotesStore(dir),terminalId='own-'+phase,identity={provider:'codex',terminalId,canonicalKey:'codex:first-'+phase};
  const source=await store.save('codex:pane-'+terminalId,'Private fixture '+phase,null),target=await store.load(identity.canonicalKey),receipt=join(dirname(source.path),'placeholder-adoptions.json');
  const read=(store as any).read.bind(store);let interrupted=false;
  (store as any).read=async(file:string)=>{if(!interrupted&&file===(phase==='before'?source.path:receipt)){
   const reserved=await lstat(receipt).then(()=>true,()=>false),published=await lstat(target.path).then(()=>true,()=>false);
   if(reserved&&published===(phase==='after')){interrupted=true;throw Error('Fixture interrupted adoption');}
  }return read(file);};
  await assert.rejects(store.adoptOwnPlaceholder(identity),/Fixture interrupted/);assert.equal(interrupted,true);
  const resumed=new NotesStore(dir);assert.equal(await resumed.adoptOwnPlaceholder({...identity,canonicalKey:'codex:later-'+phase}),false);
  assert.equal((await resumed.load('codex:later-'+phase)).revision,null,'an unfinished adoption must not be retargeted to another conversation');
  assert.equal(await resumed.adoptOwnPlaceholder(identity),phase==='before');
  assert.equal((await resumed.load(identity.canonicalKey)).text,source.text);assert.equal((await resumed.load('codex:pane-'+terminalId)).text,source.text);
  const journal=JSON.parse(await readFile(receipt,'utf8'));assert.equal(journal.revisions[0].state,'complete');assert.equal(journal.revisions[0].canonicalKey,identity.canonicalKey);
 }
});
