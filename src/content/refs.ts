import {stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Message} from '../model/types.ts';
import {outsideFences,safeText} from './text.ts';
export interface ReferenceCursor {provider:string;sessionId:string;path:string;fileId:string;offset:number;hash:string;file:number;timestamp?:number;}
export interface RefSource {messageId:string;source?:string;timestamp?:number;edited?:boolean;cursor?:ReferenceCursor;}
export interface ContentRef {id:string;target:string;line?:number;messageId:string;edited:boolean;exists?:boolean;kind:'file'|'directory'|'url';source?:string;cursor?:ReferenceCursor;sources:RefSource[];}
export type ReferenceTarget=Pick<ContentRef,'id'|'target'|'line'|'kind'>;
export interface ReferenceListOptions {retain?:number;accept?:(ref:ReferenceTarget)=>boolean;acceptEdit?:(file:string)=>boolean;onMention?:(ref:ReferenceTarget,source:RefSource)=>void;cursor?:(message:Message)=>ReferenceCursor|undefined;}
export const referenceMessageHash=(message:Message)=>createHash('sha256').update(JSON.stringify([message.id,message.role,message.kind,message.text,message.cwd,message.complete])).digest('hex');
export const compareReferenceCursors=(a:ReferenceCursor,b:ReferenceCursor)=>(a.timestamp??0)-(b.timestamp??0)||a.file-b.file||a.offset-b.offset;
const sourceKey=(source:RefSource)=>source.messageId+'\0'+(source.cursor?.hash??'');
const windows=(p:string)=>/^(?:[A-Za-z]:[\\/]|\\\\)/.test(p);
function target(raw:string,cwd?:string):{target:string;line?:number;kind:'file'|'url'}|undefined {
 let value=raw.trim().replace(/^<|>$/g,'');if(!value||/[\x00-\x08\x0b-\x1f\x7f]|\x1b/.test(value)||value.length>4096)return;
 if(/^https?:\/\//i.test(value)){try{const url=new URL(value);if(url.username||url.password)return;return {target:url.href,kind:'url'};}catch{return;}}
 if(/^[a-z][a-z\d+.-]*:/i.test(value)&&!windows(value))return;
 if(/[|;&$]/.test(value))return;
 let line:number|undefined;const suffix=/(?::(\d+)(?::\d+)?|#L(\d+))$/.exec(value);if(suffix){line=Number(suffix[1]||suffix[2]);if(!Number.isSafeInteger(line)||line<1)return;value=value.slice(0,suffix.index);}
 const api=windows(value)||cwd!==undefined&&windows(cwd)?path.win32:path;if(!api.isAbsolute(value)&&!cwd)return;return {target:api.isAbsolute(value)?api.normalize(value):api.resolve(cwd!,value),line,kind:'file'};
}
/** Streaming metadata only: retained references do not depend on the message window. */
export class ReferenceList {
 private refs=new Map<string,ContentRef>();private edited=new Set<string>();private seen=new Map<string,string>();private cwd?:string;
 limited=false;inputLimited=false;revision=0;
 private options:ReferenceListOptions;
 constructor(cwd?:string,options:ReferenceListOptions={}){this.cwd=cwd;this.options=options;}
 private edit(file:string):void {if(this.edited.has(file))return;this.edited.add(file);this.revision++;if(this.edited.size>2000){this.edited.delete(this.edited.values().next().value!);this.limited=true;}for(const ref of this.refs.values())if(ref.target===file){ref.edited=true;for(const source of ref.sources)source.edited=true;}}
 private add(normalized:{target:string;line?:number;kind:ContentRef['kind']},source:RefSource,edited=false):void {
  const key=normalized.target+'\0'+(normalized.line??''),id=createHash('sha256').update(key).digest('hex').slice(0,24);const ref={id,...normalized};this.options.onMention?.(ref,source);if(this.options.retain===0||this.options.accept&&!this.options.accept(ref))return;const earlier=this.refs.get(key);
  const sources=earlier?.sources??[];const at=sources.findIndex(s=>sourceKey(s)===sourceKey(source)),duplicate=at>=0;
  const isEdited=edited||earlier?.edited===true||this.edited.has(normalized.target);
  if(!duplicate||isEdited!==earlier?.edited)this.revision++;
  if(!duplicate)sources.push({...source,edited:isEdited});
  else if(source.cursor&&sources[at]?.cursor&&compareReferenceCursors(source.cursor,sources[at]!.cursor!)>0){sources[at]={...source,edited:isEdited};this.revision++;}
  if(sources.length>100){sources.splice(1,sources.length-100);this.limited=true;}
  const previousTime=earlier?.cursor?.timestamp??earlier?.sources.find(s=>s.messageId===earlier.messageId)?.timestamp;
  const newer=!earlier||(source.cursor&&earlier.cursor?compareReferenceCursors(source.cursor,earlier.cursor)>0:!duplicate&&!(source.timestamp!==undefined&&previousTime!==undefined&&source.timestamp<previousTime));
  if(newer){this.refs.delete(key);this.refs.set(key,{id,...normalized,messageId:source.messageId,source:source.source,cursor:source.cursor,edited:isEdited,sources});}
  else if(earlier){earlier.edited=isEdited;earlier.sources=sources;}
  if(this.refs.size>(this.options.retain??2000)){this.refs.delete(this.refs.keys().next().value!);this.limited=true;}
 }
 updateEdits(files:Iterable<string>,cwd?:string):void {if(this.options.retain===0)return;for(const file of files){const normalized=target(file,cwd||this.cwd);if(normalized&&(!this.options.acceptEdit||this.options.acceptEdit(normalized.target)))this.edit(normalized.target);}}
 update(messages:Message[]):void {
 for(const message of messages)for(const tool of message.tools??[])if(tool.status==='done')this.updateEdits(tool.editedPaths??[],message.cwd);
 for(const message of messages){if(message.kind==='inter-agent'||message.role!=='assistant'||message.complete!==true)continue;
 // Every supported reference contains a slash, backtick, or Markdown opening bracket.
 // Check before Unicode/prose scans; sanitization may join delimiters but cannot create these characters.
 const body=message.text.slice(0,1024*1024);if(!body.includes('/')&&!body.includes('`')&&!body.includes('['))continue;
 const signature=createHash('sha256').update(JSON.stringify([body,message.cwd??this.cwd,message.source,message.timestamp])).digest('hex');
 if(this.seen.get(message.id)===signature)continue;this.seen.delete(message.id);this.seen.set(message.id,signature);while(this.seen.size>256)this.seen.delete(this.seen.keys().next().value!);
 const text=outsideFences(body);const candidates:string[]=[];
 for(const m of text.matchAll(/\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/gu))candidates.push(m[1]!);
 const withoutLinks=text.replace(/\[[^\]\n]*\]\([^\n]*?\)/gu,'');
 for(const m of withoutLinks.matchAll(/`([^`\n]+)`/gu))if(/[\\/]|\.[\p{L}\d]{1,12}(?::\d+|#L\d+)?$/u.test(m[1]!))candidates.push(m[1]!);
 for(const m of withoutLinks.replace(/`[^`]*`/g,'').matchAll(/https?:\/\/[^\s<>"`]+/gu))candidates.push(m[0].replace(/[.,;!?]+$/,''));
 const prose=withoutLinks.replace(/`[^`]*`|https?:\/\/[^\s<>"`]+/gu,'');
 for(const m of prose.matchAll(/(?:^|[\s([])((?:\.\.?\/|\/)?[\p{L}\p{N}_@.-]+(?:\/[\p{L}\p{N}_@.-]+)+(?::\d+(?::\d+)?|#L\d+)?)/gu))candidates.push(m[1]!.replace(/[.,;!?]+$/,''));
 if(candidates.length>500||message.text.length>body.length){this.limited=true;this.inputLimited=true;}
 let cursor:ReferenceCursor|undefined,cursorComputed=false;for(const raw of candidates.slice(0,500)){const normalized=target(raw,message.cwd||this.cwd);if(normalized){if(!cursorComputed){cursor=this.options.cursor?.(message);cursorComputed=true;}this.add(normalized,{messageId:message.id,source:message.source,timestamp:message.timestamp,cursor});}}
 }
 }
 merge(other:ReferenceList):void {
  this.limited ||= other.limited;this.inputLimited ||= other.inputLimited;for(const file of other.edited)this.edit(file);
  const records=[...other.refs.values()].flatMap(ref=>ref.sources.map(source=>({ref,source})));
  records.sort((a,b)=>(a.source.timestamp??0)-(b.source.timestamp??0)||Number(a.source.source?.split('#').at(-1)||0)-Number(b.source.source?.split('#').at(-1)||0));
  for(const {ref,source}of records)this.add(ref,source,ref.edited);
 }
 async snapshot(isCurrent:()=>boolean=()=>true):Promise<ContentRef[]|undefined> {
  if(!isCurrent())return;const result=structuredClone([...this.refs.values()].reverse());result.sort((a,b)=>a.cursor&&b.cursor?compareReferenceCursors(b.cursor,a.cursor):0);let next=0;
  const worker=async()=>{while(next<result.length&&isCurrent()){const ref=result[next++]!;if(ref.kind==='url')continue;try{const info=await stat(ref.target);ref.exists=true;if(info.isDirectory())ref.kind='directory';}catch{ref.exists=false;}}};
  await Promise.all(Array.from({length:Math.min(4,result.length)},worker));return isCurrent()?result:undefined;
 }
}
/** Local stat only; no URL requests. Results group naturally under the latest source message. */
export async function extractRefs(messages:Message[],cwd?:string,isCurrent:()=>boolean=()=>true):Promise<ContentRef[]> {
 if(!isCurrent())return[];const list=new ReferenceList(cwd);list.update(messages);return await list.snapshot(isCurrent)??[];
}
