/** Automatic selection stays in the panel's tab. A reader can explicitly choose others. */
export function localSelection(data, tabId, snapshot, targetTerminalId) {
    const local = data.sessions.filter(s => (s.attachments ?? (s.attachment ? [s.attachment] : [])).some(a => a.tab_id === tabId));
    if (targetTerminalId)
        return local.find(s => (s.attachments ?? (s.attachment ? [s.attachment] : [])).some(a => a.terminal_id === targetTerminalId))?.key;
    const focused = snapshot?.agents.find(a => a.pane_id === snapshot.focused_pane_id && a.tab_id === tabId);
    return (focused && local.find(s => (s.attachments ?? (s.attachment ? [s.attachment] : [])).some(a => a.terminal_id === focused.terminal_id)) || local[0])?.key;
}
/** Follow genuine native focus/occupant changes; leave an inspected child alone on refresh. */
export class FollowSelection {
    identity;
    followedTerminal;
    reset() { this.identity = undefined; this.followedTerminal = undefined; }
    /** Inspector focus must not hide a change to its last focused native occupant. */
    observeLocal(snapshot, data, tabId, pinned = false, targetTerminalId) {
        if (pinned || snapshot.focused_tab_id && snapshot.focused_tab_id !== tabId)
            return;
        if (targetTerminalId) {
            const target = snapshot.agents.find(a => a.terminal_id === targetTerminalId && a.tab_id === tabId);
            if (!target)
                return;
            return this.observe({ ...snapshot, focused_pane_id: target.pane_id }, data, pinned);
        }
        const focused = snapshot.agents.find(a => a.pane_id === snapshot.focused_pane_id);
        if (focused && focused.tab_id !== tabId)
            return;
        if (focused)
            this.followedTerminal = focused.terminal_id;
        const localKey = localSelection(data, tabId, snapshot);
        const local = data.sessions.find(s => s.key === localKey);
        const target = focused ?? snapshot.agents.find(a => a.terminal_id === this.followedTerminal && a.tab_id === tabId)
            ?? snapshot.agents.find(a => a.tab_id === tabId && (local?.attachments ?? (local?.attachment ? [local.attachment] : [])).some(attachment => attachment.terminal_id === a.terminal_id));
        if (!target)
            return;
        return this.observe({ ...snapshot, focused_pane_id: target.pane_id }, data, pinned);
    }
    observe(snapshot, data, pinned = false) {
        if (pinned)
            return;
        const focused = snapshot.agents.find(a => a.pane_id === snapshot.focused_pane_id);
        if (!focused)
            return;
        const selected = data.sessions.find(s => (s.attachments ?? (s.attachment ? [s.attachment] : [])).some(a => a.terminal_id === focused.terminal_id && a.agent_session?.kind === focused.agent_session?.kind && a.agent_session?.value === focused.agent_session?.value));
        if (!selected)
            return;
        const identity = JSON.stringify([focused.terminal_id, focused.agent, focused.agent_session?.kind, focused.agent_session?.value, selected.key]);
        if (identity === this.identity)
            return;
        this.identity = identity;
        this.followedTerminal = focused.terminal_id;
        return selected.key;
    }
}
/** Visibility uses exact pane identity and the server's current workspace/tab. */
export function inspectorVisible(snapshot, terminalId, paneId) {
    if (!snapshot)
        return false;
    const own = snapshot.panes.find(p => terminalId ? p.terminal_id === terminalId : paneId !== undefined && p.pane_id === paneId);
    if (!own)
        return false;
    if (snapshot.focused_workspace_id && own.workspace_id !== snapshot.focused_workspace_id)
        return false;
    if (snapshot.focused_tab_id && own.tab_id !== snapshot.focused_tab_id)
        return false;
    const layout = snapshot.layouts?.find(layout => layout.tab_id === own.tab_id);
    if (layout?.zoomed === true && layout.focused_pane_id !== own.pane_id)
        return false;
    return true;
}
