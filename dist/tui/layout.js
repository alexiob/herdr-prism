import { tabs } from "./types.js";
import { span, pad, summary, readableWrap, valueSpans, asciiText, fitSpans } from "./widgets.js";
import { cellWidth, truncate, age } from "./text.js";
export function groupRows(rows, fallback) {
    const result = [];
    for (const row of rows) {
        const id = row.section ?? fallback;
        let section = result.at(-1);
        if (!section || section.id !== id) {
            section = { id, title: id, rows: [], column: row.column };
            result.push(section);
        }
        section.rows.push(row);
    }
    return result;
}
export function renderLayout(data, state, sections, columns, height, now, numericTargets = new Map(), document, minimumBodyRows = 1) {
    columns = Math.max(1, Math.floor(columns));
    height = Math.max(1, Math.floor(height));
    const session = data.sessions.find(s => s.key === state.selectedKey) ?? (!state.notes?.editing ? data.sessions[0] : undefined);
    const name = session?.evidence.title ?? session?.evidence.id ?? state.notes?.title ?? 'No session';
    const stateName = session?.evidence.state ?? 'unknown', provider = session?.evidence.provider ?? '—', model = session?.evidence.model ?? session?.usage?.model ?? 'model —';
    const tail = ` · ${stateName}`;
    const metadata = (cellWidth(`${provider} · ${model}${tail}`) <= columns ? `${provider} · ${model}` : truncate(provider, Math.max(1, columns - cellWidth(tail)))) + tail;
    const header = [[span(truncate(`${data.demo ? '[DEMO] ' : ''}Prism · ${name}`, columns), 'accent')], [span(metadata, 'identity')], [span(truncate(`${data.server ? data.server.host + '/' + data.server.session : 'Server —'} · ${state.subtree ? 'Subtree' : 'Self + jobs'} · ${state.pin ? 'Pinned' : 'Follow'}`, columns), 'secondary')]];
    const tabRegions = [];
    let tabLine = [], used = 0;
    const labels = columns < 50 ? ['Overview', 'Agents', 'Procs', 'Msgs', 'Refs', 'To-do', 'Git', 'Notes'] : tabs;
    for (const [i, tab] of tabs.entries()) {
        const name = labels[i], label = (tab === state.tab ? '[' + name + ']' : name), size = cellWidth(label);
        if (used + size > columns && tabLine.length) {
            header.push(tabLine);
            tabLine = [];
            used = 0;
        }
        tabRegions.push({ tab, x: used + 1, y: header.length + 1, width: size });
        tabLine.push(span(label + ' ', tab === state.tab ? 'accent' : 'secondary'));
        used += size + 1;
    }
    if (tabLine.length)
        header.push(tabLine);
    // Keep room for the selected entry in short terminals; tabs keep measured targets.
    if (header.length > height - 2 - minimumBodyRows) {
        header.splice(1, Math.min(2, header.length - (height - 2 - minimumBodyRows)));
        for (const region of tabRegions)
            region.y = header.findIndex(line => line.some(part => part.text.trim() === (region.tab === state.tab ? '[' + labels[tabs.indexOf(region.tab)] + ']' : labels[tabs.indexOf(region.tab)]))) + 1;
    }
    const rows = sections.flatMap(section => section.rows), indices = new Map(rows.map((row, i) => [row, i]));
    const sectionLines = (items, width) => {
        const lines = [];
        for (const section of items) {
            const heading = '┌ ' + truncate(section.title, Math.max(1, width - 4)) + ' ';
            lines.push({ parts: [span(heading, 'accent'), span('─'.repeat(Math.max(0, width - cellWidth(heading) - 1)) + '┐', 'border')], positions: [] });
            for (const description of section.description ?? [])
                for (const line of readableWrap(description, width - 4))
                    lines.push({ parts: [span('│ ', 'border'), span(pad(line, width - 4), 'secondary'), span(' │', 'border')], positions: [] });
            for (const field of section.fields ?? []) {
                const labelWidth = Math.min(12, Math.max(1, width - 8)), valueWidth = Math.max(1, width - 4 - labelWidth);
                if (cellWidth(field.label) > labelWidth)
                    for (const label of readableWrap(field.label, width - 4))
                        lines.push({ parts: [span('│ ', 'border'), span(pad(label, width - 4), 'secondary'), span(' │', 'border')], positions: [] });
                for (const [i, line] of readableWrap(field.value, valueWidth).entries())
                    lines.push({ parts: [span('│ ', 'border'), span(pad(i || cellWidth(field.label) > labelWidth ? '' : field.label, labelWidth), 'secondary'), ...valueSpans(pad(line, valueWidth), field.role), span(' │', 'border')], positions: [] });
            }
            if (section.text !== undefined)
                for (const line of readableWrap(section.text, width - 4))
                    lines.push({ parts: [span('│ ', 'border'), span(pad(line, width - 4), 'text'), span(' │', 'border')], positions: [] });
            for (const row of section.rows) {
                const index = indices.get(row), selected = row.selectable !== false && index === state.cursor, room = Math.max(1, width - 4), arrow = row.action ? ' →' : '', available = Math.max(1, room - cellWidth(arrow));
                const prefix = row.label ? pad(summary(row.label, Math.min(10, available)), Math.min(10, available)) : '';
                const main = row.label ? prefix + summary(row.value ?? '', Math.max(1, available - cellWidth(prefix))) : summary(row.text, available);
                const display = pad(main, available) + arrow;
                const parts = row.label ? [span(prefix, 'secondary', selected), ...valueSpans(pad(main.slice(prefix.length), available - cellWidth(prefix)), row.role, selected), span(arrow, 'accent', selected)] : [...valueSpans(pad(main, available), row.role, selected), span(arrow, 'accent', selected)];
                lines.push({ parts: [span('│', 'border'), span(selected ? '›' : ' ', selected ? 'accent' : 'text', selected), ...parts, span(' │', 'border')], positions: [{ index, column: 3, width: room, display, disclosureX: row.disclosureColumn ? row.disclosureColumn + 2 : undefined }] });
            }
            lines.push({ parts: [span('└' + '─'.repeat(Math.max(0, width - 2)) + '┘', 'border')], positions: [] });
        }
        return lines;
    };
    const two = columns >= 80 && sections.some(section => section.column === 1);
    let body;
    if (two) {
        const leftWidth = Math.floor((columns - 2) / 2), left = sectionLines(sections.filter(s => s.column !== 1), leftWidth), right = sectionLines(sections.filter(s => s.column === 1), columns - leftWidth - 2);
        body = Array.from({ length: Math.max(left.length, right.length) }, (_, i) => ({ parts: [...(left[i]?.parts ?? [span(' '.repeat(leftWidth))]), span('  '), ...(right[i]?.parts ?? [span(' '.repeat(columns - leftWidth - 2))])], positions: [...left[i]?.positions ?? [], ...(right[i]?.positions ?? []).map(p => ({ ...p, column: p.column + leftWidth + 2, disclosureX: p.disclosureX === undefined ? undefined : p.disclosureX + leftWidth + 2 }))] }));
    }
    else
        body = sectionLines(sections, columns);
    const bodyStart = header.length, bodyHeight = Math.max(1, height - bodyStart - 2);
    let selectedBody = body.findIndex(line => line.positions.some(position => position.index === state.cursor));
    if (document || !rows.length) {
        const actions = rows.slice();
        const physical = body.map((line, i) => {
            const action = line.positions[0];
            return action ? actions[action.index] : { id: `detail:${i}`, text: line.parts.map(p => p.text).join(''), selectable: false, help: document?.help ?? 'Scroll to read all recorded content. Escape returns to the previous entry.' };
        });
        rows.splice(0, rows.length, ...physical);
        const anchor = state.cursorId ? rows.findIndex(row => row.id === state.cursorId) : -1;
        if (anchor >= 0)
            state.cursor = anchor;
        state.cursor = Math.max(0, Math.min(state.cursor, rows.length - 1));
        selectedBody = state.cursor;
        for (const [i, line] of body.entries()) {
            for (const position of line.positions)
                position.index = i;
            let used = 0;
            for (const part of line.parts) {
                part.selected = false;
                for (const position of line.positions) {
                    const marker = position.column - 2, selected = i === state.cursor;
                    if (used === marker && part.text.length === 1) {
                        part.text = selected ? '›' : ' ';
                        part.role = selected ? 'accent' : 'text';
                    }
                    if (used >= marker && used < marker + position.width + 1 && part.role !== 'border')
                        part.selected = selected;
                }
                used += cellWidth(part.text);
            }
        }
    }
    if (selectedBody < 0)
        selectedBody = 0;
    if (selectedBody < state.scroll)
        state.scroll = selectedBody;
    if (selectedBody >= state.scroll + bodyHeight)
        state.scroll = selectedBody - bodyHeight + 1;
    state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, body.length - bodyHeight)));
    const spans = [...header], rowRegions = [];
    for (let at = state.scroll; at < Math.min(body.length, state.scroll + bodyHeight); at++) {
        const line = body[at];
        for (const position of line.positions) {
            rowRegions.push({ index: position.index, x: position.column, y: spans.length + 1, width: position.width, display: position.display, disclosureX: position.disclosureX });
            if (position.disclosureX !== undefined)
                rows[position.index].disclosureColumn = position.disclosureX;
        }
        spans.push(line.parts);
    }
    while (spans.length < height - 2)
        spans.push([span('')]);
    const messageReader = session && state.tab === 'Messages' ? state.messageReaders.get(session.key) : undefined;
    const status = state.notice ?? `${data.stale ? 'STALE · ' : ''}${messageReader?.newCount ? `${messageReader.newCount} new · ` : messageReader?.following ? 'Following end · ' : ''}${document?.capturedAt !== undefined ? 'Snapshot ' + age(document.capturedAt, now) : 'Evidence ' + age(data.updatedAt, now)} ago`;
    const controls = state.editingFilter ? 'Filter: ' + state.filter : state.numberPrefix ? 'Prism agent: ' + state.numberPrefix + ' · Enter' : state.help || state.detail !== undefined ? '↑↓ scroll · Esc back · ? help' : state.tab === 'Agents' ? 'Enter inspect · f focus · ? help' : state.tab === 'Refs' ? 'Enter detail · Space sources · ? help' : state.tab === 'To-do' ? 'Enter detail · x check · ? help' : state.tab === 'Notes' ? 'Enter edit · Ctrl+S save · ? help' : columns < 50 ? 'Enter · ? help · Tab · q' : 'Enter open · Tab views · ? help · q close';
    spans.push([span(truncate(status, columns), data.stale ? 'warning' : 'secondary')], [span(truncate(controls, columns), 'secondary')]);
    if (state.ascii)
        for (const line of spans)
            for (const part of line)
                part.text = asciiText(part.text);
    for (let i = 0; i < spans.length; i++)
        spans[i] = fitSpans(spans[i], columns);
    const lines = spans.slice(0, height).map(line => truncate(line.map(part => part.text).join(''), columns, state.ascii));
    return { lines, spans: spans.slice(0, height), rows, selectedLine: rows[state.cursor]?.selectable === false ? undefined : bodyStart + selectedBody - state.scroll, bodyStart, bodyHeight, numericTargets, rowRegions, tabRegions, theme: state.monochrome ? 'mono' : state.theme ?? 'dark' };
}
