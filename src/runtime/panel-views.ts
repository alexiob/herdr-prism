import type {Rpc} from '../model/types.ts';
import {StateStore,identityName} from '../state/store.ts';
import {openPanel} from './actions.ts';
import {join} from 'node:path';

export interface PanelRecord {tabId:string;paneId:string;terminalId:string;targetTerminalId?:string;open:boolean;pid?:number;}
export function panelViewStore(serverStateDir:string,tabId:string){return new StateStore(join(serverStateDir,'views',identityName(tabId)));}
/** Only authoritative open responses and exact terminal identities own a view. */
export class PanelViews {
 private store:StateStore;private rpc:Rpc;
 constructor(store:StateStore,rpc:Rpc){this.store=store;this.rpc=rpc;}
 private async current(pane:any){const owner=await this.store.read<any>('controller');if(owner?.kind==='collector-service')await this.store.write('controller',{...owner,paneId:pane.pane_id,terminalId:pane.terminal_id});}
 async records():Promise<PanelRecord[]>{
  const rows=await this.store.read<PanelRecord[]>('views')??[];
  if(!Array.isArray(rows)||rows.length>128||rows.some(r=>!r||typeof r.tabId!=='string'||typeof r.paneId!=='string'||typeof r.terminalId!=='string'||typeof r.open!=='boolean'))throw new Error('Invalid panel ownership records');
  return rows;
 }
 async open(targetPaneId?:string){
  const response=await this.rpc.call('session.snapshot'),snapshot=response.snapshot??response;
  const target=snapshot.panes?.find((p:any)=>p.pane_id===(targetPaneId??snapshot.focused_pane_id));
  if(!target?.tab_id)throw new Error('No target agent tab for Prism');
  const records=await this.records();
  const current=records.find(r=>snapshot.panes.some((p:any)=>p.terminal_id===r.terminalId&&p.tab_id===target.tab_id));
  if(current){const pane=snapshot.panes.find((p:any)=>p.terminal_id===current.terminalId);await this.current(pane);return this.rpc.call('plugin.pane.focus',{pane_id:pane.pane_id});}
  if(records.length>=128&&!records.some(r=>r.tabId===target.tab_id)){
   const old=records.findIndex(r=>!r.open);if(old<0)throw new Error('Prism panel limit reached');records.splice(old,1);
  }
  const opened=await openPanel(this.rpc,{targetPaneId:target.pane_id});
  const owned=opened.plugin_pane;
  if(owned?.plugin_id!=='iob.herdr-prism'||owned.entrypoint!=='inspector'||typeof owned.pane?.pane_id!=='string'||typeof owned.pane?.terminal_id!=='string')throw new Error('Invalid dashboard ownership response');
  const record:PanelRecord={tabId:target.tab_id,paneId:owned.pane.pane_id,terminalId:owned.pane.terminal_id,targetTerminalId:target.terminal_id,open:true};
  await this.store.write('views',[...records.filter(r=>r.tabId!==target.tab_id),record]);
  await this.current(owned.pane);
  return opened;
 }
 async register(paneId:string,terminalId:string,pid:number){
  if(typeof paneId!=='string'||typeof terminalId!=='string'||!Number.isSafeInteger(pid)||pid<1)throw new Error('Invalid view registration');
  const rows=await this.records(),record=rows.find(r=>r.terminalId===terminalId);
  if(!record)throw new Error('Unowned view terminal');
  const response=await this.rpc.call('session.snapshot'),pane=(response.snapshot??response).panes.find((p:any)=>p.terminal_id===terminalId&&p.pane_id===paneId);
  if(!pane||pane.tab_id!==record.tabId)throw new Error('View identity changed');
  record.pid=pid;record.paneId=paneId;record.open=true;await this.store.write('views',rows);
  return record;
 }
 async closed(terminalId:string){const rows=await this.records();const row=rows.find(r=>r.terminalId===terminalId);if(row){row.open=false;await this.store.write('views',rows);}}
 async reconcile(){const rows=await this.records(),response=await this.rpc.call('session.snapshot'),panes=(response.snapshot??response).panes;let changed=false;for(const row of rows)if(row.open&&!panes.some((p:any)=>p.terminal_id===row.terminalId)){row.open=false;changed=true;}if(changed)await this.store.write('views',rows);}
}
