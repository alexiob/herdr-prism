import {opendir,realpath,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import type {Message,SessionEvidence} from '../model/types.ts';
import {EvidenceBuilder,hash} from './common.ts';
import type {ChildLink} from './common.ts';
import {CodexAdapter} from './codex.ts';
import {ClaudeAdapter} from './claude.ts';
import {PiAdapter} from './pi.ts';
import {JsonlTail} from './tail.ts';
import {metadata} from './metadata.ts';
import {TodoList} from '../content/todo.ts';
import type {TodoState} from '../content/todo.ts';
import {ReferenceHistory} from './reference-history.ts';
import type {ReferenceState} from './reference-history.ts';
export interface ProviderIndexOptions {codexHome?:string;claudeHome?:string;piHome?:string;maxRecordBytes?:number;maxMessages?:number;maxSessions?:number;directoryScanMs?:number;}
export interface ActiveSessionRef {provider:string;kind:'id'|'path';value:string;}
type Entry={provider:string;path:string;tail:JsonlTail;adapter:EvidenceBuilder;missing?:string;metadata?:EvidenceBuilder;detailed?:boolean;snapshot?:SessionEvidence;snapshotAdapter?:EvidenceBuilder;snapshotKey?:string;snapshotVersion?:number;knownChildren?:ChildLink[];knownParent?:string;};
function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export class ProviderIndex {
 private roots:{provider:string;path:string}[];
 private entries=new Map<string,Entry>();private sessions=new Map<string,SessionEvidence>();private closed=false;private snapshotVersion=0;private assemblyKey?:string;private snapshots:readonly SessionEvidence[]=Object.freeze([]);
 private maxRecord:number;private maxMessages:number;private maxSessions:number;private queue:Promise<unknown>=Promise.resolve();
 private scanMs:number;private lastScan?:number;private inventory=new Map<string,string>();
 private activeRefs?:ActiveSessionRef[];private detailedRefs?:ActiveSessionRef[];
 private referenceHistory?:{key:string;reader:ReferenceHistory};
 private metadataIndex=new Map<string,{provider:string;builder:EvidenceBuilder}>();private scanRound=0;private metadataCache=new Map<string,{stamp:string;builder:EvidenceBuilder}>();private pathAliases=new Map<string,string>();
 diagnostics:string[]=[];
 constructor(options:ProviderIndexOptions={}) {this.maxRecord=Math.max(256,Math.min(options.maxRecordBytes??1024*1024,16*1024*1024));this.maxMessages=Math.max(1,Math.min(options.maxMessages??200,10000));this.maxSessions=Math.max(1,Math.min(options.maxSessions??2048,20000));this.scanMs=Math.max(0,options.directoryScanMs??5000);
 const codex=options.codexHome||process.env.CODEX_HOME||join(homedir(),'.codex');const claude=options.claudeHome||process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude');const pi=options.piHome||process.env.PI_CODING_AGENT_DIR||join(homedir(),'.pi','agent');
 this.roots=[{provider:'codex',path:join(codex,'sessions')},{provider:'codex',path:join(codex,'archived_sessions')},{provider:'claude',path:join(claude,'projects')},{provider:'pi',path:join(pi,'sessions')}];
 }
 private adapter(provider:string,path:string):EvidenceBuilder {return provider==='codex'?new CodexAdapter(provider,path,this.maxMessages):provider==='claude'?new ClaudeAdapter(path,this.maxMessages):new PiAdapter(provider,path,this.maxMessages);}
 private async canonical(provider:string,value:string):Promise<string> {const key=`${provider}:${resolve(value)}`;try{const path=await realpath(value);this.pathAliases.delete(key);this.pathAliases.set(key,path);while(this.pathAliases.size>4096)this.pathAliases.delete(this.pathAliases.keys().next().value!);return path;}catch(error){this.pathAliases.delete(key);throw error;}}
 private async metadata(provider:string,path:string):Promise<EvidenceBuilder> {const key=`${provider}:${path}`;try{const info=await stat(path,{bigint:true});if(!info.isFile())throw new Error('transcript is not a regular file');const stamp=`${info.dev}:${info.ino}:${info.birthtimeNs}:${info.mtimeNs}:${info.ctimeNs}:${info.size}`;const cached=this.metadataCache.get(key);if(cached?.stamp===stamp){this.metadataCache.delete(key);this.metadataCache.set(key,cached);return cached.builder;}const builder=await metadata(provider,path,this.maxRecord);this.metadataCache.delete(key);this.metadataCache.set(key,{stamp,builder});while(this.metadataCache.size>2048)this.metadataCache.delete(this.metadataCache.keys().next().value!);return builder;}catch(error){this.metadataCache.delete(key);throw error;}}
 private report(message:string):void {if(!this.diagnostics.includes(message))this.diagnostics.push(message);this.diagnostics=this.diagnostics.slice(-64);}
 setActiveRefs(refs:ActiveSessionRef[]):void {this.activeRefs=refs.filter(ref=>typeof ref.provider==='string'&&['id','path'].includes(ref.kind)&&typeof ref.value==='string').slice(0,2048).map(ref=>({...ref}));}
 setDetailedRefs(refs:ActiveSessionRef[]):void {this.detailedRefs=refs.filter(ref=>typeof ref.provider==='string'&&['id','path'].includes(ref.kind)&&typeof ref.value==='string').slice(0,128).map(ref=>({...ref}));}
 /** Existing callers receive detached mutable records. */
 async refresh():Promise<SessionEvidence[]> {return structuredClone(await this.refreshSnapshots()) as SessionEvidence[];}
 /** Read-only consumers may reuse deeply frozen snapshots without cloning unchanged bodies. */
 refreshSnapshots():Promise<readonly SessionEvidence[]> {const run=this.queue.then(()=>this.collect());this.queue=run.catch(()=>{});return run;}
 private snapshot(entry:Entry):SessionEvidence {const key=entry.detailed?`${entry.tail.fileId}:${entry.tail.generation}:${entry.tail.contentRevision}`:JSON.stringify([entry.adapter.evidence,this.children(entry)]);if(!entry.snapshot||entry.snapshotKey!==key||entry.detailed&&entry.snapshotAdapter!==entry.adapter){entry.snapshot=entry.adapter.snapshot();entry.snapshotAdapter=entry.adapter;entry.snapshotKey=key;entry.snapshotVersion=++this.snapshotVersion;}return entry.snapshot;}
 private children(entry:Entry):ChildLink[] {return !entry.detailed&&entry.knownParent===entry.adapter.evidence.id?entry.knownChildren??entry.adapter.children:entry.adapter.children;}
 private async collect():Promise<readonly SessionEvidence[]> {
 if(this.closed)return [];const scoped=this.activeRefs!==undefined||this.detailedRefs!==undefined;const refs=[...this.activeRefs??[],...this.detailedRefs??[]];let found=this.inventory;const rescan=this.lastScan===undefined||Date.now()-this.lastScan>=this.scanMs;
 if(rescan){found=new Map<string,string>();this.diagnostics=[];
 this.metadataIndex.clear();const requested=new Set(refs.map(ref=>ref.provider));const wanted=new Set(refs.filter(ref=>ref.kind==='id').map(ref=>`${ref.provider}:${ref.value}`));const exactPaths=new Set<string>();let generic=0;
 for(const ref of refs)if(ref.kind==='path'){try{const path=await this.canonical(ref.provider,ref.value);const builder=await this.metadata(ref.provider,path);if(builder.evidence.id){found.set(path,ref.provider);exactPaths.add(path);wanted.add(`${ref.provider}:${builder.evidence.id}`);this.metadataIndex.set(path,{provider:ref.provider,builder});}}catch{/* An unavailable exact ref is handled at resolution. */}}
 // No symlink directory traversal: provider home scans cannot escape into unrelated trees.
 const walk=async (path:string,provider:string,depth=0):Promise<void>=>{if(depth>64){this.report('session directory depth limit reached');return;}let files;try{files=await opendir(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.report(`${provider} home unavailable: ${(error as NodeJS.ErrnoException).code||'read error'}`);return;}
 for await(const file of files){const name=join(path,file.name);if(file.isDirectory())await walk(name,provider,depth+1);else if(file.isFile()&&file.name.endsWith('.jsonl')){try{const canonical=await realpath(name);
 if(scoped&&requested.has(provider)&&!this.metadataIndex.has(canonical)){const builder=await this.metadata(provider,canonical);const key=`${provider}:${builder.evidence.id}`;if(wanted.has(key)){found.set(canonical,provider);exactPaths.add(canonical);}if(this.metadataIndex.size<2048||wanted.has(key))this.metadataIndex.set(canonical,{provider,builder});else this.report('bounded metadata discovery index limit reached');}
 if(!found.has(canonical)&&generic<this.maxSessions){found.set(canonical,provider);generic++;}
 }catch{this.report(`${provider} transcript unavailable`);}}}};
 // Rotate the generic bootstrap across providers; exact refs have a separate guaranteed priority.
 const groups=['codex','claude','pi'];const shift=this.scanRound++%groups.length;const order=[...groups.slice(shift),...groups.slice(0,shift)];for(const provider of order)for(const root of this.roots.filter(root=>root.provider===provider))await walk(root.path,root.provider);
 let grew=true;while(grew){grew=false;for(const[path,entry]of this.metadataIndex){const e=entry.builder.evidence;const parent=e.parentId?`${e.parentProvider??entry.provider}:${e.parentId}`:undefined;if(parent&&wanted.has(parent)&&!wanted.has(`${entry.provider}:${e.id}`)){wanted.add(`${entry.provider}:${e.id}`);found.set(path,entry.provider);exactPaths.add(path);grew=true;}}}
 this.inventory=found;this.lastScan=Date.now();}
 for(const [path,entry] of this.entries)if(!found.has(path))entry.missing='transcript unavailable: ENOENT';
 for(const [path,provider] of found){if(this.closed)return [];let entry=this.entries.get(path);if(!entry){entry={provider,path,tail:new JsonlTail(this.maxRecord),adapter:this.adapter(provider,path)};this.entries.set(path,entry);}entry.missing=undefined;
 if(scoped&&(rescan||!entry.metadata)){try{entry.metadata=this.metadataIndex.get(path)?.builder??await this.metadata(provider,path);}catch(error){entry.missing=`transcript unavailable: ${(error as NodeJS.ErrnoException).code||'read error'}`;}}
 }
 const active=new Set<string>();
 if(!scoped)for(const path of found.keys())active.add(path);
 else {
 for(const ref of refs){let exactPath=ref.kind==='path'?resolve(ref.value):undefined;if(exactPath){try{exactPath=await this.canonical(ref.provider,exactPath);}catch{/* Unavailable exact path remains unavailable. */}}
 if(exactPath&&!this.entries.has(exactPath)){try{const builder=this.metadataIndex.get(exactPath)?.builder??await this.metadata(ref.provider,exactPath);if(builder.evidence.id)this.entries.set(exactPath,{provider:ref.provider,path:exactPath,adapter:builder,metadata:builder,tail:new JsonlTail(this.maxRecord),detailed:false});}catch{/* An unavailable exact source cannot acquire identity. */}}
 if(ref.kind==='id')for(const[path,header]of this.metadataIndex)if(header.provider===ref.provider&&header.builder.evidence.id===ref.value&&!this.entries.has(path))this.entries.set(path,{provider:ref.provider,path,adapter:header.builder,metadata:header.builder,tail:new JsonlTail(this.maxRecord),detailed:false});
 for(const entry of this.entries.values())if(entry.provider===ref.provider&&(ref.kind==='id'?(entry.metadata??entry.adapter).evidence.id===ref.value:entry.path===exactPath)){entry.missing=undefined;active.add(entry.path);}
 }
 }
 const detailed=this.detailedRefs===undefined?undefined:new Set<string>();for(const ref of this.detailedRefs??[]){let exactPath=ref.kind==='path'?resolve(ref.value):undefined;if(exactPath){try{exactPath=await this.canonical(ref.provider,exactPath);}catch{}}const selectedId=ref.kind==='id'?ref.value:exactPath?(this.entries.get(exactPath)?.metadata??this.entries.get(exactPath)?.adapter)?.evidence.id:undefined;for(const entry of this.entries.values())if(entry.provider===ref.provider&&selectedId&&(entry.metadata??entry.adapter).evidence.id===selectedId){detailed!.add(entry.path);active.add(entry.path);}}
 const readDetailed=async(entry:Entry)=>{if(!entry.detailed&&scoped){entry.adapter=this.adapter(entry.provider,entry.path);entry.tail=new JsonlTail(this.maxRecord);}entry.detailed=true;
 try{await entry.tail.read(entry.path,r=>entry.adapter instanceof CodexAdapter?entry.adapter.consume(r):entry.adapter instanceof ClaudeAdapter?entry.adapter.consume(r):(entry.adapter as PiAdapter).consume(r),()=>{entry.adapter=this.adapter(entry.provider,entry.path);},d=>entry.adapter.diagnostic(d));entry.knownChildren=entry.adapter.children;entry.knownParent=entry.adapter.evidence.id;}catch(error){entry.missing=`transcript unavailable: ${(error as NodeJS.ErrnoException).code||'read error'}`;}};
 const read=new Set<string>();let changed=true;
 while(changed){changed=false;
 for(const path of active){const entry=this.entries.get(path);if(entry&&!read.has(path)&&!entry.missing){if(detailed===undefined||detailed.has(path))await readDetailed(entry);read.add(path);}}
 const keys=new Set([...active].map(path=>{const entry=this.entries.get(path)!;return `${entry.provider}:${entry.adapter.evidence.id}`;}));
 // Paired spawn results can identify a child absent from the capped generic bootstrap.
 for(const[path,header]of this.metadataIndex){if(this.entries.has(path))continue;const e=header.builder.evidence;const parent=e.parentId?`${e.parentProvider??header.provider}:${e.parentId}`:undefined;const linked=[...active].some(ownerPath=>{const owner=this.entries.get(ownerPath)!;return this.children(owner).some(child=>(child.provider??owner.provider)===header.provider&&child.id===e.id);});if(parent&&keys.has(parent)||linked){this.entries.set(path,{provider:header.provider,path,tail:new JsonlTail(this.maxRecord),adapter:header.builder,metadata:header.builder,detailed:false});active.add(path);changed=true;}}
 for(const entry of this.entries.values()){if(entry.missing||active.has(entry.path))continue;const evidence=(entry.metadata??entry.adapter).evidence;const parent=evidence.parentId?`${evidence.parentProvider??entry.provider}:${evidence.parentId}`:undefined;
 const linked=[...active].some(path=>{const owner=this.entries.get(path)!;return this.children(owner).some(child=>(child.provider??owner.provider)===entry.provider&&child.id===evidence.id);});
 if(parent&&keys.has(parent)||linked){active.add(entry.path);changed=true;}}
 }
 if(scoped)for(const entry of this.entries.values())if(!active.has(entry.path)||detailed!==undefined&&!detailed.has(entry.path)){if(entry.detailed){entry.snapshot=undefined;entry.snapshotAdapter=undefined;}entry.adapter=entry.metadata??this.adapter(entry.provider,entry.path);entry.detailed=false;entry.tail=new JsonlTail(this.maxRecord);}
 let knownLinks=[...this.entries.values()].reduce((sum,entry)=>sum+(entry.knownChildren?.length??0),0);for(const entry of this.entries.values())if(knownLinks>2048&&!entry.detailed&&entry.knownChildren?.length){const remove=Math.min(entry.knownChildren.length,knownLinks-2048);entry.knownChildren=entry.knownChildren.slice(remove);knownLinks-=remove;this.report('bounded previously observed lineage limit reached');}
 const valid=[...this.entries.values()].filter(entry=>!entry.missing&&entry.adapter.evidence.id);for(const entry of valid)this.snapshot(entry);const assemblyKey=hash(JSON.stringify(valid.map(entry=>[entry.path,entry.snapshotVersion])));if(this.assemblyKey===assemblyKey)return this.snapshots;
 const sessions=new Map<string,SessionEvidence>();const revisions=new Map<string,unknown[]>();
 // Entry snapshots already own detached message/tool bodies. Assembly changes wrappers and
 // replaces merge arrays; sharing those immutable bodies avoids copying the hot window twice.
 for(const entry of valid){const evidence={...entry.snapshot!};const key=`${entry.provider}:${evidence.id}`;const sources=revisions.get(key)??[];sources.push([entry.path,entry.snapshotVersion]);revisions.set(key,sources);const old=sessions.get(key);if(old){const newer=(evidence.lastActivity??0)>(old.lastActivity??0)?evidence:old;const older=newer===old?evidence:old;
 const merge=<T extends {id:string;timestamp?:number}>(a:T[],b:T[])=>[...new Map([...a,...b].map(item=>[item.id,item])).values()].sort((a,b)=>(a.timestamp??0)-(b.timestamp??0)).slice(-this.maxMessages);
 newer.initialRequest=[older.initialRequest,newer.initialRequest].filter((message):message is Message=>message!==undefined).sort((a,b)=>(a.timestamp??Infinity)-(b.timestamp??Infinity))[0];newer.messages=merge(older.messages,newer.messages);newer.tools=merge(older.tools,newer.tools);newer.usage=merge(older.usage,newer.usage);newer.goals=merge(older.goals,newer.goals);newer.diagnostics=[...new Set([...(old.diagnostics??[]),...(evidence.diagnostics??[])])];sessions.set(key,newer);}else sessions.set(key,evidence);}
 for(const entry of this.entries.values()){if(entry.missing)continue;for(const child of this.children(entry)){const key=`${child.provider||entry.provider}:${child.id}`;const target=sessions.get(key);if(!target)continue;const parent=entry.adapter.evidence.id;revisions.get(key)?.push([parent,entry.provider,child.task,child.source]);if(target.parentId&&target.parentId!==parent&&!(entry.adapter instanceof ClaudeAdapter&&target.parentId===(entry.adapter.directoryParent??parent))){target.diagnostics=[...(target.diagnostics??[]),`conflicting explicit parent link from ${parent} at ${child.source}; retained parent ${target.parentId} at ${target.parentSource??'source unavailable'}`].slice(-64);target.availability='partial';continue;}target.parentId=parent;target.parentProvider=entry.provider;target.parentSource=child.source;target.task=child.task||target.task;}}
 if(this.closed)return [];for(const[key,evidence]of sessions){evidence.contentRevision=hash(JSON.stringify(revisions.get(key)));const old=this.sessions.get(key);sessions.set(key,old?.contentRevision===evidence.contentRevision?old:freeze(evidence));}this.sessions=sessions;this.assemblyKey=assemblyKey;this.snapshots=Object.freeze([...sessions.values()]);let genericCount=[...this.entries.keys()].filter(path=>!active.has(path)).length;for(const path of this.entries.keys())if(genericCount>this.maxSessions&&!active.has(path)){this.entries.delete(path);genericCount--;}return this.snapshots;
 }
 resolveSnapshotCached(provider:string,ref:{kind:'id'|'path';value:string}):SessionEvidence|undefined {if(this.closed)return;if(ref.kind==='id'){const known=this.sessions.get(`${provider}:${ref.value}`);if(known)return known;for(const entry of this.entries.values())if(entry.provider===provider&&entry.missing&&entry.adapter.evidence.id===ref.value)return freeze({...this.snapshot(entry),availability:'unavailable',reason:entry.missing});return;}const entry=this.entries.get(this.pathAliases.get(`${provider}:${resolve(ref.value)}`)??resolve(ref.value));if(!entry||entry.provider!==provider)return;const evidence=this.sessions.get(`${provider}:${entry.adapter.evidence.id}`)||this.snapshot(entry);return entry.missing?freeze({...evidence,availability:'unavailable',reason:entry.missing}):freeze(evidence);}
 resolveCached(provider:string,ref:{kind:'id'|'path';value:string}):SessionEvidence|undefined {const evidence=this.resolveSnapshotCached(provider,ref);return evidence?structuredClone(evidence):undefined;}
 async resolve(provider:string,ref:{kind:'id'|'path';value:string}):Promise<SessionEvidence|undefined>{if(this.closed)return;await this.refresh();if(ref.kind==='id')return this.resolveCached(provider,ref);
 let path:string;try{path=await this.canonical(provider,ref.value);}catch{path=resolve(ref.value);}const entry=this.entries.get(path);if(!entry||entry.provider!==provider)return;const evidence=this.sessions.get(`${provider}:${entry.adapter.evidence.id}`)||entry.adapter.snapshot();return {...structuredClone(evidence),...(entry.missing?{availability:'unavailable' as const,reason:entry.missing}:{})};}
 /** Bounded, on-demand historical paging. Reparse disk with only a sliding page in memory. */
 async page(provider:string,ref:{kind:'id'|'path';value:string},options:{beforeId?:string;limit?:number}={}):Promise<Message[]> {
 if(this.closed)return [];const evidence=await this.resolve(provider,ref);if(!evidence||evidence.availability==='unavailable'||!evidence.path)return [];
 const count=Math.max(1,Math.min(options.limit??50,200));let window:Message[]=[];let found=false;
 const files=[...this.entries.values()].filter(entry=>!entry.missing&&entry.provider===provider&&entry.adapter.evidence.id===evidence.id).sort((a,b)=>(a.adapter.evidence.startedAt??0)-(b.adapter.evidence.startedAt??0)||a.path.localeCompare(b.path));
 for(const file of files){const adapter=this.adapter(provider,file.path);adapter.max=count+1;const tail=new JsonlTail(this.maxRecord);let selected:Message[]|undefined;
 const consume=(entry:import('./tail.ts').TailRecord)=>{if(selected)return;if(adapter instanceof CodexAdapter)adapter.consume(entry);else if(adapter instanceof ClaudeAdapter)adapter.consume(entry);else (adapter as PiAdapter).consume(entry);if(options.beforeId&&adapter.messages.get(options.beforeId)?.complete===true){selected=[...adapter.messages.values()].filter(m=>m.id!==options.beforeId).slice(-count);found=true;}};
 try{await tail.read(file.path,consume,()=>{},()=>{});}catch{continue;}
 const latest=selected??[...adapter.messages.values()].slice(-count);window=[...new Map([...window,...latest].map(m=>[m.id,m])).values()].sort((a,b)=>(a.timestamp??0)-(b.timestamp??0)).slice(-count);if(found)break;
 }
 if(options.beforeId&&!found)return [];return structuredClone(window);
 }
 async readMessage(provider:string,ref:{kind:'id'|'path';value:string},id:string):Promise<Message|undefined> {
 if(this.closed)return;const evidence=await this.resolve(provider,ref);if(!evidence?.path||evidence.availability==='unavailable')return;let selected:Message|undefined;
 const files=[...this.entries.values()].filter(entry=>!entry.missing&&entry.provider===provider&&entry.adapter.evidence.id===evidence.id).sort((a,b)=>Number(a.path===evidence.path)-Number(b.path===evidence.path));
 for(const file of files){const adapter=this.adapter(provider,file.path);adapter.max=2;const tail=new JsonlTail(this.maxRecord);try{await tail.read(file.path,entry=>{if(adapter instanceof CodexAdapter)adapter.consume(entry);else if(adapter instanceof ClaudeAdapter)adapter.consume(entry);else (adapter as PiAdapter).consume(entry);if(adapter.messages.has(id))selected=structuredClone(adapter.messages.get(id));},()=>{},()=>{});}catch{continue;}}return selected;
 }
 /** Explicit opt-in caller hydrates ACTION state once; no historical body is persisted. */
 async readTodoState(provider:string,ref:{kind:'id'|'path';value:string}):Promise<TodoState|undefined> {
 if(this.closed)return;const evidence=await this.resolve(provider,ref);if(!evidence?.path||evidence.availability==='unavailable')return;
 const todo=new TodoList();const files=[...this.entries.values()].filter(entry=>!entry.missing&&entry.provider===provider&&entry.adapter.evidence.id===evidence.id).sort((a,b)=>(a.adapter.evidence.startedAt??0)-(b.adapter.evidence.startedAt??0)||a.path.localeCompare(b.path));let available=false;
 for(const file of files){const adapter=this.adapter(provider,file.path);adapter.max=2;const tail=new JsonlTail(this.maxRecord);try{await tail.read(file.path,record=>{if(adapter instanceof CodexAdapter)adapter.consume(record);else if(adapter instanceof ClaudeAdapter)adapter.consume(record);else (adapter as PiAdapter).consume(record);todo.update([...adapter.messages.values()]);},()=>{},message=>{todo.diagnostics.push(message);todo.diagnostics=todo.diagnostics.slice(-64);});available=true;}catch{/* All files unavailable yields undefined rather than an inferred empty list. */}}
 return available?todo.toJSON():undefined;
 }
 async readReferences(provider:string,ref:{kind:'id'|'path';value:string},isCurrent:()=>boolean=()=>true):Promise<ReferenceState|undefined>{
  if(this.closed||!isCurrent())return;const evidence=this.resolveSnapshotCached(provider,ref);if(!evidence?.path||evidence.availability==='unavailable')return;
  const key=`${provider}:${evidence.id}`;if(this.referenceHistory?.key!==key){this.referenceHistory?.reader.close();this.referenceHistory={key,reader:new ReferenceHistory(provider,this.maxRecord)};}
  const files=[...this.entries.values()].filter(entry=>entry.provider===provider&&entry.adapter.evidence.id===evidence.id).sort((a,b)=>(a.adapter.evidence.startedAt??0)-(b.adapter.evidence.startedAt??0)||a.path.localeCompare(b.path)).map(entry=>entry.path);
  return this.referenceHistory.reader.read(files,()=>!this.closed&&isCurrent());
 }
 close():void {this.closed=true;this.referenceHistory?.reader.close();this.referenceHistory=undefined;this.entries.clear();this.sessions.clear();this.inventory.clear();this.metadataIndex.clear();this.metadataCache.clear();this.pathAliases.clear();this.snapshots=Object.freeze([]);this.assemblyKey=undefined;}
}
