import{test}from'node:test';import assert from'node:assert/strict';import{FollowSelection}from'../src/runtime/follow.ts';
test('following native focus preserves child inspection until a real occupant or focus change',()=>{
 const tracker=new FollowSelection(),root={pane_id:'p',terminal_id:'root',agent:'codex',agent_session:{kind:'id',value:'root'}},child={pane_id:'c',terminal_id:'child',agent:'claude',agent_session:{kind:'id',value:'child'}};
 const snapshot:any={agents:[root,child],focused_pane_id:'p'},data:any={sessions:[{key:'codex:root',attachment:root},{key:'claude:child',attachment:child}]};assert.equal(tracker.observe(snapshot,data),'codex:root');assert.equal(tracker.observe(snapshot,data),undefined,'metadata/safety refresh must not pull the reader away from a selected child');snapshot.focused_pane_id='c';assert.equal(tracker.observe(snapshot,data,true),undefined);assert.equal(tracker.observe(snapshot,data),'claude:child');root.agent_session.value='replacement';snapshot.focused_pane_id='p';assert.equal(tracker.observe(snapshot,data),'codex:root');
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
