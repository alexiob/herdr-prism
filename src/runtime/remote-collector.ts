import {EventEmitter} from 'node:events';
import {MailboxClient} from '../state/mailbox.ts';
import {ensureCollectorService} from './collector-service.ts';
import type {serviceContext} from './service.ts';
import type {Collector} from './collector.ts';
import type {DashboardData} from '../tui/types.ts';
import type {ReferencePage,ReferenceSourcePage} from '../providers/reference-pages.ts';
import type {HerdrSnapshot} from '../model/types.ts';

/** A view never samples or publishes: all operations use the one owner's token. */
export class RemoteCollector extends EventEmitter {
 data:DashboardData={sessions:[],updatedAt:0,stale:true,diagnostics:[]};
 snapshot?:HerdrSnapshot;
 private context:Awaited<ReturnType<typeof serviceContext>>;private paneId:string;private terminalId:string;
 private client?:MailboxClient;private timer?:NodeJS.Timeout;private pending?:Promise<void>;private stopped=false;
 private key?:string;private visible=false;private subtree=false;private expanded=false;
 private failures=0;
 private revision?:string;private snapshotRevision?:number;private forceSnapshot=false;private polling=false;
 private phase='idle';
 constructor(context:Awaited<ReturnType<typeof serviceContext>>,paneId:string,terminalId:string){super();this.context=context;this.paneId=paneId;this.terminalId=terminalId;}
 get displayedSessionKey(){return this.key;}
 get startupPhase(){return this.phase;}
 async start(){
  this.phase='ensure-owner';
  const owner=await ensureCollectorService(this.context);this.client=new MailboxClient(this.context.serverStateDir,owner.marker.token,10000,16*1024*1024);
  this.phase='register';await this.client.request('view.register',{paneId:this.paneId,terminalId:this.terminalId,pid:process.pid});this.phase='initial-poll';await this.refresh();this.phase='running';
  if(!this.snapshot)throw new Error('Shared collector did not provide its initial native snapshot');this.polling=true;this.schedulePoll();
 }
 private schedulePoll(){clearTimeout(this.timer);if(this.stopped||!this.polling)return;const ownFocus=this.snapshot?.focused_pane_id===this.paneId;this.timer=setTimeout(()=>void this.refresh().catch(error=>this.failed(error)),this.visible?ownFocus?500:1000:500);}
 private failed(error:Error){const fresh=!this.data.stale;this.data={...this.data,stale:true};if(fresh)this.emit('stale');this.emit('diagnostic',error.message);if(++this.failures>=3){this.polling=false;clearTimeout(this.timer);this.emit('disconnected',error);}else this.schedulePoll();}
 setVisibleSession(key?:string,visible=true){if(this.key===key&&this.visible===visible)return;this.key=key;this.visible=visible;this.revision=undefined;this.schedulePoll();}
 setScope(subtree:boolean){if(this.subtree===subtree)return;this.subtree=subtree;this.revision=undefined;}
 setProcessesExpanded(expanded:boolean){if(this.expanded===expanded)return;this.expanded=expanded;this.revision=undefined;}
 async markReady(){if(this.stopped||!this.client)throw new Error('View is not running');return this.client.request('view.ready',{paneId:this.paneId,terminalId:this.terminalId,pid:process.pid});}
 invalidate(){this.forceSnapshot=true;if(this.client)void this.refresh().catch(error=>this.failed(error));}
 async refresh():Promise<void>{
  if(this.stopped||!this.client)return;if(this.pending)return this.pending;
  const forceSnapshot=this.forceSnapshot;this.forceSnapshot=false;
  this.pending=(async()=>{const response=await this.client!.request<{data?:DashboardData;unchanged?:boolean;revision:string;stale:boolean;snapshot?:HerdrSnapshot;snapshotRevision:number}>('view.poll',{terminalId:this.terminalId,key:this.key,visible:this.visible,subtree:this.subtree,expanded:this.expanded,revision:this.revision,snapshotRevision:this.snapshotRevision,forceSnapshot});if(typeof response.revision!=='string'||typeof response.stale!=='boolean'||!Number.isSafeInteger(response.snapshotRevision)||!response.unchanged&&(!response.data||!Array.isArray(response.data.sessions)))throw new Error('Invalid shared dashboard response');if(response.snapshot&&(!Array.isArray(response.snapshot.panes)||!Array.isArray(response.snapshot.agents)))throw new Error('Invalid shared native snapshot');this.failures=0;if(!this.stopped){const wasStale=this.data.stale===true;this.revision=response.revision;if(response.data)this.data=response.data;if(this.data.stale!==response.stale)this.data={...this.data,stale:response.stale};if(response.snapshot){this.snapshot=response.snapshot;this.snapshotRevision=response.snapshotRevision;this.emit('snapshot',this.snapshot);}if(response.stale&&!wasStale)this.emit('stale');if(response.data||wasStale!==response.stale)this.emit('data',this.data);}})().finally(()=>{this.pending=undefined;if(this.forceSnapshot&&!this.stopped)void this.refresh().catch(error=>this.failed(error));else this.schedulePoll();});return this.pending;
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
 async close(){if(this.stopped)return;this.stopped=true;this.polling=false;clearTimeout(this.timer);await this.pending?.catch(()=>{});await this.client?.request('view.closed',{terminalId:this.terminalId}).catch(()=>{});}
}
