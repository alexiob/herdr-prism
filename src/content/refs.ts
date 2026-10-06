import {stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Message} from '../model/types.ts';
import {outsideFences,safeText} from './text.ts';
export interface RefSource {messageId:string;source?:string;timestamp?:number;edited?:boolean;}
export interface ContentRef {id:string;target:string;line?:number;messageId:string;edited:boolean;exists?:boolean;kind:'file'|'directory'|'url';source?:string;sources:RefSource[];}
const windows=(p:string)=>/^(?:[A-Za-z]:[\\/]|\\\\)/.test(p);
function target(raw:string,cwd?:string):{target:string;line?:number;kind:'file'|'url'}|undefined {
 let value=raw.trim().replace(/^<|>$/g,'');if(!value||/[\x00-\x08\x0b-\x1f\x7f]|\x1b/.test(value)||value.length>4096)return;
 if(/^https?:\/\//i.test(value)){try{const url=new URL(value);if(url.username||url.password)return;return {target:url.href,kind:'url'};}catch{return;}}
 if(/^[a-z][a-z\d+.-]*:/i.test(value)&&!windows(value))return;
 if(/[|;&$]/.test(value))return;
 let line:number|undefined;const suffix=/(?::(\d+)(?::\d+)?|#L(\d+))$/.exec(value);if(suffix){line=Number(suffix[1]||suffix[2]);if(!Number.isSafeInteger(line)||line<1)return;value=value.slice(0,suffix.index);}
 const api=windows(value)||cwd!==undefined&&windows(cwd)?path.win32:path;if(!api.isAbsolute(value)&&!cwd)return;return {target:api.isAbsolute(value)?api.normalize(value):api.resolve(cwd!,value),line,kind:'file'};
}
/** Local stat only; no URL requests. Results group naturally under the latest source message. */
export async function extractRefs(messages:Message[],cwd?:string):Promise<ContentRef[]> {
 const refs=new Map<string,ContentRef>();const edited=new Set<string>();
 for(const message of messages)for(const tool of message.tools??[])if(tool.status==='done')for(const file of tool.editedPaths??[]){const normalized=target(file,message.cwd||cwd);if(normalized)edited.add(normalized.target);}
 for(const message of messages){if(message.kind==='inter-agent'||message.role!=='assistant'||message.complete!==true)continue;
 // Every supported reference contains a slash, backtick, or Markdown opening bracket.
 // Check before Unicode/prose scans; sanitization may join delimiters but cannot create these characters.
 const body=message.text.slice(0,1024*1024);if(!body.includes('/')&&!body.includes('`')&&!body.includes('['))continue;
 const text=outsideFences(body);const candidates:string[]=[];
 for(const m of text.matchAll(/\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/gu))candidates.push(m[1]!);
 const withoutLinks=text.replace(/\[[^\]\n]*\]\([^\n]*?\)/gu,'');
 for(const m of withoutLinks.matchAll(/`([^`\n]+)`/gu))if(/[\\/]|\.[\p{L}\d]{1,12}(?::\d+|#L\d+)?$/u.test(m[1]!))candidates.push(m[1]!);
 for(const m of withoutLinks.replace(/`[^`]*`/g,'').matchAll(/https?:\/\/[^\s<>"`]+/gu))candidates.push(m[0].replace(/[.,;!?]+$/,''));
 const prose=withoutLinks.replace(/`[^`]*`|https?:\/\/[^\s<>"`]+/gu,'');
 for(const m of prose.matchAll(/(?:^|[\s([])((?:\.\.?\/|\/)?[\p{L}\p{N}_@.-]+(?:\/[\p{L}\p{N}_@.-]+)+(?::\d+(?::\d+)?|#L\d+)?)/gu))candidates.push(m[1]!.replace(/[.,;!?]+$/,''));
 for(const raw of candidates.slice(0,500)){const normalized=target(raw,message.cwd||cwd);if(!normalized)continue;const key=`${normalized.target}\0${normalized.line??''}`;const earlier=refs.get(key);const isEdited=edited.has(normalized.target);const sources=earlier?.sources??[];if(!sources.some(s=>s.messageId===message.id))sources.push({messageId:message.id,source:message.source,timestamp:message.timestamp,edited:isEdited});
 refs.delete(key);refs.set(key,{id:createHash('sha256').update(key).digest('hex').slice(0,24),...normalized,messageId:message.id,source:message.source,edited:isEdited,sources:sources.slice(-100)});if(refs.size>2000)refs.delete(refs.keys().next().value!);
 }
 }
 const result=[...refs.values()].reverse();await Promise.all(result.map(async ref=>{if(ref.kind==='url')return;try{const info=await stat(ref.target);ref.exists=true;if(info.isDirectory())ref.kind='directory';}catch{ref.exists=false;}}));return result;
}
