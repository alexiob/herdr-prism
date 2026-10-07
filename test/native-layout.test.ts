import {test} from 'node:test';import assert from 'node:assert/strict';
import {nativeRows} from '../src/config/index.ts';
import {NativePublisher,clearPublication} from '../src/native/publisher.ts';
test('native card starts with status, session name, tab and muted harness; optional context has hide rules',()=>{
 const rows=nativeRows();const names=(row:any[])=>row.map(v=>typeof v==='string'?v:v.token);
 assert.deepEqual(names(rows[0]),['state_icon','agent','tab','$hat_harness']);
 for(const token of ['$hat_attention','$hat_group'])assert.ok(rows.flat().some((v:any)=>v.token===token&&v.bold===true&&v.dim===false&&v.rules?.some((r:any)=>r.equals===''&&r.hide===true)));
});
test('focused Prism owner gets a bold cyan presentation without changing native identity or stealing focus',async()=>{
 const reports=new Map<string,any>(),calls:any[]=[];
 const sessions:any[]=['owner-a','owner-b'].map(id=>({key:id,depth:0,children:[],evidence:{provider:'pi',id,title:id,messages:[],tools:[],usage:[],goals:[]},attachment:{pane_id:id,terminal_id:'terminal-'+id,agent:'pi'}}));
 const publisher=new NativePublisher({call:async(method:string,p:any)=>{calls.push({method,p});if(method==='pane.get')return {pane:sessions.find(s=>s.attachment.pane_id===p.pane_id).attachment};if(method==='pane.report_metadata')reports.set(p.pane_id,p);return{};}} as any);
 await publisher.publish(sessions,1000,sessions,{ownerTerminalId:'terminal-owner-a'});
 assert.equal(reports.get('owner-a').tokens.hat_index,'>');assert.equal(reports.get('owner-a').tokens.hat_line,'owner-a');assert.equal(reports.get('owner-b').tokens.hat_index,'');assert.equal(reports.get('owner-b').tokens.hat_line,'owner-b');assert.equal(reports.get('owner-a').display_agent,'> owner-a');assert.equal(publisher.ownsDisplay({...sessions[0].attachment,display_agent:'> owner-a'}),true);assert.equal(Object.keys(reports.get('owner-a').tokens).length,16);
 const count=calls.length;await publisher.publish(sessions,1100,sessions,{ownerTerminalId:'terminal-owner-a'});assert.equal(calls.length,count,'holding the same owner adds no polling or publication');
 await publisher.publish(sessions,1200,sessions,{ownerTerminalId:'terminal-owner-b'});assert.equal(calls.length-count,4,'switching owners only validates and republishes the two affected native entries');assert.equal(reports.get('owner-a').tokens.hat_index,'');assert.equal(reports.get('owner-a').tokens.hat_line,'owner-a');assert.equal(reports.get('owner-a').display_agent,'owner-a');assert.equal(reports.get('owner-b').tokens.hat_index,'>');assert.equal(reports.get('owner-b').tokens.hat_line,'owner-b');assert.equal(reports.get('owner-b').display_agent,'> owner-b');
 const beforeClear=calls.length;await publisher.publish(sessions,1300,sessions);assert.equal(calls.length-beforeClear,2);assert.equal(reports.get('owner-b').tokens.hat_index,'');assert.ok(calls.every(call=>['pane.get','pane.report_metadata'].includes(call.method)),'highlight never changes keyboard focus');
 await publisher.publish(sessions,1400,sessions,{ownerTerminalId:'foreign-terminal'});assert.equal(calls.length,beforeClear+2,'an unknown owner cannot highlight another native agent');
 for(const theme of ['dark','light','mono'] as const){const label:any=nativeRows(theme).flat().find((token:any)=>token.token==='agent'),accent=label.rules.find((rule:any)=>rule.starts_with==='> ');assert.ok(accent&&accent.bold===true&&accent.dim===false);assert.equal(accent.fg,theme==='dark'?'#64D9E9':theme==='light'?'#155E75':undefined);}
});
test('owner presentation uses the native pane title instead of an old display alias and clears only its exact owned label',async()=>{
 let label='> Stale Prism label';const tokens:any={},reports:any[]=[];
 const attachment:any={pane_id:'owner',terminal_id:'own',agent:'pi',title:'Owner pane title',display_agent:label};
 const session:any={key:'pi:canonical',depth:0,children:[],attachment,evidence:{provider:'pi',id:'canonical',title:label,messages:[],tools:[],usage:[],goals:[]}};
 const rpc:any={call:async(method:string,p:any)=>{if(method==='pane.get')return {pane:{...attachment,display_agent:label,tokens}};if(method==='pane.report_metadata'){reports.push(p);Object.assign(tokens,p.tokens);if(p.display_agent)label=p.display_agent;if(p.clear_display_agent)label='';}return{};}};
 const publisher=new NativePublisher(rpc);
 await publisher.publish([session],1000,[session],{ownerTerminalId:'own'});assert.equal(label,'> Owner pane title');assert.equal(session.key,'pi:canonical');assert.equal(session.evidence.id,'canonical');assert.equal(attachment.title,'Owner pane title');assert.equal(publisher.ownsDisplay({...attachment,display_agent:label}),true);
 await clearPublication(rpc,publisher.ownership());assert.equal(label,'');assert.equal(reports.at(-1).clear_display_agent,true);
});
test('compact display labels keep native fallback and clear only matching owned labels',async()=>{
 let label:string|undefined;const tokens:any={},calls:any[]=[];
 const rpc:any={call:async(method:string,p:any)=>{calls.push({method,p});if(method==='pane.get')return{pane:{terminal_id:'t',tokens:{...tokens},display_agent:label}};if(method==='pane.report_metadata'){Object.assign(tokens,p.tokens);if(p.display_agent)label=p.display_agent;if(p.clear_display_agent)label=undefined;}return{};}};
 const publisher=new NativePublisher(rpc),session:any={key:'x',children:[],depth:0,evidence:{provider:'codex',id:'x',title:'Very long meaningful agent session name',messages:[],tools:[],usage:[],goals:[]},attachment:{pane_id:'p',terminal_id:'t'}};
 await publisher.publish([session],1000);assert.equal(label,'Very long meani…');assert.equal(publisher.ownsDisplay({...session.attachment,display_agent:label}),true);
 const records=publisher.ownership();await clearPublication(rpc,records);assert.equal(label,undefined);assert.equal(calls.at(-1).p.clear_display_agent,true);
 await publisher.publish([session],7000);label='Another reporter';await clearPublication(rpc,publisher.ownership());assert.equal(label,'Another reporter');assert.equal(calls.at(-1).p.clear_display_agent,undefined);
});
test('native card resources stay compact and grouping publishes stable ranks without collecting background Git',async()=>{
 const tokens=new Map();const sessions:any[]=['b','a','c'].map((id,i)=>({key:id,depth:0,children:[],evidence:{id,provider:'codex',title:'Session '+id,state:i===1?'blocked':'idle',cwd:'/projects/'+(i===2?'beta':'alpha'),messages:[],tools:[],goals:[],usage:[]},attachment:{pane_id:id,terminal_id:id,tab_id:i===2?'tab2':'tab1',agent_status:i===1?'blocked':'idle'},resource:{availability:'known',cpuPercent:2.456,memoryBytes:'3200',memoryLabel:'RSS sum',processes:[]}}));
 const publisher=new NativePublisher({call:async(method:string,p:any)=>{if(method==='pane.get')return{pane:{terminal_id:p.pane_id}};if(method==='pane.report_metadata')tokens.set(p.pane_id,p.tokens);return{};}} as any);
 await publisher.publish(sessions,1000,sessions,{grouping:'project',tabs:[{tab_id:'tab1',label:'Work'},{tab_id:'tab2',label:'Test'}]});
 assert.equal(tokens.get('a').hat_attention,'! INPUT REQUIRED');assert.equal(tokens.get('b').hat_attention,'○ IDLE');
 assert.equal(tokens.get('a').hat_load,'CPU 2.5%  RSS 3.2kB');
 assert.equal(tokens.get('a').hat_group,'Project: alpha');assert.equal(tokens.get('b').hat_group,'');assert.equal(tokens.get('c').hat_group,'Project: beta');
 await publisher.publish(sessions,7000,sessions,{grouping:'none'});assert.ok([...tokens.values()].every(v=>v.hat_group===''));
 await publisher.publish(sessions,13000,sessions,{grouping:'tab',tabs:[{tab_id:'tab1',label:'Work'},{tab_id:'tab2',label:'Test'}]});assert.equal(tokens.get('a').hat_group,'Tab: Work');
});

