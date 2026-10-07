import test from 'node:test';
import assert from 'node:assert/strict';
import {demoData} from '../src/runtime/demo.ts';
import {createUiState,renderScreen,handleKey,showDetail} from '../src/tui/screen.ts';
import {processDocument} from '../src/tui/facts.ts';
import {documentText} from '../src/tui/widgets.ts';

function fixture(){const data=demoData(),state=createUiState();state.boundSessionKey=data.sessions[0]!.key;state.selectedKey=data.sessions[1]!.key;delete data.sessions[1]!.attachment;data.sessions[1]!.attachments=[];return{data,state};}
test('manual transcript inspection is labeled independently of Follow, with a return shortcut',()=>{
 for(const width of [26,60,120]){const {data,state}=fixture();const frame=renderScreen(data,state,width,34),text=frame.lines.join('\n');assert.match(text,/Worker|Recorded worker/);assert.match(text,/Shift\+F/);assert.ok(!frame.lines.some(line=>/· Follow$/.test(line)));assert.deepEqual(handleKey(state,'F',data,frame),{type:'follow-bound',sessionKey:data.sessions[0]!.key});assert.equal(state.selectedKey,data.sessions[1]!.key,'UI action does not focus or change selection itself');}
});
test('bound selection remains Follow and pinning remains Pinned',()=>{
 const {data,state}=fixture();state.selectedKey=data.sessions[0]!.key;let frame=renderScreen(data,state,120,34);assert.match(frame.lines.join('\n'),/Follow/);assert.doesNotMatch(frame.lines.join('\n'),/Inspecting|Transcript only/);
 state.selectedKey=data.sessions[1]!.key;state.pin=true;frame=renderScreen(data,state,120,34);assert.match(frame.lines.join('\n'),/Pinned/);assert.doesNotMatch(frame.lines.join('\n'),/Inspecting/);
});
test('Shift+F stays inert in help and frozen confirmation, while editors retain literal text',()=>{
 const {data,state}=fixture();let frame=renderScreen(data,state,80,34);handleKey(state,'?',data,frame);frame=renderScreen(data,state,80,34);assert.match(state.helpText!,/Shift\+F/);const before=state.helpText;assert.equal(handleKey(state,'F',data,frame),undefined);assert.equal(state.helpText,before);handleKey(state,'escape',data,frame);
 state.editingFilter=true;assert.equal(handleKey(state,'F',data,frame),undefined);assert.equal(state.filter,'F');state.editingFilter=false;state.filter='';
 state.notes={sessionKey:state.selectedKey!,title:'Draft',text:'',cursor:0,editing:true,status:'dirty'};assert.equal(handleKey(state,'F',data,frame),undefined);assert.equal(state.notes.text,'');state.notes=undefined;
 state.selectedKey=data.sessions[0]!.key;state.tab='Processes';const doc=processDocument(data.sessions[0]!,data.sessions[0]!.resource!.processes[0]!,1);showDetail(state,documentText(doc),doc);frame=renderScreen(data,state,80,34);handleKey(state,'K',data,frame);assert.ok(state.processConfirmation);const frozen=structuredClone(state.processConfirmation);assert.equal(handleKey(state,'F',data,renderScreen(data,state,80,34)),undefined);assert.deepEqual(state.processConfirmation,frozen);
});
test('process output controls keep refresh, termination and return-to-bound hints when space permits',()=>{
 const {data,state}=fixture(),session=data.sessions[0]!,target=session.resource!.processes[0]!;state.tab='Processes';const doc=processDocument(session,target,1);showDetail(state,documentText(doc),doc);const frame=renderScreen(data,state,120,34),footer=frame.lines.at(-1)!;for(const hint of ['r output','Shift+K','Esc','Shift+F'])assert.ok(footer.includes(hint),hint);
});
test('Notes read mode retains the owning notebook and return hint even when the header is shortened',()=>{
 for(const width of [26,60,120])for(const height of [8,10,34]){
  const {data,state}=fixture();state.tab='Notes';state.notes={sessionKey:state.boundSessionKey!,title:'Fixture',text:'Fixture notes',cursor:0,editing:false,status:'saved',savedAt:1};
  const frame=renderScreen(data,state,width,height);assert.doesNotMatch(frame.lines.at(-2)!,/Transcript only/);assert.equal(frame.rows[0]!.action?.sessionKey,state.boundSessionKey);assert.match(frame.lines.at(-1)!,/Shift\+F/);
  if(height===34)assert.match(frame.lines.at(-2)!,/^Saved/);
 }
});
test('Notes inspection preserves save errors, notices and literal editing controls',()=>{
 const {data,state}=fixture();state.tab='Notes';state.notes={sessionKey:state.boundSessionKey!,title:'Fixture',text:'Fixture notes',cursor:0,editing:false,status:'error',error:'Save failed'};
 let frame=renderScreen(data,state,60,34);assert.match(frame.lines.at(-2)!,/^Save failed/);assert.match(frame.lines.at(-1)!,/Shift\+F/);
 state.notice='External notice';frame=renderScreen(data,state,60,34);assert.match(frame.lines.at(-2)!,/^External notice/);
 state.notice=undefined;state.notes.error=undefined;state.notes.status='saved';state.notes.editing=true;frame=renderScreen(data,state,60,34);assert.match(frame.lines.at(-1)!,/^Ctrl\+S save · Esc read · Tab leave/);assert.doesNotMatch(frame.lines.at(-1)!,/Shift\+F/);assert.match(frame.lines.at(-2)!,/^Editing · Saved/);
 state.notes.editing=false;state.pin=true;frame=renderScreen(data,state,60,34);assert.doesNotMatch(frame.lines.at(-2)!,/Transcript only|Inspecting/);assert.doesNotMatch(frame.lines.at(-1)!,/Shift\+F/);
});
