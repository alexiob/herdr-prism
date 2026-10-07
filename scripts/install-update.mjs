import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
const exec=promisify(execFile);

export async function reviewedSourceRevision({root,release,env}){
 await exec('git',['-C',root,'diff','--quiet','HEAD','--'],{env});
 const revision=(await exec('git',['-C',root,'rev-parse','HEAD'],{env,encoding:'utf8'})).stdout.trim();
 if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Invalid reviewed checkout revision');
 const index=JSON.parse(await readFile(join(release,'checksums.json'),'utf8'));
 // Compiled files can be ignored or untracked even in a checkout with no diff.
 // Prove every copied input against HEAD, including the original manifest and
 // package before staging rewrites their runtime bindings/metadata.
 for(const file of Object.keys(index.files).filter(file=>file!=='release.json')){
  const committed=(await exec('git',['-C',root,'show',revision+':'+file],{env,encoding:'buffer',maxBuffer:64*1024*1024})).stdout;
  if(!committed.equals(await readFile(join(root,file))))throw Error('Reviewed source input differs from its Git revision');
 }
 return revision;
}

/** Both platform bootstraps call the same prepared, reversible update. */
export async function updateInstalled({root,release,info,revision,ref='main',...options}){
 const {prepareCodeReplacement}=await import('./update-code.mjs');
 const {updatePrism}=await import('./update.mjs');
 if(info.source?.kind==='github'&&!revision){
  // An explicitly reviewed source checkout may be used, but its reported
  // revision must describe the bytes that will replace a GitHub installation.
  try{
   revision=await reviewedSourceRevision({root,release,env:options.env});
  }catch{throw Error('A GitHub update requires an immutable downloaded revision or a clean reviewed Git checkout. Rerun the published installer.');}
 }
 const transaction=await prepareCodeReplacement({release,info,revision,ref,...options});
 try{return await updatePrism({root,...options,transaction});}
 catch(error){await transaction.cancel?.().catch(()=>{});throw error;}
}
