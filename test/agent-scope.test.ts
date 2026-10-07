import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentRows} from '../src/tui/agents.ts';
import {createUiState} from '../src/tui/screen.ts';
import type {DashboardData,SessionView} from '../src/tui/types.ts';

function session(key:string,parentKey?:string,extra:Partial<SessionView>={}):SessionView{
 return {key,parentKey,depth:99,children:[],evidence:{id:key,provider:'codex',title:key,state:'working',messages:[],tools:[],usage:[],goals:[],availability:'known'},...extra};
}
function render(sessions:SessionView[],owner?:string,view:'lineage'|'worktrees'='lineage'){
 const data:DashboardData={sessions,updatedAt:1,stale:false,diagnostics:[]};const state=createUiState();state.tab='Agents';state.boundSessionKey=owner;state.selectedKey='unrelated';state.view=view;const numeric=new Map<number,string>();return {data,state,numeric,rows:agentRows(data,state,numeric,80)};
}
test('Agents anchors to its panel owner and walks actual parent relationships in relative DFS order',()=>{
 const input=[session('grandchild','child'),session('unrelated'),session('owner','ancestor'),session('sibling','ancestor'),session('child','owner'),session('ancestor')];
 const {rows,numeric}=render(input,'owner');
 assert.deepEqual(rows.filter(r=>r.action).map(r=>r.id),['owner','child','grandchild']);assert.deepEqual([...numeric.values()],['owner','child','grandchild']);
 assert.match(rows[0]!.text,/^▾ A1 owner/);assert.match(rows[1]!.text,/^  ▾ A2 child/);assert.match(rows[2]!.text,/^    · A3 grandchild/);assert.ok(rows.every(r=>!r.text.includes('d99')));
 assert.equal(rows[0]!.action?.sessionKey,'owner');assert.ok(rows[0]!.document);assert.equal(rows[0]!.disclosureColumn,1);
});
test('owner tree handles parent cycles once and folds actual descendants even with empty cached child lists',()=>{
 const {data,state,numeric,rows}=render([session('owner','grandchild'),session('child','owner'),session('grandchild','child'),session('other')],'owner');
 assert.deepEqual(rows.filter(r=>r.action).map(r=>r.id),['owner','child','grandchild']);state.collapsed.add('child');numeric.clear();
 assert.deepEqual(agentRows(data,state,numeric,80).filter(r=>r.action).map(r=>r.id),['owner','child']);assert.deepEqual([...numeric.values()],['owner','child']);
});
test('worktree groups contain only owner descendants and expose nonselectable checkout context',()=>{
 const git=(root:string,branch:string)=>({familyKey:'family',checkoutKey:root,root,branch,availability:'known',sampledAt:1} as SessionView['git']);
 const {rows,numeric}=render([session('owner',undefined,{git:git('/repo/main','main')}),session('child','owner',{git:git('/repo/worker','worker')}),session('unrelated',undefined,{git:git('/private/unrelated','secret')})],'owner','worktrees');
 assert.deepEqual([...numeric.values()],['owner','child']);assert.ok(rows.filter(r=>r.id.startsWith('checkout:')).every(r=>r.selectable===false&&!r.action));assert.match(rows.map(r=>r.text).join('\n'),/\/repo\/worker.*worker/);assert.ok(!JSON.stringify(rows).includes('/private/unrelated'));
});
test('root without recorded children remains inspectable and reports an honest empty descendant state',()=>{
 const {rows,numeric}=render([session('owner'),session('unrelated')],'owner');assert.deepEqual([...numeric.values()],['owner']);
 const empty=rows.find(r=>/No recorded sub-agents/.test(r.text));assert.ok(empty);assert.equal(empty.selectable,false);assert.match(empty.help??'',/recorded/i);assert.equal(rows[0]!.action?.type,'select');
});
test('missing bound owner never falls back to unrelated live sessions; an unbound panel uses its selected root',()=>{
 let result=render([session('unrelated')],'missing');assert.equal(result.numeric.size,0);assert.equal(result.rows[0]!.selectable,false);assert.match(result.rows[0]!.text,/owner.*unavailable/i);
 result=render([session('unrelated'),session('child','unrelated')]);assert.deepEqual([...result.numeric.values()],['unrelated','child']);
});
test('agent entries show only reported task context and filter within the anchored owner tree',()=>{
 const root=session('owner');const child=session('child','owner');child.evidence.task='Validate source cursors';child.evidence.messages.push({id:'message',role:'assistant',text:'Random message must not become a task'});
 const {data,state,numeric,rows}=render([root,child,session('unrelated')],'owner');assert.match(JSON.stringify(rows.find(r=>r.id==='child')!.continuations),/Validate source cursors/);assert.ok(!JSON.stringify(rows.map(r=>r.continuations)).includes('Random message'));
 state.filter='source cursors';numeric.clear();const filtered=agentRows(data,state,numeric,80);assert.deepEqual(filtered.filter(r=>r.action).map(r=>r.id),['owner','child']);assert.deepEqual([...numeric.values()],['owner','child']);
});
