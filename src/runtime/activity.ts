import type {HerdrAgent,Rpc} from '../model/types.ts';
import {sanitize} from '../tui/text.ts';
export interface ActivityObservation {state:'blocked'|'working'|'paused';observedAt:number;}
const freshness=4000;
export function activityState(agent:HerdrAgent,now=Date.now()):string {
 const native=typeof agent.agent_status==='string'?agent.agent_status:agent.agent_status?.state??agent.agent_status?.status??'unknown';
 if(native==='blocked')return native;
 const activity=agent.prism_activity;
 if(activity&&now>=activity.observedAt&&now-activity.observedAt<=freshness&&(activity.state!=='paused'||native==='idle'))return activity.state;
 return native;
}
/** UI controls, not narrative questions or transcript history, establish pending input. */
export function terminalActivity(provider:string,text:string):Omit<ActivityObservation,'observedAt'>|undefined {
 if(!['claude','codex'].includes(provider)||text.length>16384)return;
 const lines=sanitize(text).split('\n').map(line=>line.trim()).filter(Boolean),footer=lines.slice(-6);
 const controls=footer.some(line=>/^(?:Enter to (?:select|confirm)|(?:tab to switch fields · )?enter to submit)\s*·.*(?:Esc|esc) to cancel\s*$/i.test(line));
 const options=lines.some(line=>/^(?:❯|›|>)?\s*\d+\.\s+\S/.test(line)&&!line.startsWith('> '));
 if(controls&&options)return{state:'blocked'};
 const spinner='[✢✶✻✽✳✺✹✷✸✴✵✼·*•⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]';
 const active=new RegExp('^'+spinner+'\\s+(?:[^\\n]*(?:…|\\.\\.\\.)|Working)\\s*\\([^)]*(?:tokens|esc to interrupt)[^)]*\\)(?:\\s*·\\s*\\d+ background terminals? running\\s*·\\s*/ps to view\\s*·\\s*/stop to close)?\\s*$','i');
 if(lines.slice(-14).some(line=>active.test(line)))return{state:'working'};
 if(footer.some(line=>/^GPT-.*\bGoal paused \(\/goal resume\)/i.test(line)||/◎\s+\/goal paused\b/.test(line)))return{state:'paused'};
}
/** At most four bounded UI reads per inventory tick; no transcript/process/Git scans. */
export class ActivityMonitor {
 private cache=new Map<string,{signature:string;scannedAt:number;observation?:ActivityObservation}>();
 private rpc:Rpc;
 constructor(rpc:Rpc){this.rpc=rpc;}
 async update(agents:HerdrAgent[],now=Date.now()):Promise<void>{
  const signature=(a:HerdrAgent)=>JSON.stringify([a.terminal_id,a.agent,a.agent_session?.kind,a.agent_session?.value,a.agent_status]);
  const current=new Set(agents.map(a=>a.terminal_id));for(const id of this.cache.keys())if(!current.has(id))this.cache.delete(id);
  for(const agent of agents){delete agent.prism_activity;const entry=this.cache.get(agent.terminal_id);if(entry?.signature===signature(agent)&&entry.observation&&now-entry.observation.observedAt<=freshness)agent.prism_activity=entry.observation;}
  const due=agents.filter(a=>['claude','codex'].includes(a.agent??'')&&(!this.cache.has(a.terminal_id)||this.cache.get(a.terminal_id)!.signature!==signature(a)||now-this.cache.get(a.terminal_id)!.scannedAt>=2000))
   .sort((a,b)=>(this.cache.get(a.terminal_id)?.scannedAt??-1)-(this.cache.get(b.terminal_id)?.scannedAt??-1)).slice(0,4);
  await Promise.all(due.map(async agent=>{
   const entry:{signature:string;scannedAt:number;observation?:ActivityObservation}={signature:signature(agent),scannedAt:now};
   try{
    const result=await this.rpc.call('pane.read',{pane_id:agent.pane_id,source:'detection',lines:24,format:'text',strip_ansi:true}),read=result.read;
    if(read?.pane_id===agent.pane_id&&read.source==='detection'&&read.format==='text'&&typeof read.text==='string'){
     const live=(await this.rpc.call('pane.get',{pane_id:agent.pane_id})).pane;
     if(live&&signature(live)===entry.signature){const activity=terminalActivity(agent.agent!,read.text);if(activity)entry.observation={...activity,observedAt:now};}
    }
   }catch{/* Unsupported/disconnected reads never imply user attention. */}
   this.cache.delete(agent.terminal_id);this.cache.set(agent.terminal_id,entry);delete agent.prism_activity;
   if(entry.observation)agent.prism_activity=entry.observation;
  }));
  while(this.cache.size>256)this.cache.delete(this.cache.keys().next().value!);
 }
}
