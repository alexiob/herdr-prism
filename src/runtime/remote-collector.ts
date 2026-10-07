import {EventEmitter} from 'node:events';
import {MailboxClient} from '../state/mailbox.ts';
import {ensureCollectorService} from './collector-service.ts';
import type {serviceContext} from './service.ts';
import type {Collector} from './collector.ts';
import type {DashboardData} from '../tui/types.ts';
import type {ReferencePage,ReferenceSourcePage} from '../providers/reference-pages.ts';

/** A view never samples or publishes: all operations use the one owner's token. */
export class RemoteCollector extends EventEmitter {
 data:DashboardData={sessions:[],updatedAt:0,stale:true,diagnostics:[]};
 private context:Awaited<ReturnType<typeof serviceContext>>;private paneId:string;private terminalId:string;
 private client?:MailboxClient;private timer?:NodeJS.Timeout;private pending?:Promise<void>;private stopped=false;
 private key?:string;private visible=false;private subtree=false;private expanded=false;
 private failures=0;
 constructor(context:Awaited<ReturnType<typeof serviceContext>>,paneId:string,terminalId:string){super();this.context=context;this.paneId=paneId;this.terminalId=terminalId;}
 get displayedSessionKey(){return this.key;}
 async start(){
  const owner=await ensureCollectorService(this.context);this.client=new MailboxClient(this.context.serverStateDir,owner.marker.token,10000,16*1024*1024);
  await this.client.request('view.register',{paneId:this.paneId,terminalId:this.terminalId,pid:process.pid});await this.refresh();
  this.timer=setInterval(()=>{if(this.pending)return;void this.refresh().catch(error=>{this.data={...this.data,stale:true};this.emit('diagnostic',error.message);this.emit('data',this.data);if(++this.failures>=3){clearInterval(this.timer);this.emit('disconnected');}});},500);
 }
 setVisibleSession(key?:string,visible=true){this.key=key;this.visible=visible;}
 setScope(subtree:boolean){this.subtree=subtree;}
 setProcessesExpanded(expanded:boolean){this.expanded=expanded;}
 invalidate(){if(this.client)void this.refresh().catch(error=>this.emit('diagnostic',error.message));}
 async refresh():Promise<void>{
  if(this.stopped||!this.client)return;if(this.pending)return this.pending;
  this.pending=(async()=>{const response=await this.client!.request<{data:DashboardData}>('view.poll',{terminalId:this.terminalId,key:this.key,visible:this.visible,subtree:this.subtree,expanded:this.expanded});if(!response.data||!Array.isArray(response.data.sessions))throw new Error('Invalid shared dashboard response');this.failures=0;if(!this.stopped){this.data=response.data;this.emit('data',this.data);}})().finally(()=>{this.pending=undefined;});return this.pending;
 }
 private async invoke(op:string,p:any){await this.refresh();return this.client!.request(op,{...p,terminalId:this.terminalId});}
 private async page<T>(op:string,p:any):Promise<(T&{contentRevision?:string})|undefined>{const response=await this.invoke(op,p);if(response.data&&!this.stopped){this.data=response.data;this.emit('data',this.data);}return response.page?{...response.page,contentRevision:response.contentRevision}:undefined;}
 toggleTodo(...args:Parameters<Collector['toggleTodo']>){return this.invoke('toggle-todo',{session:args[0],id:args[1]});}
 processOutput(session:string,target:{key:string;owner:string}){return this.invoke('process-output',{terminalId:this.terminalId,session,processTarget:{key:target.key,owner:target.owner}});}
 terminateProcess(session:string,target:{key:string;owner:string}){return this.invoke('terminate-process',{terminalId:this.terminalId,session,processTarget:{key:target.key,owner:target.owner}});}
 focus(...args:Parameters<Collector['focus']>){return this.invoke('focus',{session:args[0]});}
 message(...args:Parameters<Collector['message']>):ReturnType<Collector['message']>{return this.invoke('message',{session:args[0],id:args[1]});}
 pageMessages(...args:Parameters<Collector['pageMessages']>):ReturnType<Collector['pageMessages']>{return this.invoke('page-messages',{session:args[0],beforeId:args[1]});}
 pageReferences(...args:Parameters<Collector['pageReferences']>){return this.page<ReferencePage>('page-references',{session:args[0],options:args[1]});}
 pageReferenceSources(...args:Parameters<Collector['pageReferenceSources']>){return this.page<ReferenceSourcePage>('page-reference-sources',{session:args[0],targetId:args[1],options:args[2]});}
 referenceMessage(...args:Parameters<Collector['referenceMessage']>):ReturnType<Collector['referenceMessage']>{return this.invoke('reference-message',{cursor:args[0]});}
 async close(){if(this.stopped)return;this.stopped=true;clearInterval(this.timer);await this.pending?.catch(()=>{});await this.client?.request('view.closed',{terminalId:this.terminalId}).catch(()=>{});}
}
