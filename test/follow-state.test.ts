import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiState} from '../src/tui/screen.ts';
import {clearInspectionOverlays,resumeBoundSelection,boundNoteAdoption} from '../src/runtime/follow.ts';

test('returning to the exact bound agent closes unrelated readers and preserves inspected-session caches and Notes',()=>{
 const state=createUiState();state.selectedKey='claude:child';state.boundSessionKey='codex:native';state.pin=true;state.tab='Refs';state.cursor=9;state.scroll=13;state.readerKey='claude:child:Refs:lineage';state.detailReader={cursor:3,cursorId:'original',scroll:4};state.help=true;state.helpText='old help';state.helpReader={cursor:7,scroll:8};state.detail='old child detail';state.detailDocument={title:'child',sections:[]};state.detailStack=[{text:'older detail',position:{cursor:2,scroll:1}}];state.refParent={text:'parent',position:{cursor:1,scroll:1}};state.refSources={sessionKey:'claude:child',reference:{id:'r',target:'a.ts',messageId:'m',edited:false},sources:[],hasMore:false,partial:false,observedAt:1};state.sourceDetailReader={cursor:2,scroll:3};state.numberPrefix='12';state.pagedMessages.set('claude:child',[{id:'m',role:'assistant',text:'Preserved fixture message'}]);state.notes={sessionKey:'claude:child',title:'Child',text:'Preserved fixture Notes',cursor:0,editing:false,status:'saved'};
 const note=state.notes,messages=state.pagedMessages.get('claude:child');assert.equal(resumeBoundSelection(state),true);
 assert.equal(state.selectedKey,'codex:native');assert.equal(state.pin,false);assert.equal(state.tab,'Overview');assert.equal(state.cursor,0);assert.equal(state.scroll,0);assert.equal(state.cursorId,undefined);assert.equal(state.help,false);assert.equal(state.detail,undefined);assert.equal(state.detailDocument,undefined);assert.equal(state.detailStack,undefined);assert.equal(state.refSources,undefined);assert.equal(state.refParent,undefined);assert.equal(state.sourceDetailReader,undefined);assert.equal(state.numberPrefix,'');
 assert.deepEqual(state.readers.get('claude:child:Refs:lineage'),{cursor:3,cursorId:'original',scroll:4});assert.equal(state.notes,note);assert.equal(state.pagedMessages.get('claude:child'),messages);
});

test('an unavailable binding or unfinished editor/confirmation cannot silently adopt another session',()=>{
 const state=createUiState();state.selectedKey='inspected';state.pin=true;assert.equal(resumeBoundSelection(state),false);assert.equal(state.selectedKey,'inspected');assert.equal(state.pin,true);
 state.boundSessionKey='bound';state.notes={sessionKey:'inspected',title:'Fixture',text:'Unflushed fixture',cursor:0,editing:true,status:'dirty'};assert.equal(resumeBoundSelection(state),false);assert.equal(state.selectedKey,'inspected');state.notes.editing=false;
 state.processConfirmation={sessionKey:'inspected',target:{key:'p',owner:'inspected',pid:42,name:'fixture'}};assert.equal(resumeBoundSelection(state),false);assert.equal(state.processConfirmation.sessionKey,'inspected');
});

test('a following occupant change clears old detail while preserving the chosen content tab',()=>{
 const state=createUiState();state.tab='Messages';state.selectedKey='old';state.detail='old detail';state.detailDocument={title:'old',sections:[]};state.help=true;state.helpText='old help';clearInspectionOverlays(state);
 assert.equal(state.tab,'Messages');assert.equal(state.selectedKey,'old');assert.equal(state.detail,undefined);assert.equal(state.detailDocument,undefined);assert.equal(state.help,false);
});


test('placeholder Notes adoption requires the exact bound verified root and never uses inspected children, foreign panes or rejected identities',()=>{
 const attachment:any={terminal_id:'own',agent:'codex',agent_session:{kind:'id',value:'verified'}};
 const session:any={key:'codex:verified',evidence:{provider:'codex',id:'verified',availability:'known'},attachments:[attachment]};
 assert.deepEqual(boundNoteAdoption(session,'codex:verified','codex:verified','own'),{provider:'codex',terminalId:'own',canonicalKey:'codex:verified'});
 assert.equal(boundNoteAdoption(session,'codex:verified','codex:other','own'),undefined);assert.equal(boundNoteAdoption(session,'codex:verified','codex:verified','foreign'),undefined);
 assert.equal(boundNoteAdoption({...session,parentKey:'codex:parent'},'codex:verified','codex:verified','own'),undefined);assert.equal(boundNoteAdoption({...session,evidence:{...session.evidence,parentId:'parent'}},'codex:verified','codex:verified','own'),undefined);
 assert.equal(boundNoteAdoption({...session,evidence:{...session.evidence,availability:'unavailable'}},'codex:verified','codex:verified','own'),undefined);
 assert.equal(boundNoteAdoption({...session,key:'codex:pane-own',evidence:{...session.evidence,id:'pane-own'}},'codex:pane-own','codex:pane-own','own'),undefined);
 assert.equal(boundNoteAdoption({...session,evidence:{...session.evidence,id:'foreign'}},'codex:verified','codex:verified','own'),undefined);
});
