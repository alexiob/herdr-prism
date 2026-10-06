import test from 'node:test';
import assert from 'node:assert/strict';
import {windowsInspector} from '../src/config/windows-inspection.ts';
import {readWindowsAcl} from '../src/config/safe-file.ts';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {rm,mkdtemp,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const windows={skip:process.platform!=='win32'};

test('ACL paths are sent only after the worker has initialized its redirected reader',async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-reader-startup-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=join(root,'reader.cjs');
 await writeFile(file,"let ready=false;require('node:readline').createInterface({input:process.stdin}).on('line',line=>process.stdout.write(JSON.stringify(ready?{path:JSON.parse(line)}:{error:'request arrived before reader initialization'})+'\\n')).on('close',()=>process.exit(0));setTimeout(()=>{ready=true;process.stdout.write('PRISM_ACL_READY\\n');},50);\n");
 const inspect=windowsInspector('',{spawnWorker:()=>spawn(process.execPath,[file],{stdio:'pipe',windowsHide:true})});
 assert.deepEqual(JSON.parse(await inspect('literal path 日本語')),{path:'literal path 日本語'});
});

test('readonly ACL worker preserves literal Unicode paths and recovers after a failed inspection',windows,async t=>{
 const root=await freshPrivateDirectory(join(tmpdir(),'prism-日本語 $(literal) & '));t.after(()=>rm(root,{recursive:true,force:true}));
 await assert.rejects(readWindowsAcl(join(root,'missing')),/ACL/);
 const first=await readWindowsAcl(root);assert.equal(first.protected,true);
 assert.deepEqual(await readWindowsAcl(root),first);
});

test('ACL worker rejects overload and includes queue wait in the inspection deadline',windows,async()=>{
 const inspect=windowsInspector('Start-Sleep -Milliseconds 500; Write-Output "{}"',{timeoutMs:80,maxPending:2});
 const first=inspect('one'),second=inspect('two');
 await assert.rejects(inspect('three'),/queue limit/);
 const settled=await Promise.allSettled([first,second]);
 assert.ok(settled.every(result=>result.status==='rejected'&&/timed out/.test(String(result.reason))));
});
