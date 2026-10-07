import test from 'node:test';
import assert from 'node:assert/strict';
import {demoData} from '../src/runtime/demo.ts';
import {createUiState,renderScreen,handleKey,handleRowClick,showDetail} from '../src/tui/screen.ts';

test('normal Overview header uses the agent name and two metadata lines without a Prism prefix or protocol jargon',()=>{
 const data=demoData();data.demo=false;data.sessions[0]!.evidence.title='My agent';const state=createUiState();state.selectedKey=data.sessions[0]!.key;state.boundSessionKey=state.selectedKey;
 const frame=renderScreen(data,state,100,40);assert.match(frame.lines[0]!,/^My agent/);assert.ok(frame.lines[2]!.includes('[Overview]'));assert.doesNotMatch(frame.lines.slice(0,frame.bodyStart).join('\n'),/Prism ·|Self \+ jobs|Follow|local\/main/);
});
test('a recorded worker has a human label and a return action rather than empty CPU and RSS charts',()=>{
 const data=demoData();data.demo=false;const worker=data.sessions[1]!;worker.evidence.title=undefined;worker.evidence.id='01a111d6-1512-7e73-8926-f28211052a4c';worker.evidence.provider='codex';worker.evidence.state='done';delete worker.attachment;worker.attachments=[];delete worker.resource;delete worker.history;
 const state=createUiState();state.selectedKey=worker.key;state.boundSessionKey=data.sessions[0]!.key;
 const frame=renderScreen(data,state,60,34);assert.match(frame.lines[0]!,/^Codex worker/);assert.match(frame.lines.join('\n'),/Recorded worker/);assert.match(frame.lines.join('\n'),/Shift\+F/);assert.ok(!frame.rows.some(row=>row.id==='cpu'||row.id==='memory'));const back=frame.rows.find(row=>row.id==='resource-owner')!;assert.ok(back);assert.match(back.help!,/no live process/i);state.cursor=frame.rows.indexOf(back);state.cursorId=back.id;assert.equal(handleKey(state,'enter',data,frame)?.type,'follow-bound');assert.equal(handleKey(state,'enter',data,frame)?.sessionKey,state.boundSessionKey);
});
test('Notes header and edit target stay on the panel owner while another worker is inspected',()=>{
 const data=demoData(),state=createUiState();data.demo=false;data.sessions[0]!.evidence.title='Owner notebook';state.selectedKey=data.sessions[1]!.key;state.boundSessionKey=data.sessions[0]!.key;state.tab='Notes';state.notes={sessionKey:state.boundSessionKey,title:'Owner notebook',text:'Existing saved Markdown',cursor:0,editing:false,persisted:true,status:'saved'};
 const frame=renderScreen(data,state,60,24);assert.match(frame.lines[0]!,/^Owner notebook/);assert.match(frame.lines.join('\n'),/Existing saved Markdown/);assert.equal(frame.rows[0]!.action?.sessionKey,state.boundSessionKey);assert.equal(state.selectedKey,data.sessions[1]!.key);
});

test('worker navigation exposes clickable owner and parent actions without changing its native binding',()=>{
 const data=demoData(),state=createUiState(),owner=data.sessions[0]!,parent=data.sessions[1]!;data.demo=false;parent.evidence.title='Parser';
 const worker={...parent,key:'codex:worker',parentKey:parent.key,children:[],depth:2,evidence:{...parent.evidence,id:'worker',title:'Verifier'}};data.sessions.push(worker);state.selectedKey=worker.key;state.boundSessionKey=owner.key;
 const frame=renderScreen(data,state,60,34),navigation=frame.navigationRegions!;assert.ok(navigation?.length);assert.ok(navigation.some(region=>region.action.type==='follow-bound'&&region.action.sessionKey===owner.key));assert.ok(navigation.some(region=>region.action.type==='select'&&region.action.sessionKey===parent.key));
 assert.match(frame.lines.slice(0,frame.bodyStart).join('\n'),/Parent|Owning agent/);assert.equal(handleKey(state,'backspace',data,frame)?.sessionKey,parent.key);assert.equal(handleKey(state,'escape',data,frame)?.sessionKey,parent.key);assert.equal(handleKey(state,'F',data,frame)?.sessionKey,owner.key);assert.equal(state.boundSessionKey,owner.key);for(const region of navigation)assert.deepEqual(handleRowClick(state,region.x,region.y,data,frame),region.action);for(const width of [1,8,26,60,120])for(const height of [1,8,24]){const small=renderScreen(data,state,width,height);for(const region of small.navigationRegions??[])assert.ok(region.x>=1&&region.x+region.width-1<=width&&region.y>=1&&region.y<=height);}
});

