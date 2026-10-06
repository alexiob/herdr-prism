import {mkdtemp,rm} from 'node:fs/promises';
import {restrict} from '../../src/config/safe-file.ts';
/** Secure only the new directory returned by this exact mkdtemp call. Never
 * change the ACL of its existing parent or of another test/user directory. */
export async function freshPrivateDirectory(prefix:string):Promise<string>{
 const directory=await mkdtemp(prefix);
 try{await restrict(directory,true);return directory;}
 catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
