import {randomUUID} from 'node:crypto';
/** Structural boundary avoids a runtime dependency on a particular Pi package name. */
export interface PiExtensionAPI {
 appendEntry(customType:string,data:unknown):void;
 registerCommand(name:string,options:{description:string;handler:(args:string)=>void}):void;
 on(event:'agent_start'|'agent_end'|'session_start',handler:(event:unknown,context?:{sessionManager:{getEntries():unknown[]}})=>void):unknown;
}
export interface ParentFact {provider:string;id:string;task?:string;}
export type CompanionRecord = {version:1;kind:'goal';id:string;objective:string;status:'active'}|{version:1;kind:'delegation';parent:ParentFact;task?:string}|{version:1;kind:'state';state:'running'|'idle';parent?:ParentFact;task?:string;};
function text(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=8192&&!/[\x00-\x1f\x7f]/.test(value);}
/** Loaded only through an explicit Pi extension opt-in. Registers no model tools/hooks or launch claims. */
export default function companion(pi:PiExtensionAPI):void {
 let currentParent:ParentFact|undefined;
 const append=(record:CompanionRecord)=>pi.appendEntry('iob.herdr-prism',record);
 pi.registerCommand('prism-goal',{description:'Record an explicit Prism goal for this Pi session',handler:(args)=>{const objective=args.trim();if(!text(objective))throw new Error('goal must be nonempty visible text, at most 8192 characters');append({version:1,kind:'goal',id:randomUUID(),objective,status:'active'});}});
 pi.registerCommand('prism-parent',{description:'Record explicit delegated parent: JSON {provider,id,task?}',handler:(args)=>{let parent:unknown;try{parent=JSON.parse(args);}catch{throw new Error('delegation parent must be a JSON object');}if(!parent||typeof parent!=='object'||Array.isArray(parent))throw new Error('delegation parent must be an object');const p=parent as Record<string,unknown>;if(!text(p.provider)||!text(p.id)||p.task!==undefined&&!text(p.task))throw new Error('delegation parent needs provider and exact ID; optional task must be visible text');currentParent={provider:p.provider,id:p.id,task:p.task as string|undefined};append({version:1,kind:'delegation',parent:{provider:p.provider,id:p.id},task:p.task as string|undefined});}});
 pi.on('session_start',(_,ctx)=>{currentParent=undefined;for(const entry of ctx?.sessionManager.getEntries()??[]){if(!entry||typeof entry!=='object')continue;const r=entry as Record<string,any>;const d=r.data;const p=d?.parent;if(r.type==='custom'&&r.customType==='iob.herdr-prism'&&d?.version===1&&['delegation','state'].includes(d.kind)&&p&&text(p.provider)&&text(p.id))currentParent={provider:p.provider,id:p.id,task:text(d.task)?d.task:undefined};}});
 const state=(state:'running'|'idle')=>append({version:1,kind:'state',state,...(currentParent?{parent:{provider:currentParent.provider,id:currentParent.id},task:currentParent.task}:{})});
 pi.on('agent_start',()=>state('running'));
 pi.on('agent_end',()=>state('idle'));
}
