import {test} from 'node:test';import assert from 'node:assert/strict';
import {nativeRows} from '../src/config/index.ts';
import {NativePublisher,clearPublication} from '../src/native/publisher.ts';
test('native card starts with only status, session name and tab; optional context has hide rules',()=>{
 const rows=nativeRows();const names=(row:any[])=>row.map(v=>typeof v==='string'?v:v.token);
 assert.deepEqual(names(rows[0]),['state_icon','agent','tab']);
 for(const token of ['$hat_attention','$hat_group'])assert.ok(rows.flat().some((v:any)=>v.token===token&&v.bold===true&&v.dim===false&&v.rules?.some((r:any)=>r.equals===''&&r.hide===true)));
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
 assert.equal(tokens.get('a').hat_attention,'! INPUT REQUIRED');assert.equal(tokens.get('b').hat_attention,'○ WAITING FOR YOU');
 assert.equal(tokens.get('a').hat_load,'CPU 2.5%  RSS 3.2kB');
 assert.equal(tokens.get('b').hat_group,'Project: alpha');assert.equal(tokens.get('a').hat_group,'');assert.equal(tokens.get('c').hat_group,'Project: beta');
 await publisher.publish(sessions,7000,sessions,{grouping:'none'});assert.ok([...tokens.values()].every(v=>v.hat_group===''));
 await publisher.publish(sessions,13000,sessions,{grouping:'tab',tabs:[{tab_id:'tab1',label:'Work'},{tab_id:'tab2',label:'Test'}]});assert.equal(tokens.get('b').hat_group,'Tab: Work');
});
