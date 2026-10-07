/** Automatic selection stays in the panel's tab. A reader can explicitly choose others. */
export function localSelection(data, tabId, snapshot, targetTerminalId) {
    const local = data.sessions.filter(s => (s.attachments ?? (s.attachment ? [s.attachment] : [])).some(a => a.tab_id === tabId));
    if (targetTerminalId)
        return local.find(s => (s.attachments ?? (s.attachment ? [s.attachment] : [])).some(a => a.terminal_id === targetTerminalId))?.key;
    const focused = snapshot?.agents.find(a => a.pane_id === snapshot.focused_pane_id && a.tab_id === tabId);
    return (focused && local.find(s => (s.attachments ?? (s.attachment ? [s.attachment] : [])).some(a => a.terminal_id === focused.terminal_id)) || local[0])?.key;
}
/** Native path references are placeholders until their header identifies the conversation. */
export function resolveInspectorBinding(data, tabId, targetTerminalId, previousKey, options = {}) {
    const session = data.sessions.find(s => (s.attachments ?? (s.attachment ? [s.attachment] : [])).some(a => a.tab_id === tabId && a.terminal_id === targetTerminalId));
    if (!session)
        return { key: previousKey, pending: true };
    const attachment = (session.attachments ?? (session.attachment ? [session.attachment] : [])).find(a => a.tab_id === tabId && a.terminal_id === targetTerminalId);
    const ref = attachment.agent_session;
    if (ref?.kind === 'path' && session.evidence.id === ref.value)
        return { key: previousKey, pending: true };
    if (!ref && !previousKey && options.restoredSelection && options.restoredSelection !== session.key)
        return { pending: true };
    if (!ref && previousKey && previousKey !== session.key)
        return { key: previousKey, pending: true };
    return { key: session.key, pending: false };
}
/** A missing cached session never overrides a pin or an unresolved restored binding. */
export function reconcileInspectorSelection(data, state, boundKey, startup = false) {
    if (state.pin && state.selectedKey || state.boundSessionPending)
        return;
    if (startup || !state.selectedKey || !data.sessions.some(s => s.key === state.selectedKey))
        state.selectedKey = boundKey;
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
/** End a reader overlay before changing its session; keep that session's caches. */
export function clearInspectionOverlays(state) {
    const position = state.detailReader ?? state.helpReader ?? { cursor: state.cursor, cursorId: state.cursorId, scroll: state.scroll };
    if (state.readerKey)
        state.readers.set(state.readerKey, { ...position });
    state.help = false;
    state.helpText = undefined;
    state.helpReader = undefined;
    state.detail = undefined;
    state.detailDocument = undefined;
    state.detailStack = undefined;
    state.detailReader = undefined;
    state.refSources = undefined;
    state.refParent = undefined;
    state.sourceDetailReader = undefined;
    state.numberPrefix = '';
    state.numberTargets.clear();
    state.cursor = 0;
    state.cursorId = undefined;
    state.scroll = 0;
    state.readerKey = undefined;
}
/** A bound return is a local inspection action; it never focuses a native pane. */
export function resumeBoundSelection(state, key = state.boundSessionKey) {
    if (!key || state.notes?.editing || state.processConfirmation)
        return false;
    clearInspectionOverlays(state);
    state.selectedKey = key;
    state.boundSessionKey = key;
    state.pin = false;
    state.tab = 'Overview';
    state.readers.set(`${key}:Overview:${state.view}`, { cursor: 0, scroll: 0 });
    return true;
}
/** Back walks the inspected lineage only when it reaches this panel's owner. */
export function inspectionParentKey(data, state) {
    const bound = state.boundSessionKey;
    if (!bound || state.selectedKey === bound)
        return;
    const byKey = new Map(data.sessions.map(session => [session.key, session]));
    const selected = state.selectedKey ? byKey.get(state.selectedKey) : undefined;
    const parent = selected?.parentKey ? byKey.get(selected.parentKey) : undefined;
    const seen = new Set([state.selectedKey]);
    let cursor = parent;
    while (cursor && !seen.has(cursor.key)) {
        if (cursor.key === bound)
            return parent.key;
        seen.add(cursor.key);
        cursor = cursor.parentKey ? byKey.get(cursor.parentKey) : undefined;
    }
    return bound;
}
/** Notes stay with the panel owner; an active editor keeps its captured draft. */
export function resolveNotesSessionKey(state) {
    if (state.notes?.editing)
        return state.notes.sessionKey;
    if (state.boundSessionPending && !state.boundSessionKey)
        return;
    return state.boundSessionKey ?? state.selectedKey;
}
/** Placeholder Notes belong only to this bound terminal's verified root conversation. */
export function boundNoteAdoption(session, key, boundKey, terminalId) {
    if (!session || !key || key !== boundKey || session.key !== key || session.parentKey || session.evidence.parentId || session.evidence.availability === 'unavailable' || session.evidence.id.startsWith('pane-'))
        return;
    const provider = session.evidence.provider;
    if (key !== `${provider}:${session.evidence.id}`)
        return;
    const attachment = (session.attachments ?? (session.attachment ? [session.attachment] : [])).find(value => value.terminal_id === terminalId && value.agent === provider && value.agent_session?.kind === 'id' && value.agent_session.value === session.evidence.id);
    if (!attachment)
        return;
    return { provider, terminalId, canonicalKey: key };
}
