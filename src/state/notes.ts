import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicWrite,privateDir,restrict} from '../config/safe-file.ts';
import {StateStore,identityName} from './store.ts';

export const noteLimit=1024*1024;
export interface NoteSnapshot {text:string;revision:string|null;path:string;}
export interface NoteSave extends NoteSnapshot {conflict:boolean;}
interface PlaceholderAdoption {sourceRevision:string;canonicalKey:string;state:'reserved'|'complete';reservedAt:number;}
interface PlaceholderJournal {version:1;sourceKey:string;revisions:PlaceholderAdoption[];}
const revision=(text:string)=>createHash('sha256').update(text).digest('hex');
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Server-local Markdown, outside release checkouts and provider transcripts. */
export class NotesStore {
  readonly serverDir:string;
  constructor(serverDir:string){this.serverDir=serverDir;}
  private async directory(key:string){
    if(!key||key.length>8192)throw new Error('Invalid note identity');
    // An inspector must not resurrect state after complete removal.
    const root=await lstat(this.serverDir);
    if(!root.isDirectory()||root.isSymbolicLink())throw new Error('Unsafe Notes server directory');
    await restrict(this.serverDir,false);
    const parent=join(this.serverDir,'notes');await privateDir(parent);
    const dir=join(parent,identityName(key));await privateDir(dir);return dir;
  }
  private async read(path:string):Promise<NoteSnapshot>{
    let info;try{info=await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return{text:'',revision:null,path};throw error;}
    if(!info.isFile()||info.isSymbolicLink())throw new Error('Unsafe Notes file');
    if(info.size>noteLimit)throw new Error('Notes exceed 1 MiB limit');
    await restrict(path,false);
    const file=await open(path,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
    try{const actual=await file.stat();if(!actual.isFile()||actual.ino!==info.ino||actual.size>noteLimit)throw new Error('Notes changed during read');
      const text=await file.readFile('utf8');if(Buffer.byteLength(text)>noteLimit)throw new Error('Notes exceed 1 MiB limit');return{text,revision:revision(text),path};
    }finally{await file.close();}
  }
  async load(key:string):Promise<NoteSnapshot>{return this.read(join(await this.directory(key),'note.md'));}
  /** Copy an exact bound-terminal placeholder once; retain the source as a backup. */
  async adoptOwnPlaceholder(identity:{provider:string;terminalId:string;canonicalKey:string}):Promise<boolean>{
    const {provider,terminalId,canonicalKey}=identity;
    if(!['codex','claude','pi'].includes(provider)||typeof terminalId!=='string'||!terminalId||terminalId.length>4096||typeof canonicalKey!=='string'||!canonicalKey.startsWith(provider+':')||canonicalKey.length<=provider.length+1||canonicalKey.slice(provider.length+1).startsWith('pane-'))return false;
    const sourceKey=`${provider}:pane-${terminalId}`,sourceDir=join(this.serverDir,'notes',identityName(sourceKey));
    try{const info=await lstat(sourceDir);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe placeholder Notes directory');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
    const safeSource=await this.directory(sourceKey),sourcePath=join(safeSource,'note.md');
    if((await this.read(sourcePath)).revision===null)return false;
    const targetDir=await this.directory(canonicalKey),targetPath=join(targetDir,'note.md');
    const leases:Awaited<ReturnType<StateStore['acquire']>>[]=[];let temporary:string|undefined;
    try{
      for(const directory of [safeSource,targetDir].sort()){
        const lock=new StateStore(directory);
        for(let attempt=0;;attempt++)try{leases.push(await lock.acquire({create:false}));break;}catch(error){const e=error as NodeJS.ErrnoException;if(attempt>=40||!(/live or uncertain|initialization in progress|recovery in progress|now owns/.test(e.message)||e.code==='ENOENT'&&e.path===join(directory,'collector.lock')))throw error;await sleep(25);}
      }
      const source=await this.read(sourcePath);if(source.revision===null)return false;
      const journalPath=join(safeSource,'placeholder-adoptions.json');let journalSnapshot=await this.read(journalPath);
      const journal:PlaceholderJournal=journalSnapshot.revision===null?{version:1,sourceKey,revisions:[]}:JSON.parse(journalSnapshot.text);
      if(journal?.version!==1||journal.sourceKey!==sourceKey||!Array.isArray(journal.revisions)||journal.revisions.length>128||journal.revisions.some(entry=>!entry||typeof entry.sourceRevision!=='string'||!/^[a-f0-9]{64}$/.test(entry.sourceRevision)||typeof entry.canonicalKey!=='string'||entry.canonicalKey.length>8192||!entry.canonicalKey.startsWith(provider+':')||entry.canonicalKey.length<=provider.length+1||entry.canonicalKey.slice(provider.length+1).startsWith('pane-')||!['reserved','complete'].includes(entry.state)||!Number.isFinite(entry.reservedAt)||entry.reservedAt<0)||new Set(journal.revisions.map(entry=>entry.sourceRevision)).size!==journal.revisions.length)throw new Error('Invalid placeholder Notes adoption journal');
      const writeJournal=async()=>{
        const body=JSON.stringify(journal)+'\n';if(Buffer.byteLength(body)>noteLimit)throw new Error('Placeholder Notes adoption journal exceeds limit');
        await atomicWrite(journalPath,body,0o600,async()=>{if((await this.read(journalPath)).revision!==journalSnapshot.revision)throw new Error('Placeholder Notes adoption journal changed externally');await lstat(this.serverDir);});
        journalSnapshot=await this.read(journalPath);
      };
      let adoption=journal.revisions.find(entry=>entry.sourceRevision===source.revision);
      if(adoption&&adoption.canonicalKey!==canonicalKey)return false;
      const target=await this.read(targetPath);
      if(target.revision!==null){
        // A crash after exclusive publication needs only the source receipt
        // finalized. Never replace an existing canonical note, including empty.
        if(adoption?.state==='reserved'&&target.revision===source.revision){adoption.state='complete';await writeJournal();}
        return false;
      }
      if(adoption?.state==='complete')return false;
      if(!adoption){
        if(journal.revisions.length>=128)throw new Error('Placeholder Notes adoption journal is full');
        adoption={sourceRevision:source.revision,canonicalKey,state:'reserved',reservedAt:Date.now()};journal.revisions.push(adoption);
        // Reserve before publishing: after an interruption only this exact
        // canonical conversation may resume this source revision's adoption.
        await writeJournal();
      }
      temporary=join(targetDir,'adopt-'+randomUUID()+'.md');
      await atomicWrite(temporary,source.text,0o600,async()=>{if((await this.read(sourcePath)).revision!==source.revision)throw new Error('Placeholder Notes changed during adoption');await lstat(this.serverDir);});
      // A hard link publishes the completed private copy atomically and refuses
      // even an empty canonical file created outside our cooperating locks.
      try{await link(temporary,targetPath);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return false;throw error;}
      await restrict(targetPath,false);
      await atomicWrite(join(targetDir,'placeholder-adoption.json'),JSON.stringify({sourceKey,canonicalKey,sourceRevision:source.revision,adoptedAt:Date.now(),sourceRetained:true})+'\n',0o600,async()=>{await lstat(this.serverDir);});
      adoption.state='complete';await writeJournal();return true;
    }finally{
      let cleanupError:unknown;
      if(temporary)try{await unlink(temporary);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')cleanupError=error;}
      for(const lease of leases.reverse())try{await lease.release();}catch(error){cleanupError??=error;}
      if(cleanupError)throw cleanupError;
    }
  }
  async save(key:string,text:string,expected:string|null,recovery?:NoteSnapshot):Promise<NoteSave>{
    if(Buffer.byteLength(text)>noteLimit)throw new Error('Notes exceed 1 MiB limit');
    const dir=await this.directory(key),lock=new StateStore(dir);let lease:Awaited<ReturnType<StateStore['acquire']>>|undefined;
    // Serialize cooperating panels. Exact live/uncertain ownership is never reclaimed.
    for(let attempt=0;;attempt++){try{lease=await lock.acquire({create:false});break;}catch(error){const e=error as NodeJS.ErrnoException;if(attempt>=40||!(/live or uncertain|initialization in progress|recovery in progress|now owns/.test(e.message)||e.code==='ENOENT'&&e.path===join(dir,'collector.lock')))throw error;await sleep(25);}}
    try{
      const current=await this.read(join(dir,'note.md'));
      const conflict=!!recovery||current.revision!==expected;
      const target=conflict?(recovery?.path??join(dir,'recovery-'+randomUUID()+'.md')):current.path;
      if(recovery&&!/^recovery-[a-f0-9-]{36}\.md$/.test(target.slice(dir.length+1))||recovery&&!target.startsWith(dir+'/')&&!target.startsWith(dir+'\\'))throw new Error('Invalid recovery draft');
      const previous=conflict?await this.read(target):current;
      if(recovery&&previous.revision!==recovery.revision)throw new Error('Recovery draft changed externally');
      await atomicWrite(target,text,0o600,async()=>{
        if((await this.read(target)).revision!==previous.revision)throw new Error('Notes changed during save; retry');
        await lstat(this.serverDir);
      });
      return{text,revision:revision(text),path:target,conflict};
    }finally{await lease.release();}
  }
}
