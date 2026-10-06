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

test('local follow watches the agent binding while keyboard focus is inside its inspector',()=>{
 const tracker=new FollowSelection(),agent:any={pane_id:'agent',terminal_id:'terminal',tab_id:'local',agent:'codex',agent_session:{kind:'id',value:'original'}},other:any={pane_id:'other',terminal_id:'elsewhere',tab_id:'other-tab',agent:'codex',agent_session:{kind:'id',value:'foreign'}};
 const snapshot:any={agents:[other,agent],focused_pane_id:'panel',focused_tab_id:'local'},data:any={sessions:[{key:'codex:foreign',attachment:other},{key:'codex:original',attachment:agent}]};
 assert.equal(tracker.observeLocal(snapshot,data,'local'),'codex:original');
 assert.equal(tracker.observeLocal(snapshot,data,'local'),undefined,'unchanged polling preserves explicit child/history inspection');
 agent.agent_session.value='misreported';data.sessions[1].key='codex:pane-terminal';
 assert.equal(tracker.observeLocal(snapshot,data,'local'),'codex:pane-terminal','quarantined current binding replaces detached historical selection even with panel focus');
 assert.equal(tracker.observeLocal(snapshot,data,'local'),undefined);
 snapshot.focused_tab_id='other-tab';snapshot.focused_pane_id='other';
 assert.equal(tracker.observeLocal(snapshot,data,'local'),undefined,'another tab never controls this panel');
});
test('local follow retains the last focused agent when a tab contains multiple agents',()=>{
 const tracker=new FollowSelection(),a:any={pane_id:'a',terminal_id:'a',tab_id:'tab',agent:'codex'},b:any={pane_id:'b',terminal_id:'b',tab_id:'tab',agent:'claude'},snapshot:any={agents:[a,b],focused_pane_id:'b',focused_tab_id:'tab'},data:any={sessions:[{key:'a',attachment:a},{key:'b',attachment:b}]};
 assert.equal(tracker.observeLocal(snapshot,data,'tab'),'b');snapshot.focused_pane_id='panel';assert.equal(tracker.observeLocal(snapshot,data,'tab'),undefined);
 data.sessions[1].key='new-b';assert.equal(tracker.observeLocal(snapshot,data,'tab'),'new-b');assert.equal(tracker.observeLocal(snapshot,data,'tab',true),undefined);
});

test('local follow remembers native focus even before the new binding reaches collector data',()=>{
 const tracker=new FollowSelection(),a:any={pane_id:'a',terminal_id:'a',tab_id:'tab',agent:'codex'},b:any={pane_id:'b',terminal_id:'b',tab_id:'tab',agent:'codex',agent_session:{kind:'id',value:'old-b'}};
 const snapshot:any={agents:[a,b],focused_pane_id:'a',focused_tab_id:'tab'},data:any={sessions:[{key:'a',attachment:a},{key:'old-b',attachment:structuredClone(b)}]};
 assert.equal(tracker.observeLocal(snapshot,data,'tab'),'a');snapshot.focused_pane_id='b';b.agent_session.value='new-b';
 assert.equal(tracker.observeLocal(snapshot,data,'tab'),undefined);
 snapshot.focused_pane_id='panel';data.sessions[1]={key:'new-b',attachment:structuredClone(b)};
 assert.equal(tracker.observeLocal(snapshot,data,'tab'),'new-b');assert.equal(tracker.observeLocal(snapshot,data,'tab'),undefined);
});
