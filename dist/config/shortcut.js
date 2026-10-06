function string(value) {
    if (value.startsWith("'''"))
        return;
    if (value.startsWith('"')) {
        try {
            const parsed = JSON.parse(value);
            return typeof parsed === 'string' ? parsed : undefined;
        }
        catch {
            return;
        }
    }
    if (value.startsWith("'") && value.endsWith("'"))
        return value.slice(1, -1);
}
/** Opaque TOML key strings are preserved rather than guessing whether they collide. */
export function shortcutDecision(doc, key, command) {
    if (doc.entries.some(e => e.path === 'keys' || e.path === 'keys.command') || doc.tables.some(t => t.path === 'keys.command'))
        return 'conflict';
    const entries = doc.entries.filter(e => e.path.startsWith('keys.'));
    if (entries.some(e => /^["']/.test(e.value) && string(e.value) === undefined))
        return 'conflict';
    const arrays = new Map();
    for (const entry of entries)
        if (entry.value.startsWith('[')) {
            // JSON-compatible TOML arrays are unambiguous. Preserve single-quoted,
            // commented, multiline and other opaque array forms instead of guessing.
            let values;
            try {
                values = JSON.parse(entry.value);
            }
            catch {
                return 'conflict';
            }
            if (!Array.isArray(values) || values.some(value => typeof value !== 'string'))
                return 'conflict';
            arrays.set(entry.path, values);
        }
    const normalized = key.trim().toLowerCase();
    const bindings = entries.filter(e => (arrays.get(e.path) ?? [string(e.value)]).some(value => value?.trim().toLowerCase() === normalized));
    if (!bindings.length)
        return 'add';
    if (bindings.length !== 1 || !bindings[0].path.endsWith('.key'))
        return 'conflict';
    const same = entries.filter(e => e.tablePath === bindings[0].tablePath);
    return same.some(e => e.path.endsWith('.command') && string(e.value) === command) && same.some(e => e.path.endsWith('.type') && string(e.value) === 'plugin_action') ? 'existing' : 'conflict';
}
