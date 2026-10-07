import { EventEmitter } from 'node:events';
import { HerdrClient } from './client.ts';
import type { HerdrSnapshot } from '../model/types.ts';

export const lifecycleSubscriptions = ['workspace.created','workspace.updated','workspace.closed','workspace.focused','worktree.created','worktree.opened','worktree.removed','tab.created','tab.closed','tab.focused','tab.moved','pane.created','pane.closed','pane.updated','pane.focused','pane.moved','pane.exited','pane.agent_detected','layout.updated'];
export class SnapshotCache extends EventEmitter {
  snapshot?: HerdrSnapshot;
  stale=true;
  private dirty=false;
  private reading?: Promise<HerdrSnapshot>;
  private refreshTimer?:NodeJS.Timeout;
  private reconnectTimer?:NodeJS.Timeout;
  private safetyTimer?:NodeJS.Timeout;
  private stopped=false;
  private backoff=250;
  private tracked='';
  private subscribed=false;
  private subscription?:Promise<void>;
  private generation=0;
  private client: HerdrClient;
  constructor(client:HerdrClient){super();this.client=client;client.on('event',this.onEvent);client.on('disconnected',this.onDisconnect);}
  private onEvent=(event:any)=>{
    if(this.stopped)return;
    if(event.event==='events_lost'){this.stale=true;this.emit('stale');this.subscribed=false;this.generation++;this.tracked='';this.dirty=true;void this.subscribeAndRefresh().catch(e=>this.recover(e));return;}
    // Metadata publications emit pane_updated. Events invalidate; content joins must compare hashes.
    this.dirty=true;if(!this.refreshTimer)this.refreshTimer=setTimeout(()=>{this.refreshTimer=undefined;void this.refresh().catch(e=>this.recover(e));},100);
  };
  private onDisconnect=()=>{this.stale=true;this.emit('stale');this.subscribed=false;this.generation++;this.tracked='';clearTimeout(this.refreshTimer);this.refreshTimer=undefined;this.recover(new Error('Herdr disconnected'));};
  private recover(error:Error){if(this.stopped)return;const announce=!this.stale;this.stale=true;if(announce)this.emit('stale');this.emit('diagnostic',error.message);if(!this.reconnectTimer){this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=undefined;void this.subscribeAndRefresh().catch(e=>this.recover(e));},this.backoff);this.backoff=Math.min(this.backoff*2,10000);}}
  async start():Promise<HerdrSnapshot>{if(this.stopped)throw new Error('Snapshot cache closed');const snapshot=await this.subscribeAndRefresh();if(this.stopped)throw new Error('Snapshot cache closed');if(!this.safetyTimer)this.safetyTimer=setInterval(()=>void this.refresh().catch(e=>this.recover(e)),10000);return snapshot;}
  private async ensureSubscribed(){
    if(this.stopped)throw new Error('Snapshot cache closed');
    while(!this.subscribed){
      if(!this.subscription){const generation=this.generation;this.subscription=this.client.call('events.subscribe',{subscriptions:lifecycleSubscriptions.map(type=>({type}))}).then(()=>{if(!this.stopped&&generation===this.generation)this.subscribed=true;}).finally(()=>{this.subscription=undefined;});}
      await this.subscription;if(this.stopped)throw new Error('Snapshot cache closed');
    }
  }
  private async subscribeAndRefresh(){await this.ensureSubscribed();const snapshot=await this.refresh();this.backoff=250;clearTimeout(this.reconnectTimer);this.reconnectTimer=undefined;return snapshot;}
  async refresh():Promise<HerdrSnapshot>{
    if(this.stopped)throw new Error('Snapshot cache closed');
    if(this.reading){this.dirty=true;return this.reading;}
    this.reading=(async()=>{
      let snapshot:HerdrSnapshot,readStartedAt:number;
      do {
        await this.ensureSubscribed();
        this.dirty=false;
        readStartedAt=performance.now();
        const result=await this.client.call('session.snapshot');snapshot=result.snapshot??result;
        if(!snapshot || !Array.isArray(snapshot.agents) || !Array.isArray(snapshot.panes) || typeof snapshot.protocol!=='number')throw new Error('Invalid Herdr snapshot');
        if(this.stopped)return snapshot;this.snapshot=snapshot;this.stale=false;
        const ids=snapshot.agents.map(a=>a.pane_id).sort().join(',');
        if(ids!==this.tracked){const generation=this.generation;await this.client.call('events.subscribe',{subscriptions:[...lifecycleSubscriptions.map(type=>({type})),...snapshot.agents.map(a=>({type:'pane.agent_status_changed',pane_id:a.pane_id}))]});if(generation===this.generation)this.tracked=ids;else this.dirty=true;}
      }while(this.dirty&&!this.stopped);
      if(!this.stopped)this.emit('snapshot',snapshot!,readStartedAt!);return snapshot!;
    })().finally(()=>{this.reading=undefined;});return this.reading;
  }
  close(){this.stopped=true;this.subscribed=false;this.generation++;clearTimeout(this.refreshTimer);clearTimeout(this.reconnectTimer);clearInterval(this.safetyTimer);this.client.off('event',this.onEvent);this.client.off('disconnected',this.onDisconnect);}
}