test('worker parent navigation does not steal Backspace or Escape from help and details',()=>{
 const data=demoData(),state=createUiState();state.boundSessionKey=data.sessions[0]!.key;state.selectedKey=data.sessions[1]!.key;let frame=renderScreen(data,state,60,34);handleKey(state,'?',data,frame);frame=renderScreen(data,state,60,34);assert.equal(handleKey(state,'backspace',data,frame),undefined);assert.ok(state.help);assert.equal(handleKey(state,'escape',data,frame),undefined);assert.equal(state.help,false);showDetail(state,'Worker details');frame=renderScreen(data,state,60,34);assert.equal(handleKey(state,'backspace',data,frame),undefined);assert.ok(state.detail);assert.equal(handleKey(state,'escape',data,frame),undefined);assert.equal(state.detail,undefined);
});

test('a temporarily missing notebook owner never displays the inspected worker identity above its notes',()=>{
 const data=demoData(),state=createUiState();state.boundSessionKey=data.sessions[0]!.key;state.selectedKey=data.sessions[1]!.key;state.tab='Notes';state.notes={sessionKey:state.boundSessionKey,title:'Owner notebook',text:'Owner saved notes',cursor:0,editing:false,persisted:true,status:'saved'};data.sessions=[data.sessions[1]!];const frame=renderScreen(data,state,60,24);assert.match(frame.lines[0]!,/Owner notebook/);assert.match(frame.lines.join('\n'),/Owner saved notes/);assert.equal(frame.rows[0]!.action?.sessionKey,state.boundSessionKey);
});

test('a previous owner notebook cannot supply the title while the new owner is unavailable',()=>{
 const data=demoData(),state=createUiState();state.boundSessionKey='codex:new-owner';state.selectedKey=data.sessions[1]!.key;state.tab='Notes';state.notes={sessionKey:data.sessions[0]!.key,title:'Previous notebook',text:'Previous private notes',cursor:0,editing:false,status:'saved'};const frame=renderScreen(data,state,60,24);assert.doesNotMatch(frame.lines.join('\n'),/Previous notebook|Previous private notes/);assert.match(frame.lines[0]!,/Agent unavailable/);
});

test('Escape cancels a numeric agent target before returning to its parent',()=>{
 const data=demoData(),state=createUiState();state.boundSessionKey=data.sessions[0]!.key;state.selectedKey=data.sessions[1]!.key;state.tab='Agents';let frame=renderScreen(data,state,60,24);handleKey(state,'1',data,frame);assert.equal(state.numberPrefix,'1');assert.equal(handleKey(state,'escape',data,frame),undefined);assert.equal(state.numberPrefix,'');assert.equal(state.selectedKey,data.sessions[1]!.key);
});

test('an explicit human session title remains useful even when it matches a human session identifier',()=>{
 const data=demoData(),state=createUiState();data.sessions[0]!.evidence.title='Build assistant';data.sessions[0]!.evidence.id='Build assistant';state.selectedKey=data.sessions[0]!.key;state.boundSessionKey=state.selectedKey;assert.match(renderScreen(data,state,60,24).lines[0]!,/Build assistant/);
});
