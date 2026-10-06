import type { HerdrSnapshot } from '../model/types.ts';
import type { DashboardData } from '../tui/types.ts';
/** Automatic selection stays in the panel's tab. A reader can explicitly choose others. */
export function localSelection(data:DashboardData,tabId:unknown,snapshot?:HerdrSnapshot):string|undefined {
 const local=data.sessions.filter(s=>(s.attachments??(s.attachment?[s.attachment]:[])).some(a=>a.tab_id===tabId));
 const focused=snapshot?.agents.find(a=>a.pane_id===snapshot.focused_pane_id&&a.tab_id===tabId);
 return (focused&&local.find(s=>(s.attachments??(s.attachment?[s.attachment]:[])).some(a=>a.terminal_id===focused.terminal_id))||local[0])?.key;
}
/** Follow genuine native focus/occupant changes; leave an inspected child alone on refresh. */
export class FollowSelection {
    private identity?: string;
    reset() { this.identity = undefined; }
    observe(snapshot: HerdrSnapshot, data: DashboardData, pinned = false): string | undefined {
        if (pinned)
            return;
        const focused = snapshot.agents.find(a => a.pane_id === snapshot.focused_pane_id);
        if (!focused)
            return;
        const selected = data.sessions.find(s => (s.attachments ?? (s.attachment ? [s.attachment] : [])).some(a => a.terminal_id === focused.terminal_id && a.agent_session?.kind === focused.agent_session?.kind && a.agent_session?.value === focused.agent_session?.value));
        if (!selected)
            return;
        const identity = JSON.stringify([focused.terminal_id, focused.agent, focused.agent_session?.kind, focused.agent_session?.value,selected.key]);
        if(identity===this.identity)return;
        this.identity = identity;
        return selected.key;
    }
}

/** Visibility uses exact pane identity and the server's current workspace/tab. */
export function inspectorVisible(snapshot: HerdrSnapshot | undefined, terminalId?: string, paneId?: string): boolean {
    if (!snapshot) return false;
    const own = snapshot.panes.find(p => terminalId ? p.terminal_id === terminalId : paneId !== undefined && p.pane_id === paneId);
    if (!own) return false;
    if (snapshot.focused_workspace_id && own.workspace_id !== snapshot.focused_workspace_id) return false;
    if (snapshot.focused_tab_id && own.tab_id !== snapshot.focused_tab_id) return false;
    const layout = snapshot.layouts?.find(layout => layout.tab_id === own.tab_id);
    if (layout?.zoomed === true && layout.focused_pane_id !== own.pane_id) return false;
    return true;
}
