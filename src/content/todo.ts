import {createHash} from 'node:crypto';
import type {Message} from '../model/types.ts';
import {outsideFences,safeText} from './text.ts';
export interface TodoItem {id:string;text:string;checked:boolean;firstSeen?:number;firstMessageId:string;source?:string;latestMessageId:string;repeated:boolean;archived:boolean;}
export type TodoStatus='disabled'|'not_reported'|'source_unavailable'|'reported'|'empty';
export interface TodoState {version:1;items:TodoItem[];current:string[];sourceMessageId?:string;reportedAt?:number;hasReport:boolean;processed:string[];diagnostics?:string[];}
const normalize=(text:string)=>safeText(text).split(/(`[^`]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gu).map((part,index)=>index%2?part:part.replace(/\s+/gu,' ')).join('').trim().slice(0,8192);
export class TodoList {
 private enabled:boolean;private available=true;private records=new Map<string,TodoItem>();private current:string[]=[];private processed=new Set<string>();private hasReport=false;
 diagnostics:string[]=[];sourceMessageId?:string;reportedAt?:number;
 constructor(options:{enabled?:boolean}={}){this.enabled=options.enabled!==false;}
 get status():TodoStatus {return !this.enabled?'disabled':!this.available?'source_unavailable':!this.hasReport?'not_reported':this.current.length?'reported':'empty';}
 get items():TodoItem[]{return this.current.map(id=>({...this.records.get(id)!})).sort((a,b)=>Number(a.checked)-Number(b.checked));}
 get pendingCount():number {return this.items.filter(i=>!i.checked).length;}
 setAvailability(available:boolean){this.available=available;}
 update(messages:Message[]):void {if(!this.enabled)return;for(const message of messages){if(message.kind==='inter-agent'||message.role!=='assistant'||message.complete!==true)continue;const key=message.id+'\0'+createHash('sha256').update(message.text).digest('hex');if(this.processed.has(key))continue;this.processed.add(key);while(this.processed.size>10000)this.processed.delete(this.processed.values().next().value!);
 const reports=outsideFences(message.text.slice(0,1024*1024)).split('\n').map(line=>/^\s*(?:[-*]\s+)?ACTION:\s*(.*)$/.exec(line)).filter((match):match is RegExpExecArray=>match!==null).map(match=>match[1]!.trim());if(!reports.length)continue;
 const clear=reports.filter(r=>/^none$/i.test(r));if(reports.some(r=>!r)||clear.length&&reports.length!==1){this.diagnostics.push(`${message.id}: malformed or mixed clear-and-item ACTION report`);this.diagnostics=this.diagnostics.slice(-64);continue;}
 const next:string[]=[];if(!clear.length)for(const report of reports.slice(0,200)){const text=normalize(report);const id=createHash('sha256').update(text).digest('hex').slice(0,24);let item=this.records.get(id);if(!item){item={id,text,checked:false,firstSeen:message.timestamp,firstMessageId:message.id,source:message.source,latestMessageId:message.id,repeated:false,archived:false};this.records.set(id,item);}else{item.repeated=item.archived||item.latestMessageId!==message.id;item.archived=false;item.latestMessageId=message.id;}if(!next.includes(id))next.push(id);}
 for(const id of this.current)if(!next.includes(id))this.records.get(id)!.archived=true;this.current=next;this.hasReport=true;this.sourceMessageId=message.id;this.reportedAt=message.timestamp;
 if(this.records.size>2000)for(const [id,item] of this.records)if(item.archived&&this.records.size>2000)this.records.delete(id);
 }}
 toggle(id:string):boolean {const item=this.records.get(id);if(!item||!this.current.includes(id))return false;item.checked=!item.checked;return true;}
 toJSON():TodoState {return {version:1,items:[...this.records.values()].map(v=>({...v})),current:[...this.current],sourceMessageId:this.sourceMessageId,reportedAt:this.reportedAt,hasReport:this.hasReport,processed:[...this.processed],diagnostics:[...this.diagnostics]};}
 restore(value:unknown):void {if(!value||typeof value!=='object')return;const state=value as Partial<TodoState>;if(state.version!==1||!Array.isArray(state.items)||!Array.isArray(state.current))return;this.records.clear();for(const item of state.items.slice(-2000)){if(!item||typeof item.id!=='string'||typeof item.text!=='string'||typeof item.firstMessageId!=='string')continue;const text=safeText(item.text).slice(0,8192);const id=createHash('sha256').update(text).digest('hex').slice(0,24);if(id!==item.id)continue;this.records.set(id,{...item,text,checked:item.checked===true,archived:item.archived===true,repeated:item.repeated===true});}this.current=state.current.filter(id=>typeof id==='string'&&this.records.has(id)).slice(0,200);this.hasReport=state.hasReport===true;this.sourceMessageId=typeof state.sourceMessageId==='string'?state.sourceMessageId:undefined;this.reportedAt=typeof state.reportedAt==='number'?state.reportedAt:undefined;this.processed=new Set(Array.isArray(state.processed)?state.processed.filter(v=>typeof v==='string').slice(-10000):[]);this.diagnostics=Array.isArray(state.diagnostics)?state.diagnostics.filter(v=>typeof v==='string').slice(-64).map(v=>safeText(v).slice(0,4096)):[];}
}
