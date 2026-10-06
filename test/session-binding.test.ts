import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Collector} from '../src/runtime/collector.ts';
import {ProviderIndex} from '../src/providers/index.ts';

test('Codex cross-project hook reports never hydrate or attach the other transcript',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'prism-binding-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const left=path.join(dir,'locai'),right=path.join(dir,'prism'),home=path.join(dir,'codex');
 await mkdir(left);await mkdir(right);await mkdir(path.join(home,'sessions'),{recursive:true});
 await writeFile(path.join(home,'sessions','wrong.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'wrong',cwd:right}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Wrong project private message'}]}})+'\n');
 const agent:any={pane_id:'left',terminal_id:'left-terminal',workspace_id:'w',tab_id:'locai',agent:'codex',agent_status:'idle',agent_session:{source:'herdr:codex',kind:'id',value:'wrong'},cwd:left,foreground_cwd:left,focused:true,revision:1};
 const index=new ProviderIndex({codexHome:home,claudeHome:path.join(dir,'claude'),piHome:path.join(dir,'pi'),directoryScanMs:0});
 const collector=new Collector({rpc:{call:async()=>({snapshot:{protocol:22,agents:[agent],panes:[],tabs:[],workspaces:[],layouts:[],focused_pane_id:'left'}})} as any,index,paneOpen:true,settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:false,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:true},stateDir:path.join(dir,'state'),git:{get:async()=>({availability:'unavailable'}),close(){}} as any,sampler:{sample:async()=>{throw Error('unexpected sampler')},async close(){}}});t.after(()=>collector.close());
 await collector.init();await collector.refresh();
 const view=collector.data.sessions.find(s=>s.attachment?.terminal_id==='left-terminal')!;
 assert.equal(view.evidence.id,'pane-left-terminal');
 assert.equal(view.evidence.availability,'unavailable');assert.match(view.evidence.reason!,/different.*directory/i);
 assert.equal(view.evidence.messages.length,0);
 assert.equal(index.resolveSnapshotCached('codex',{kind:'id',value:'wrong'})?.messages.length,0,'invalid report must be rejected before body hydration');
 assert.equal(collector.displayedSessionKey,view.key);
 // Realpath equality accepts compatibility symlinks, and a corrected hook starts normal collection.
 const alias=path.join(dir,'alias');await symlink(right,alias,process.platform==='win32'?'junction':'dir');agent.cwd=alias;agent.foreground_cwd=right;
 await collector.refresh();await collector.refresh();
 const corrected=collector.data.sessions.find(s=>s.attachment?.terminal_id==='left-terminal')!;
 assert.equal(corrected.key,'codex:wrong');assert.equal(corrected.evidence.messages.length,1);
 assert.equal(collector.displayedSessionKey,corrected.key,'an unavailable pane follows a corrected identity');
 // A previously hydrated ID becomes a path reader. Rejection must still close that reader.
 agent.cwd=left;agent.foreground_cwd=left;
 const {appendFile}=await import('node:fs/promises');await appendFile(path.join(home,'sessions','wrong.jsonl'),JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'After identity conflict'}]}})+'\n');
 await collector.refresh();
 assert.equal(collector.data.sessions.find(s=>s.attachment?.terminal_id==='left-terminal')!.evidence.id,'pane-left-terminal');
 assert.equal(index.resolveSnapshotCached('codex',{kind:'id',value:'wrong'})?.messages.length,0,'hydrated path readers must stop on a later conflict');
});
