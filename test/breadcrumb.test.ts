import test from 'node:test';
import assert from 'node:assert/strict';
import {demoData} from '../src/runtime/demo.ts';
import {createUiState,renderScreen,handleRowClick} from '../src/tui/screen.ts';
import {cellWidth} from '../src/tui/text.ts';

function fixture(){
 const data=demoData(),state=createUiState(),owner=data.sessions[0]!,parent=data.sessions[1]!;data.demo=false;owner.evidence.title='Project agent';parent.evidence.title='Parser';
 const worker={...parent,key:'codex:verifier',parentKey:parent.key,children:[],evidence:{...parent.evidence,id:'verifier',title:'Verifier'}};data.sessions.push(worker);state.boundSessionKey=owner.key;state.selectedKey=worker.key;return{data,state,owner,parent,worker};
}
test('first line displays the owning agent and every recorded ancestor in order, with current worker emphasized',()=>{
 const {data,state}=fixture(),frame=renderScreen(data,state,80,34);assert.equal(frame.lines[0]!.trim(),'Project agent > Parser > Verifier');const current=frame.spans![0]!.find(s=>s.text==='Verifier')!;assert.equal(current.role,'accent');assert.equal(current.bold,true);
});
test('breadcrumb ancestors navigate to their exact sessions while the current worker and separators are inert',()=>{
 const {data,state,owner,parent}=fixture(),frame=renderScreen(data,state,80,34);assert.deepEqual(handleRowClick(state,1,1,data,frame),{type:'follow-bound',sessionKey:owner.key});assert.deepEqual(handleRowClick(state,17,1,data,frame),{type:'select',sessionKey:parent.key});assert.equal(handleRowClick(state,14,1,data,frame),undefined);assert.equal(handleRowClick(state,26,1,data,frame),undefined);assert.equal(state.selectedKey,'codex:verifier');
});
test('narrow breadcrumbs keep the current worker visible and all drawn click targets inside the screen',()=>{
 const {data,state,owner,parent}=fixture();owner.evidence.title='Project agent with a very long title';parent.evidence.title='Parser with a very long title';
 for(const width of [1,8,12,20,26,40,60,120])for(const height of [1,8,34]){const frame=renderScreen(data,state,width,height);assert.ok(frame.lines.every(line=>cellWidth(line)<=width));for(const r of frame.navigationRegions??[])assert.ok(r.x>=1&&r.x+r.width-1<=width&&r.y>=1&&r.y<=height);if(width>=12&&height===34)assert.match(frame.lines[0]!,/Verifier$/);}
 const narrow=renderScreen(data,state,26,34);assert.match(narrow.lines[0]!,/… > Verifier$/);
});
test('broken or cyclic ancestry shows a gap rather than inventing a relationship to another tree',()=>{
 const {data,state,parent,worker}=fixture();parent.parentKey=worker.key;let frame=renderScreen(data,state,80,34);assert.equal(frame.lines[0]!.trim(),'Project agent > … > Verifier');assert.ok(!frame.navigationRegions?.some(r=>r.y===1&&r.action.sessionKey===parent.key));parent.parentKey='missing';frame=renderScreen(data,state,80,34);assert.equal(frame.lines[0]!.trim(),'Project agent > … > Verifier');
});
test('a long current name still leaves a visible owner breadcrumb in a narrow panel',()=>{
 const {data,state,owner,worker}=fixture();owner.evidence.title='Project with a long title';worker.evidence.title='Verifier with a long unique title';const frame=renderScreen(data,state,26,34);assert.match(frame.lines[0]!,/^Pro.* > .*Ver/);assert.ok(frame.navigationRegions?.some(r=>r.y===1&&r.action.sessionKey===owner.key));
});
test('empty or loading snapshots retain a usable unavailable breadcrumb',()=>{
 const state=createUiState(),data=demoData();data.demo=false;data.sessions=[];assert.match(renderScreen(data,state,60,24).lines[0]!,/Agent unavailable/);
});
test('Unicode breadcrumb click regions use terminal cells instead of string offsets',()=>{
 const {data,state,owner,parent,worker}=fixture();owner.evidence.title='项目';parent.evidence.title='🔍 parser';worker.evidence.title='Check';const frame=renderScreen(data,state,32,34);assert.equal(frame.lines[0]!.trim(),'项目 > 🔍 parser > Check');assert.equal(handleRowClick(state,2,1,data,frame)?.sessionKey,owner.key);assert.equal(handleRowClick(state,8,1,data,frame)?.sessionKey,parent.key);assert.equal(handleRowClick(state,20,1,data,frame),undefined);
});
test('an unavailable inspected worker never takes the owning agent name or facts in its breadcrumb',()=>{
 const {data,state,owner}=fixture();data.sessions=[owner];state.selectedKey='codex:missing-worker';state.pin=true;const frame=renderScreen(data,state,80,34);assert.equal(frame.lines[0]!.trim(),'Project agent > … > Agent unavailable');assert.ok(frame.rows.every(row=>row.selectable===false&&!row.action));assert.equal(state.selectedKey,'codex:missing-worker');
});
test('multiline names are displayed on one line and breadcrumb clicks match their visible columns',()=>{
 const {data,state,owner,parent,worker}=fixture();owner.evidence.title='Owner\nInjected';parent.evidence.title='Parent\tTabbed';worker.evidence.title='Current';const frame=renderScreen(data,state,80,34);assert.equal(frame.lines[0]!.trim(),'Owner Injected > Parent Tabbed > Current');assert.equal(handleRowClick(state,18,1,data,frame)?.sessionKey,parent.key);assert.ok(frame.lines.every(line=>!/[\r\n\t]/.test(line)));
});
test('a captured notebook name remains one line while its owner is temporarily absent',()=>{
 const {data,state}=fixture();data.sessions=[];state.tab='Notes';state.notes={sessionKey:state.boundSessionKey!,title:'Owner\nNotebook',text:'Saved source\nretained exactly',cursor:0,editing:false,status:'saved'};const frame=renderScreen(data,state,60,24);assert.equal(frame.lines[0]!.trim(),'Owner Notebook');assert.equal(state.notes.text,'Saved source\nretained exactly');
});
