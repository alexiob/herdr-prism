import test from 'node:test';
import assert from 'node:assert/strict';
import {windowsInspector} from '../src/config/windows-inspection.ts';
import {readWindowsAcl} from '../src/config/safe-file.ts';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const windows={skip:process.platform!=='win32'};

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
