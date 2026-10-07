import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
// @ts-ignore dependency-free update integration
import {reviewedSourceRevision} from '../scripts/install-update.mjs';
const exec=promisify(execFile);
test('reviewed source provenance rejects copied untracked and ignored artifacts in an otherwise clean Git checkout',async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-provenance-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await exec('git',['init',root]);await mkdir(join(root,'release'));
 await writeFile(join(root,'.gitignore'),'ignored.js\nrelease/\n');await writeFile(join(root,'tracked.js'),'committed\n');
 await exec('git',['-C',root,'add','.gitignore','tracked.js']);await exec('git',['-C',root,'-c','user.name=Prism fixture','-c','user.email=fixture@example.invalid','commit','-m','synthetic source']);
 const release=join(root,'release');await writeFile(join(release,'checksums.json'),JSON.stringify({files:{'tracked.js':'synthetic','release.json':'synthetic'}}));
 assert.match(await reviewedSourceRevision({root,release}),/^[a-f0-9]{40}$/);
 for(const file of ['untracked.js','ignored.js']){
  await writeFile(join(root,file),'unreviewed input\n');await writeFile(join(release,'checksums.json'),JSON.stringify({files:{[file]:'synthetic','release.json':'synthetic'}}));
  await assert.rejects(reviewedSourceRevision({root,release}),/git|HEAD|path|does not exist/i);
 }
});
