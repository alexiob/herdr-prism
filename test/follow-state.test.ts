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
test('Notes resolve the panel owner while inspected workers retain their own reader selection',async()=>{
 const {resolveNotesSessionKey}=await import('../src/runtime/follow.ts') as any;assert.equal(typeof resolveNotesSessionKey,'function');
 const state=createUiState();state.selectedKey='codex:worker';state.boundSessionKey='codex:owner';assert.equal(resolveNotesSessionKey(state),'codex:owner');assert.equal(state.selectedKey,'codex:worker');
 state.boundSessionKey=undefined;assert.equal(resolveNotesSessionKey(state),'codex:worker','unbound demo readers retain their selected notebook');state.selectedKey=undefined;assert.equal(resolveNotesSessionKey(state),undefined);
});
test('an editing owner notebook holds its captured identity until the draft is saved',async()=>{
 const {resolveNotesSessionKey}=await import('../src/runtime/follow.ts') as any;assert.equal(typeof resolveNotesSessionKey,'function');
 const state=createUiState();state.selectedKey='codex:worker';state.boundSessionKey='codex:new-owner';state.notes={sessionKey:'codex:old-owner',title:'Fixture',text:'Unsaved fixture',cursor:0,editing:true,status:'dirty'};
 assert.equal(resolveNotesSessionKey(state),'codex:old-owner');assert.equal(state.notes.sessionKey,'codex:old-owner');assert.equal(state.notes.text,'Unsaved fixture');state.notes.editing=false;assert.equal(resolveNotesSessionKey(state),'codex:new-owner');
});
test('inspection parent navigation climbs within the bound owner tree before returning to its owner',async()=>{
 const {inspectionParentKey}=await import('../src/runtime/follow.ts') as any;assert.equal(typeof inspectionParentKey,'function');
 const data:any={sessions:[{key:'owner'},{key:'worker',parentKey:'owner'},{key:'nested',parentKey:'worker'}]},state=createUiState();state.boundSessionKey='owner';state.selectedKey='nested';assert.equal(inspectionParentKey(data,state),'worker');state.selectedKey='worker';assert.equal(inspectionParentKey(data,state),'owner');state.selectedKey='owner';assert.equal(inspectionParentKey(data,state),undefined);
});
test('inspection parent navigation falls back to its owner for missing parents, cycles and pinned foreign roots',async()=>{
 const {inspectionParentKey}=await import('../src/runtime/follow.ts') as any;assert.equal(typeof inspectionParentKey,'function');
 const state=createUiState();state.boundSessionKey='owner';state.selectedKey='worker';const data:any={sessions:[{key:'owner'},{key:'worker',parentKey:'missing'}]};assert.equal(inspectionParentKey(data,state),'owner');
 data.sessions=[{key:'owner'},{key:'worker',parentKey:'loop'},{key:'loop',parentKey:'worker'}];assert.equal(inspectionParentKey(data,state),'owner');
 data.sessions=[{key:'owner'},{key:'foreign-root'},{key:'foreign-worker',parentKey:'foreign-root'}];state.pin=true;state.selectedKey='foreign-worker';assert.equal(inspectionParentKey(data,state),'owner');state.selectedKey='foreign-root';assert.equal(inspectionParentKey(data,state),'owner');state.boundSessionKey=undefined;assert.equal(inspectionParentKey(data,state),undefined);
});

