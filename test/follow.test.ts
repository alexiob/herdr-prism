import{test}from'node:test';import assert from'node:assert/strict';import{FollowSelection}from'../src/runtime/follow.ts';
test('opening a panel chooses an agent in its own tab; another project is never the automatic fallback',async()=>{
 const {localSelection}=await import('../src/runtime/follow.ts');
 const a:any={key:'other',attachment:{terminal_id:'a',tab_id:'other-tab'}},b:any={key:'local',attachment:{terminal_id:'b',tab_id:'own-tab'}},c:any={key:'focused-local',attachment:{terminal_id:'c',tab_id:'own-tab'}};
 const data:any={sessions:[a,b,c]},snapshot:any={focused_pane_id:'c-pane',agents:[{pane_id:'c-pane',terminal_id:'c',tab_id:'own-tab'}]};
 assert.equal(localSelection(data,'own-tab',snapshot),'focused-local');assert.equal(localSelection(data,'own-tab',undefined),'local');assert.equal(localSelection(data,'empty-tab',snapshot),undefined);
});
test('a live panel without a local agent does not render or adopt the global first session',async()=>{
 const {createUiState,renderScreen}=await import('../src/tui/screen.ts');const {demoData}=await import('../src/runtime/demo.ts');
 const state=createUiState();state.restrictAutomaticSelection=true;const data=demoData();
 const frame=renderScreen(data,state,100,30);assert.equal(state.selectedKey,undefined);assert.ok(frame.lines.join('\n').toLowerCase().includes('no session'));assert.ok(!frame.lines.join('\n').includes(data.sessions[0].evidence.id));
});
test('following native focus preserves child inspection until a real occupant or focus change',()=>{
 const tracker=new FollowSelection(),root={pane_id:'p',terminal_id:'root',agent:'codex',agent_session:{kind:'id',value:'root'}},child={pane_id:'c',terminal_id:'child',agent:'claude',agent_session:{kind:'id',value:'child'}};
 const snapshot:any={agents:[root,child],focused_pane_id:'p'},data:any={sessions:[{key:'codex:root',attachment:root},{key:'claude:child',attachment:child}]};assert.equal(tracker.observe(snapshot,data),'codex:root');assert.equal(tracker.observe(snapshot,data),undefined,'metadata/safety refresh must not pull the reader away from a selected child');snapshot.focused_pane_id='c';assert.equal(tracker.observe(snapshot,data,true),undefined);assert.equal(tracker.observe(snapshot,data),'claude:child');root.agent_session.value='replacement';snapshot.focused_pane_id='p';assert.equal(tracker.observe(snapshot,data),'codex:root');
});
test('follow changes once when the same native reference is quarantined or corrected',()=>{
 const tracker=new FollowSelection(),agent:any={pane_id:'p',terminal_id:'t',agent:'codex',agent_session:{kind:'id',value:'reported'}};
 const snapshot:any={agents:[agent],focused_pane_id:'p'},data:any={sessions:[{key:'codex:reported',attachment:agent}]};
 assert.equal(tracker.observe(snapshot,data),'codex:reported');data.sessions[0].key='codex:pane-t';
 assert.equal(tracker.observe(snapshot,data),'codex:pane-t');assert.equal(tracker.observe(snapshot,data),undefined);
 data.sessions[0].key='codex:reported';assert.equal(tracker.observe(snapshot,data),'codex:reported');
});

test('detail collection pauses for a closed pane or another displayed tab/workspace', async () => {
 const {inspectorVisible}=await import('../src/runtime/follow.ts');
 const snapshot:any={panes:[{pane_id:'panel',terminal_id:'owner',tab_id:'tab',workspace_id:'workspace'}],focused_tab_id:'tab',focused_workspace_id:'workspace'};
 assert.equal(inspectorVisible(snapshot,'owner','old-panel'),true);
 assert.equal(inspectorVisible({...snapshot,focused_tab_id:'other'},'owner'),false);
 assert.equal(inspectorVisible({...snapshot,focused_workspace_id:'other'},'owner'),false);
 assert.equal(inspectorVisible({...snapshot,panes:[]},'owner','panel'),false);
 assert.equal(inspectorVisible(snapshot,'foreign','panel'),false,'pane id alone cannot override a replaced terminal identity');
 const zoomed={...snapshot,layouts:[{tab_id:'tab',zoomed:true,focused_pane_id:'agent'}]};
 assert.equal(inspectorVisible(zoomed,'owner'),false,'a panel hidden by zoom is not displayed');
 assert.equal(inspectorVisible({...zoomed,layouts:[{tab_id:'tab',zoomed:true,focused_pane_id:'panel'}]},'owner'),true);
});