test('native attention order uses authoritative status, stays stable within tiers and updates after replies',async()=>{
 const reports=new Map<string,any>(),order:string[]=[];
 const sessions:any[]=[['w','working'],['i1','idle'],['b','blocked'],['d','done'],['u','unknown'],['i2','idle']].map(([id,state])=>({key:id,depth:0,children:[],evidence:{id,provider:'codex',state:'blocked',messages:[],tools:[],usage:[],goals:[]},attachment:{pane_id:id,terminal_id:id,agent:'codex',agent_status:{state}}}));
 const publisher=new NativePublisher({call:async(method:string,p:any)=>{if(method==='pane.get')return{pane:{...sessions.find(s=>s.key===p.pane_id).attachment}};if(method==='pane.report_metadata'){reports.set(p.pane_id,p.tokens);order.push(p.pane_id);}return{};}} as any);
 await publisher.publish(sessions,1000);assert.deepEqual(order,['b','d','w','i1','i2','u']);assert.deepEqual([...reports.entries()].sort((a,b)=>a[1].hat_rank.localeCompare(b[1].hat_rank)).map(([id])=>id),order);
 order.length=0;sessions.find(s=>s.key==='b').attachment.agent_status={state:'working'};await publisher.publish(sessions,7000);assert.deepEqual(order,['d','w','b','i1','i2','u']);
});
