import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CodexAdapter} from '../src/providers/codex.ts';
import {overviewRows} from '../src/tui/facts.ts';
import {createUiState,renderScreen,handleKey,showDetail} from '../src/tui/screen.ts';
import {cellWidth} from '../src/tui/text.ts';
const now=Date.parse('2026-10-07T10:00:00Z');
const adapter=()=>{const a=new CodexAdapter('codex','/fixture/session.jsonl',200);a.consume({offset:0,record:{type:'session_meta',payload:{id:'s'}}} as any);return a;};
const observation=(a:CodexAdapter,rate_limits:any,offset=1,at=now)=>a.consume({offset,record:{type:'event_msg',timestamp:new Date(at).toISOString(),payload:{type:'token_count',info:null,rate_limits}}} as any);
const rates={limit_id:'codex',plan_type:'pro',primary:{used_percent:12.5,window_minutes:300,resets_at:(now+3600000)/1000},secondary:{used_percent:89.2,window_minutes:10080,resets_at:(now+86400000)/1000},credits:{has_credits:true,unlimited:false,balance:'38672.413016'}};
const view=(a:CodexAdapter)=>({key:'codex:s',depth:0,children:[],evidence:a.snapshot(),refs:[],todos:[]});
test('Codex account observations are independent of tokens and retain actual quota units and zero',()=>{
 const a=adapter();observation(a,rates);const e=a.snapshot() as any;
 assert.equal(e.accountLimits.plan,'pro');assert.equal(e.accountLimits.sessionId,'s');assert.equal(e.accountLimits.windows[0].usedPercent,12.5);assert.equal(e.accountLimits.windows[0].windowMinutes,300);assert.equal(e.accountLimits.credits.balance,'38672.413016');assert.equal(e.usage.length,0);
 observation(a,{primary:{used_percent:0,window_minutes:10080,resets_at:(now+1000)/1000}},2);assert.equal((a.snapshot() as any).accountLimits.windows[0].usedPercent,0);
});
test('unavailable, malformed and other-provider records never fabricate account limits',()=>{
 const a=adapter();observation(a,rates);observation(a,null,2);assert.equal((a.snapshot() as any).accountLimits,undefined);
 observation(a,{primary:{used_percent:101,window_minutes:-1},credits:{balance:'secret'}});assert.equal((a.snapshot() as any).accountLimits,undefined);
 a.consume({offset:9,record:{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({rate_limits:rates})}]}}} as any);assert.equal((a.snapshot() as any).accountLimits,undefined);
});
test('overview conditionally renders account block, quota bars, contextual help and full detail across widths',()=>{
 const a=adapter(),state=createUiState(),session=view(a),data:any={sessions:[session],updatedAt:now,stale:false,diagnostics:[]};state.selectedKey=session.key;
 assert.equal(overviewRows(session as any,state,now,data).some(r=>r.section==='Account / limits'),false);
 observation(a,rates);data.sessions=[view(a)];const rows=overviewRows(data.sessions[0],state,now,data);const quota=rows.find(r=>r.id==='account-window-primary')!;
 assert.ok(quota, 'reported quota must be displayed');assert.match(quota.value!,/12.5%/);assert.match(quota.help!,/shared|account/i);assert.ok(quota.document!.sections.some(s=>s.fields?.some(f=>f.value==='38672.413016')));
 for(const width of [36,50,80,120]){const screen=renderScreen(data,state,width,40,now);assert.ok(screen.lines.every(l=>cellWidth(l)<=width));const index=screen.rows.findIndex(r=>r.id===quota.id);state.cursor=index;state.cursorId=quota.id;handleKey(state,'?',data,screen);assert.ok(state.help);handleKey(state,'escape',data,renderScreen(data,state,width,40,now));const action=handleKey(state,'enter',data,renderScreen(data,state,width,40,now));assert.ok(action?.document);showDetail(state,action.text??'',action.document);assert.ok(state.detailDocument);handleKey(state,'escape',data,renderScreen(data,state,width,40,now));}
});
test('expired observations and session-owner mismatch hide the complete account block',()=>{
 const a=adapter();observation(a,rates);const session:any=view(a),state=createUiState(),data:any={sessions:[session],updatedAt:now,stale:false,diagnostics:[]};
 assert.equal(overviewRows(session,state,now+16*60000,data).some(r=>r.section==='Account / limits'),false);
 session.evidence.id='other';assert.equal(overviewRows(session,state,now,data).some(r=>r.section==='Account / limits'),false);
});
test('out-of-order and inherited Codex events cannot replace the session’s newer quota',()=>{
 const a=adapter();observation(a,rates,1,now);observation(a,{primary:{used_percent:99}},2,now-1000);assert.equal(a.snapshot().accountLimits!.windows[0]!.usedPercent,12.5);
 const child=new CodexAdapter('codex','/fixture/child.jsonl',200);child.consume({offset:0,record:{type:'session_meta',payload:{id:'child',subagent_history_start_ordinal:2}}} as any);observation(child,rates,1);assert.equal(child.snapshot().accountLimits,undefined);observation(child,{primary:{used_percent:3}},2);assert.equal(child.snapshot().accountLimits!.sessionId,'child');
});

import {ProviderIndex} from '../src/providers/index.ts';import {freshPrivateDirectory} from './helpers/private-dir.ts';import {mkdir,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
test('archive merge retains latest account clear despite newer unrelated activity in old source',async t=>{
 const root=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-account-merge-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const meta={type:'session_meta',payload:{id:'s',cwd:root}},event=(rate_limits:any,at:number)=>({type:'event_msg',timestamp:new Date(at).toISOString(),payload:{type:'token_count',info:null,rate_limits}});
 const put=async(dir:string,rows:any[])=>{const file=path.join(root,'codex',dir,'s.jsonl');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,rows.map(r=>JSON.stringify(r)+'\n').join(''));};
 await put('archived_sessions',[meta,event(rates,now-2000),{type:'event_msg',timestamp:new Date(now+5000).toISOString(),payload:{type:'agent_message',message:'Later non-account activity'}}]);await put('sessions',[meta,event(null,now)]);
 const index=new ProviderIndex({codexHome:path.join(root,'codex'),claudeHome:path.join(root,'claude'),piHome:path.join(root,'pi'),directoryScanMs:0});t.after(()=>index.close());await index.refresh();const evidence=index.resolveCached('codex',{kind:'id',value:'s'})!;
 assert.equal(evidence.accountObservedAt,now);assert.equal(evidence.accountLimits,undefined);
});
