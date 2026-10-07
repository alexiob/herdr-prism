import {test} from 'node:test';import assert from 'node:assert/strict';
import {ActivityMonitor,activityState,terminalActivity} from '../src/runtime/activity.ts';
const question='Choose a route\n❯ 1. Keep the API\n  2. Replace it\n\nEnter to select · ↑/↓ to navigate · Esc to cancel';
const working='✶ Working… (1m 3s · ↓ 2.1k tokens · thinking with high effort)\n❯\nOpus';
const agent=(id:string):any=>({pane_id:id,terminal_id:'terminal-'+id,agent:'claude',agent_status:'idle',agent_session:{kind:'id',value:id}});
test('only live input controls indicate attention; idle messages and old prompts do not',()=>{
 assert.equal(terminalActivity('claude',question)?.state,'blocked');assert.equal(terminalActivity('claude',working)?.state,'working');
 assert.equal(terminalActivity('claude','I need your decision.\n✻ Churned for 9s · done 4:47 AM\n❯'),undefined);
 assert.equal(terminalActivity('claude',question+'\n'+Array(12).fill('new output').join('\n')),undefined);
 assert.equal(terminalActivity('claude',question.split('\n').map(s=>'> '+s).join('\n')),undefined);
 assert.equal(terminalActivity('pi',question),undefined);
 assert.equal(terminalActivity('claude','❯ /goal paused'),undefined);
 assert.equal(terminalActivity('codex','GPT-6.1-Sol high · Goal paused (/goal resume)')?.state,'paused');
 assert.equal(terminalActivity('codex','• Working (11m 47s • esc to interrupt) · 1 background terminal running · /ps to view · /stop to close\nGoal paused (/goal resume)')?.state,'working');
 assert.equal(activityState({...agent('a'),agent_status:'working',prism_activity:{state:'paused',observedAt:1000}},1000),'working','pausing a goal does not pause an active agent');
 assert.equal(activityState({...agent('a'),agent_status:'blocked',prism_activity:{state:'working',observedAt:1000}},1000),'blocked','explicit native input state takes precedence over spinner detection');
});
test('lightweight activity is bounded, clears after an answer and rejects a replaced occupant',async()=>{
 let text=question,replaced=false,reads=0;const a=agent('a');
 const rpc:any={call:async(method:string,p:any)=>{if(method==='pane.read'){reads++;assert.equal(p.source,'detection');assert.equal(p.lines,24);return{read:{pane_id:p.pane_id,source:'detection',format:'text',text}};}if(method==='pane.get')return{pane:{...a,terminal_id:replaced?'replacement':a.terminal_id}};throw Error(method);}};
 const monitor=new ActivityMonitor(rpc);await monitor.update([a],1000);assert.equal(activityState(a,1000),'blocked');
 text=working;await monitor.update([a],1500);assert.equal(reads,1);await monitor.update([a],3000);assert.equal(activityState(a,3000),'working');
 replaced=true;await monitor.update([a],5000);assert.equal(activityState(a,5000),'idle');assert.equal(a.prism_activity,undefined);
 assert.equal(activityState({...a,prism_activity:{state:'blocked',observedAt:1000}},6000),'idle');
});
test('activity budget rotates across agents and ignores unsupported harnesses',async()=>{
 let reads=0;const agents=[...Array.from({length:9},(_,i)=>agent(String(i))),{...agent('other'),agent:'other'}];
 const rpc:any={call:async(method:string,p:any)=>{if(method==='pane.read'){reads++;return{read:{pane_id:p.pane_id,source:'detection',format:'text',text:question}};}return{pane:agents.find(a=>a.pane_id===p.pane_id)};}};
 const monitor=new ActivityMonitor(rpc);await monitor.update(agents,1000);assert.equal(reads,4);await monitor.update(agents,2000);assert.equal(reads,8);await monitor.update(agents,3000);assert.equal(agents[8].prism_activity?.state,'blocked');assert.equal(agents[9].prism_activity,undefined);
});
