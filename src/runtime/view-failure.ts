import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicWrite,restrict} from '../config/safe-file.ts';
import {identityName} from '../state/store.ts';

/** A failed frontend otherwise loses its PTY and its only diagnostic output. */
export class ViewFailureReporter {
 readonly path:string;private dir:string;private recorded=false;
 constructor(serverDir:string,viewIdentity:string){this.dir=serverDir;this.path=join(serverDir,'view-failure-'+identityName(viewIdentity)+'.json');}
 async record(phase:string,error:unknown):Promise<void>{
  if(this.recorded)return;this.recorded=true;
  const verify=async()=>{const info=await lstat(this.dir);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe view failure directory');await restrict(this.dir,false);};
  await verify();
  try{const info=await lstat(this.path);if(!info.isFile()||info.isSymbolicLink())throw new Error('Unsafe view failure receipt');await restrict(this.path,false);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const message=error instanceof Error?error.message:'Inspector failed';
  await atomicWrite(this.path,JSON.stringify({phase:phase.slice(0,128),error:message.slice(0,512),pid:process.pid,at:Date.now()})+'\n',0o600,verify);
 }
}
