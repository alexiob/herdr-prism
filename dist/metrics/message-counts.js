export function summarizeMessages(messages) {
    const unique = new Map(messages.map(m => [m.id, m]));
    const byRole = { user: 0, assistant: 0, tool: 0 };
    const calls = new Map();
    let lastActivity, interAgentMessages = 0;
    for (const m of unique.values()) {
        if (m.kind === 'inter-agent')
            interAgentMessages++;
        else
            byRole[m.role]++;
        for (const t of m.tools ?? [])
            calls.set(t.id, t);
        if (m.timestamp !== undefined)
            lastActivity = Math.max(lastActivity ?? 0, m.timestamp);
    }
    const tools = [...calls.values()];
    return { byRole, messages: unique.size, visibleMessages: byRole.user + byRole.assistant, interAgentMessages, tools: tools.length, errors: tools.filter(t => t.status === 'error').length, activeTools: tools.filter(t => t.status === 'running').length, toolResults: byRole.tool, lastActivity };
}
