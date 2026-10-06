import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUiState,renderScreen,handleKey,handleRowClick,showDetail} from '../src/tui/screen.ts';
import {demoData} from '../src/runtime/demo.ts';
import {cellWidth} from '../src/tui/text.ts';
import {tabs} from '../src/tui/types.ts';

const fixture=()=>{
  const data=demoData();
  const root=data.sessions[0]!;
  root.evidence.title='Monitor';
  root.git={availability:'known',sampledAt:1000,ageMs:0,cwd:'/fixture/repo',root:'/fixture/repo',branch:'feature/prism',branchState:'named',added:128,deleted:37,conflicts:0,untrackedFiles:2};
  root.attachment={pane_id:'w1:p1',terminal_id:'term1',workspace_id:'w1',tab_id:'w1:t1',agent:'codex',agent_status:'working',focused:false,revision:1};
  return data;
};
test('Overview Enter actions navigate to matching tabs instead of explaining summaries',()=>{
  const data=fixture(),state=createUiState();state.selectedKey=data.sessions[0]!.key;
  for(const [id,tab]of [['coverage','Processes'],['git','Git'],['todo','To-do'],['children','Agents'],['messages','Messages'],['refs','Refs'],['notes','Notes']]){
    state.tab='Overview';state.cursorId=id;
    const frame=renderScreen(data,state,50,34);
    assert.ok(frame.rows.some(row=>row.id===id),id);
    const action=handleKey(state,'enter',data,frame) as any;
    assert.equal(action?.type,'tab',id);assert.equal(action?.tab,tab,id);assert.equal(state.tab,tab);
  }
});
test('selected entry help is separate from facts and Escape restores its exact reader position',()=>{
  const data=fixture(),state=createUiState();state.selectedKey=data.sessions[0]!.key;state.cursorId='cpu';
  let frame=renderScreen(data,state,50,24);
  const before={cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll};
  const action=handleKey(state,'enter',data,frame) as any;
  assert.ok(action?.document,'CPU must open measured facts');
  assert.ok(!JSON.stringify(action.document.sections).includes('one logical core'));
  handleKey(state,'?',data,frame);frame=renderScreen(data,state,50,24);
  assert.match(frame.lines.join('\n'),/one logical core/);
  handleKey(state,'escape',data,frame);renderScreen(data,state,50,24);
  assert.deepEqual({cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll},before);
});
test('agent inspection and numeric jumps stay inside Prism while f explicitly focuses a live pane',()=>{
  const data=fixture(),state=createUiState();state.selectedKey=data.sessions[0]!.key;state.tab='Agents';
  let frame=renderScreen(data,state,50,24);
  assert.equal(handleKey(state,'enter',data,frame)?.type,'select');
  assert.equal(handleKey(state,'f',data,frame)?.type,'focus');
  handleKey(state,'2',data,frame);
  const reordered={...data,sessions:[data.sessions[1]!,data.sessions[0]!]};
  frame=renderScreen(reordered,state,50,24);
  const jump=handleKey(state,'enter',reordered,frame);
  assert.equal(jump?.type,'select');assert.equal(jump?.sessionKey,'codex:demo-child');
});
test('all visible action summaries fit with arrows, help and matching drawn mouse regions',()=>{
  const data=fixture();data.sessions[0]!.evidence.goals[0]!.objective='日本語 '+('Inspect the full goal and keep the draft safe. '.repeat(50));
  for(const columns of [36,50,80,120])for(const tab of tabs){
    const state=createUiState();state.selectedKey=data.sessions[0]!.key;state.tab=tab;
    const frame=renderScreen(data,state,columns,34) as any;
    for(const line of frame.lines)assert.ok(cellWidth(line)<=columns,`${tab}: ${line}`);
    assert.ok(frame.rowRegions?.length,'drawn entries must carry hit regions');
    for(const region of frame.rowRegions){
      const row=frame.rows[region.index];
      assert.ok(row.help,`${tab}/${row.id}: help missing`);
      if(row.action)assert.ok(region.display.endsWith('→'),`${tab}/${row.id}: arrow missing`);
      assert.ok(cellWidth(region.display)<=region.width);
    }
    assert.ok(frame.tabRegions.some((region:any)=>region.tab===tab),`${tab}: tab not visible`);
  }
});
test('full goal and styled detail facts remain available behind meaningful summaries',()=>{
  const data=fixture(),state=createUiState();state.selectedKey=data.sessions[0]!.key;state.cursorId='goal';
  const objective='Build readable monitoring '+('with safe session-local state '.repeat(40));data.sessions[0]!.evidence.goals[0]!.objective=objective;
  const action=handleKey(state,'enter',data,renderScreen(data,state,36,24)) as any;
  assert.ok(JSON.stringify(action.document.sections).includes(objective));
  showDetail(state,action.text??'',action.document);
  const detail=renderScreen(data,state,80,34) as any;
  assert.ok(detail.spans?.flat().some((span:any)=>span.role==='identity'||span.role==='text'));
});
test('narrow tab mouse targets follow the actual chrome instead of fixed row numbers',()=>{
  const data=fixture(),state=createUiState();state.selectedKey=data.sessions[0]!.key;
  const frame=renderScreen(data,state,36,24) as any;
  const target=frame.tabRegions.find((region:any)=>region.tab==='To-do');assert.ok(target);
  const action=handleRowClick(state,target.x,target.y,data,frame) as any;
  assert.equal(action?.type,'tab');assert.equal(state.tab,'To-do');
});
test('tiny actual styled frames stay within terminal cells and wide Overview supports spatial navigation',()=>{
 const data=fixture();data.sessions[0]!.evidence.title='日本語😀'.repeat(20);
 for(const columns of [1,2,5,12,36])for(const tab of tabs){const state=createUiState();state.tab=tab;state.selectedKey=data.sessions[0]!.key;const frame=renderScreen(data,state,columns,12);for(const spans of frame.spans??[])assert.ok(cellWidth(spans.map(s=>s.text).join(''))<=columns,`${columns}/${tab}`);}
 const state=createUiState();state.selectedKey=data.sessions[0]!.key;state.cursorId='cpu';let frame=renderScreen(data,state,80,34);handleKey(state,'right',data,frame);frame=renderScreen(data,state,80,34);assert.equal(frame.rows[state.cursor]?.id,'goal');handleKey(state,'left',data,frame);frame=renderScreen(data,state,80,34);assert.equal(frame.rows[state.cursor]?.id,'cpu');
});
test('compact quantities style attached binary units quietly and keep signed Git changes semantic',async()=>{
 const {valueSpans}=await import('../src/tui/widgets.ts');const memory=valueSpans('620MiB','quantity');assert.ok(memory.some(s=>s.text==='620'&&s.role==='quantity'));assert.ok(memory.some(s=>s.text==='MiB'&&s.role==='secondary'));const git=valueSpans('+128 -37','quantity');assert.ok(git.some(s=>s.text==='+128'&&s.role==='positive'));assert.ok(git.some(s=>s.text==='-37'&&s.role==='negative'));
});
test('Overview Notes link selects the edit entry and restores the Overview anchor after leaving',()=>{
 const data=fixture(),state=createUiState();state.selectedKey=data.sessions[0]!.key;state.cursorId='notes';let frame=renderScreen(data,state,50,24);const anchor=state.cursorId;handleKey(state,'enter',data,frame);frame=renderScreen(data,state,50,24);assert.equal(handleKey(state,'enter',data,frame)?.type,'notes-edit');assert.equal(state.cursorId,'notes-edit');
 handleKey(state,'tab',data,frame);frame=renderScreen(data,state,50,24);assert.equal(state.tab,'Overview');assert.equal(state.cursorId,anchor);
});
test('mixed reference facts and actions allow reading the entire path before selecting the action list',()=>{
 const data=fixture(),state=createUiState();state.selectedKey=data.sessions[0]!.key;state.tab='Refs';const ref=data.sessions[0]!.refs![0]!;ref.target='/EARLY/'+('long-directory/'.repeat(30))+'ending.ts';state.cursorId=ref.id;let frame=renderScreen(data,state,36,18);const action=handleKey(state,'enter',data,frame)!;showDetail(state,action.text??'',action.document);frame=renderScreen(data,state,36,18);assert.match(frame.lines.join('\n'),/EARLY/);handleKey(state,'end',data,frame);frame=renderScreen(data,state,36,18);handleKey(state,'up',data,frame);frame=renderScreen(data,state,36,18);assert.equal(handleKey(state,'enter',data,frame)?.type,'source');handleKey(state,'home',data,frame);frame=renderScreen(data,state,36,18);assert.match(frame.lines.join('\n'),/EARLY/);assert.equal(state.scroll,0);
});