test('cold path placeholders preserve restored canonical selection, notebook identity and reader positions',async()=>{
 const {resolveInspectorBinding,reconcileInspectorSelection,resolveNotesSessionKey}=await import('../src/runtime/follow.ts') as any;
 const path='/fixture/pi/owner.jsonl',attachment={terminal_id:'own',tab_id:'tab',agent:'pi',agent_session:{kind:'path',value:path}};
 const cold:any={sessions:[{key:'pi:'+path,evidence:{provider:'pi',id:path,path,availability:'unavailable'},attachment}]};
 for(const pin of [false,true]){const state=createUiState();state.selectedKey='pi:owner';state.pin=pin;state.tab='Notes';state.notesScroll=17;state.readers.set('pi:owner:Notes:lineage',{cursor:3,scroll:17});const binding=resolveInspectorBinding(cold,'tab','own');state.boundSessionKey=binding.key;state.boundSessionPending=binding.pending;reconcileInspectorSelection(cold,state,state.boundSessionKey,true);assert.equal(state.selectedKey,'pi:owner');assert.equal(resolveNotesSessionKey(state),undefined,'cold unverified owner must not open a path-key notebook');assert.equal(state.notesScroll,17);assert.deepEqual(state.readers.get('pi:owner:Notes:lineage'),{cursor:3,scroll:17});
  const known:any={sessions:[{key:'pi:owner',evidence:{provider:'pi',id:'owner',path,availability:'known'},attachment}]};const resolved=resolveInspectorBinding(known,'tab','own',state.boundSessionKey);state.boundSessionKey=resolved.key;state.boundSessionPending=resolved.pending;reconcileInspectorSelection(known,state,state.boundSessionKey);assert.equal(state.selectedKey,'pi:owner');assert.equal(resolveNotesSessionKey(state),'pi:owner');assert.equal(state.notesScroll,17);
 }
});
test('known notebook owner survives path hydration while a confirmed replacement advances owner without moving a pinned worker',async()=>{
 const {resolveInspectorBinding,reconcileInspectorSelection,resolveNotesSessionKey}=await import('../src/runtime/follow.ts') as any;
 const path='/fixture/pi/owner.jsonl',attachment={terminal_id:'own',tab_id:'tab',agent:'pi',agent_session:{kind:'path',value:path}},state=createUiState();state.selectedKey='pi:worker';state.pin=true;state.boundSessionKey='pi:owner';state.tab='Notes';state.notes={sessionKey:'pi:owner',title:'Owner',text:'',cursor:0,editing:false,status:'saved'};state.notesScroll=23;
 const cold:any={sessions:[{key:'pi:'+path,evidence:{provider:'pi',id:path,path,availability:'unavailable'},attachment},{key:'pi:worker',evidence:{provider:'pi',id:'worker',availability:'known'}}]};let binding=resolveInspectorBinding(cold,'tab','own',state.boundSessionKey);state.boundSessionKey=binding.key;state.boundSessionPending=binding.pending;reconcileInspectorSelection(cold,state,state.boundSessionKey);assert.equal(state.selectedKey,'pi:worker');assert.equal(resolveNotesSessionKey(state),'pi:owner');assert.equal(state.notesScroll,23);
 const next:any={sessions:[{key:'pi:new-owner',evidence:{provider:'pi',id:'new-owner',path:'/fixture/pi/new-owner.jsonl',availability:'known'},attachment:{...attachment,agent_session:{kind:'path',value:'/fixture/pi/new-owner.jsonl'}}}]};binding=resolveInspectorBinding(next,'tab','own',state.boundSessionKey);state.boundSessionKey=binding.key;state.boundSessionPending=binding.pending;reconcileInspectorSelection(next,state,state.boundSessionKey);assert.equal(state.selectedKey,'pi:worker','a missing pinned worker is preserved');assert.equal(resolveNotesSessionKey(state),'pi:new-owner');state.pin=false;reconcileInspectorSelection(next,state,state.boundSessionKey);assert.equal(state.selectedKey,'pi:new-owner');
});
test('cold bound ownership never chooses a pinned foreign notebook and retains intended initial pane placeholders',async()=>{
 const {resolveInspectorBinding,resolveNotesSessionKey}=await import('../src/runtime/follow.ts') as any;
 const state=createUiState();state.selectedKey='claude:foreign';state.pin=true;state.boundSessionPending=true;assert.equal(resolveNotesSessionKey(state),undefined);
 const pane:any={key:'pi:pane-own',evidence:{provider:'pi',id:'pane-own',availability:'unavailable'},attachment:{terminal_id:'own',tab_id:'tab',agent:'pi'}};assert.deepEqual(resolveInspectorBinding({sessions:[pane]},'tab','own'),{key:'pi:pane-own',pending:false});assert.deepEqual(resolveInspectorBinding({sessions:[pane]},'other-tab','own','pi:owner'),{key:'pi:owner',pending:true});
});
test('restored selections hold through a cold no-reference native pane without borrowing a pinned worker notebook',async()=>{
 const {resolveInspectorBinding,reconcileInspectorSelection,resolveNotesSessionKey}=await import('../src/runtime/follow.ts') as any;
 const data:any={sessions:[{key:'pi:pane-own',evidence:{provider:'pi',id:'pane-own',availability:'unavailable'},attachment:{terminal_id:'own',tab_id:'tab',agent:'pi'}}]};
 for(const [selectedKey,pin]of [['pi:owner',false],['claude:foreign-worker',true],['pi:pane-foreign',true]] as const){const state=createUiState();state.selectedKey=selectedKey;state.pin=pin;state.tab='Notes';const binding=resolveInspectorBinding(data,'tab','own',undefined,{restoredSelection:selectedKey});state.boundSessionKey=binding.key;state.boundSessionPending=binding.pending;reconcileInspectorSelection(data,state,state.boundSessionKey,true);assert.equal(state.selectedKey,selectedKey);assert.equal(state.boundSessionKey,undefined);assert.equal(resolveNotesSessionKey(state),undefined,'neither pane placeholder nor inspected worker owns the restored notebook');}
 assert.deepEqual(resolveInspectorBinding(data,'tab','own'),{key:'pi:pane-own',pending:false},'a genuinely fresh panel still supports its exact pane notebook');assert.deepEqual(resolveInspectorBinding(data,'tab','own',undefined,{restoredSelection:'pi:pane-own'}),{key:'pi:pane-own',pending:false},'restoring the exact own pane notebook never freezes hydration');
});
