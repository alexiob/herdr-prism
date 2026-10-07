import test from 'node:test';import assert from 'node:assert/strict';
import {NotesStore} from '../src/state/notes.ts';import {freshPrivateDirectory} from './helpers/private-dir.ts';import {join} from 'node:path';import {tmpdir} from 'node:os';import {rm,readFile,writeFile} from 'node:fs/promises';
import {InputDecoder} from '../src/tui/input.ts';
const editor=await import('../src/tui/notes.ts').catch(()=>({})) as any;
test('Notes editor inserts navigation letters, handles multiline Unicode edits and flushes original identity',async t=>{
 assert.equal(typeof editor.NotesController,'function');const dir=await freshPrivateDirectory(join(tmpdir(),'prism-editor-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new NotesStore(dir),controller=new editor.NotesController(store,10);await controller.open('codex:one','One');controller.begin();for(const key of ['q','p','space','😀','enter','A','B','left','delete','home','Z','end'])controller.key(key);assert.equal(controller.value.text,'qp 😀\nZA');await controller.end();assert.equal((await store.load('codex:one')).text,'qp 😀\nZA');await controller.open('codex:two','Two');assert.equal(controller.value.text,'');
});
test('autosave and edits during a save retain newest draft and recover an external conflict',async t=>{
 assert.equal(typeof editor.NotesController,'function');const dir=await freshPrivateDirectory(join(tmpdir(),'prism-editor-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new NotesStore(dir),slowStore={load:(key:string)=>store.load(key),save:async(...args:any[])=>{await new Promise(r=>setTimeout(r,120));return store.save(args[0],args[1],args[2],args[3]);}},controller=new editor.NotesController(slowStore,10);await controller.open('codex:one','One');controller.begin();controller.paste('# Notes\n日本語\n');const deadline=Date.now()+10000;while(controller.value.status!=='saved'){assert.ok(Date.now()<deadline,'Autosave did not complete');if(controller.value.status==='error')throw new Error(controller.value.error);await new Promise(r=>setTimeout(r,10));}assert.equal((await store.load('codex:one')).text,'# Notes\n日本語\n');
 const note=await store.load('codex:one');await writeFile(note.path,'External',{mode:0o600});controller.paste('draft');await controller.flush();assert.equal(controller.value.status,'conflict');assert.equal(await readFile(note.path,'utf8'),'External');assert.ok(controller.value.recoveryPath);controller.paste(' newer');await controller.close();assert.equal(await readFile(controller.value.recoveryPath,'utf8'),'# Notes\n日本語\ndraft newer');
});
test('bracketed paste is one bounded event across chunks and cannot invoke navigation commands',()=>{
 const decoder=new InputDecoder();assert.deepEqual(decoder.feed('\x1b[200~q\np'),[]);assert.deepEqual(decoder.feed('\\\x1b[201'),[]);assert.deepEqual(decoder.feed('~'),[{type:'paste',text:'q\np\\'}]);assert.deepEqual(decoder.feed('\x13\x1b[3~'),[{type:'key',key:'ctrl+s'},{type:'key',key:'delete'}]);
});
test('Notes source keeps Markdown spacing, styles headings and exposes only the edit action',async()=>{
 const {createUiState,renderScreen,handleKey}=await import('../src/tui/screen.ts');const {demoData}=await import('../src/runtime/demo.ts');const {cellWidth}=await import('../src/tui/text.ts');const data=demoData(),state=createUiState();state.tab='Notes';state.selectedKey=data.sessions[0]!.key;state.notes={sessionKey:state.selectedKey,title:'Original agent',text:'# Heading\n\n    code    spaces\n'+('日本語 long line '.repeat(30)),cursor:0,editing:false,status:'saved'};
 for(const width of [12,36,50,80,120]){const frame=renderScreen(data,state,width,34);for(const parts of frame.spans??[])assert.ok(cellWidth(parts.map(s=>s.text).join(''))<=width);assert.equal(frame.rows[0]?.action?.type,'notes-edit');assert.ok(frame.spans?.flat().some(s=>s.role==='accent'));}
 const frame=renderScreen(data,state,80,34);assert.match(frame.lines.join('\n'),/    code    spaces/);handleKey(state,'?',data,frame);assert.match(renderScreen(data,state,80,34).lines.join('\n'),/500 ms/);
 state.help=false;state.notes.editing=true;state.notes.cursor=state.notes.text.length;const missing={...data,sessions:[]};const edited=renderScreen(missing,state,36,18);assert.match(edited.lines[0]! ,/Original agent/);assert.ok(edited.terminalCursor);assert.ok(edited.terminalCursor!.line<=16);assert.equal(state.notes.sessionKey,'codex:demo-root');
});
test('a small or resized Notes pane visibly pauses editing without accepting hidden text',async t=>{
 const dir=await freshPrivateDirectory(join(tmpdir(),'prism-editor-small-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new NotesStore(dir),controller=new editor.NotesController(store,10);await controller.open('codex:one','One');controller.begin();controller.paste('Original');await controller.flush();controller.key('q',{columns:36,height:8});controller.paste('hidden',{columns:36,height:8});controller.key('q',{columns:12,height:10});controller.paste('hidden',{columns:12,height:10});assert.equal(controller.value.text,'Original');
 const {createUiState,renderScreen}=await import('../src/tui/screen.ts'),{demoData}=await import('../src/runtime/demo.ts');const data=demoData(),state=createUiState();state.tab='Notes';state.selectedKey=data.sessions[0]!.key;state.notes=controller.value;const frame=renderScreen(data,state,36,8);assert.match(frame.lines.join('\n'),/Editing paused/);assert.equal(frame.terminalCursor,undefined);assert.equal(frame.rows.some(row=>row.action?.type==='notes-edit'),false);
 await controller.end();assert.equal((await store.load('codex:one')).text,'Original');controller.begin({columns:36,height:8});assert.equal(controller.value.editing,false);
});

test('Notes distinguish an absent notebook from a deliberately saved empty notebook',async t=>{
 const {createUiState}=await import('../src/tui/screen.ts');const {renderNotes}=await import('../src/tui/notes.ts');
 const dir=await freshPrivateDirectory(join(tmpdir(),'prism-editor-persisted-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new NotesStore(dir),controller=new editor.NotesController(store,10000);t.after(()=>controller.close());
 await controller.open('codex:owner','Owner');assert.equal(controller.value.persisted,false);assert.equal(controller.value.status,'saved');
 const state=createUiState();state.tab='Notes';state.selectedKey='codex:owner';state.notes=controller.value;
 const data={sessions:[],updatedAt:0,stale:false,diagnostics:[]};let frame=renderNotes(data,state,50,18,0);
 assert.match(frame.lines.at(-2)!,/^Empty/);assert.doesNotMatch(frame.lines.at(-2)!,/Saved/);assert.match(frame.rows[0]!.text,/Open editor/);
 controller.begin();controller.key('a');controller.key('backspace');await controller.flush();assert.equal(controller.value.persisted,true);
 await controller.end();state.notes=controller.value;frame=renderNotes(data,state,50,18,0);assert.match(frame.lines.at(-2)!,/^Saved/);
 await controller.open('codex:owner','Owner',true);assert.equal(controller.value.persisted,true);assert.equal(controller.value.text,'');
});
