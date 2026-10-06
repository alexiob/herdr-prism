import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyHelperArtifact} from '../src/process/native-helper.ts';
test('packaged helper verifies content hash, filename and platform before executing',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hat-integrity-'));const file=join(dir,'hat-sampler');try{
 const manifest={version:1,platform:'darwin',arch:'arm64',filename:'hat-sampler',sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'};
 await writeFile(file,'abc');await writeFile(join(dir,'sha256.json'),JSON.stringify(manifest));await verifyHelperArtifact(file,'darwin','arm64');
 await writeFile(file,'abcd');await assert.rejects(verifyHelperArtifact(file,'darwin','arm64'),/checksum/);
 await writeFile(file,'abc');await assert.rejects(verifyHelperArtifact(file,'win32','x64'),/manifest/);
 await writeFile(join(dir,'sha256.json'),JSON.stringify({...manifest,filename:'other'}));await assert.rejects(verifyHelperArtifact(file,'darwin','arm64'),/manifest/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
