import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {privateDir} from '../src/config/safe-file.ts';

test('same-process private directory callers wait until their exact creator has finished',async t=>{
 const root=await fs.mkdtemp(join(tmpdir(),'prism-dir-flight-')),path=join(root,'private'),other=join(root,'other'),mkdir=fs.mkdir;
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let release!:()=>void,entered!:()=>void,calls=0;
 const suspended=new Promise<void>(resolve=>release=resolve),created=new Promise<void>(resolve=>entered=resolve);
 t.mock.method(fs,'mkdir',async(...args:Parameters<typeof mkdir>)=>{
  const call=args[0]===path?++calls:0,result=await mkdir(...args);if(call===1){entered();await suspended;}return result;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const first=privateDir(path);await created;
 let secondFinished=false;const second=privateDir(path).finally(()=>{secondFinished=true;});void second.catch(()=>{});
 try{
  await privateDir(other);
  assert.equal(calls,1,'the second caller must not inspect the still-initializing directory');
  assert.equal(secondFinished,false);
 }finally{release();await Promise.allSettled([first,second]);}
 await Promise.all([first,second]);await privateDir(path);
 assert.equal(calls,2,'completed initialization must not bypass future existing-path checks');
});

test('failed private directory initialization releases its exact flight for a later retry',async t=>{
 const root=await fs.mkdtemp(join(tmpdir(),'prism-dir-retry-')),path=join(root,'private'),mkdir=fs.mkdir;
 t.after(()=>fs.rm(root,{recursive:true,force:true}));let attempts=0;
 t.mock.method(fs,'mkdir',async(...args:Parameters<typeof mkdir>)=>{if(args[0]===path&&attempts++===0)throw Object.assign(new Error('Fixture denied'),{code:'EACCES'});return mkdir(...args);});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const failed=await Promise.allSettled([privateDir(path),privateDir(path)]);for(const result of failed){assert.equal(result.status,'rejected');if(result.status==='rejected')assert.equal(result.reason.code,'EACCES');}assert.equal(attempts,1);
 await privateDir(path);assert.ok((await fs.lstat(path)).isDirectory());
});
