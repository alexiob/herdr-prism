import { createHash } from 'node:crypto';
import { lstat, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicWrite, privateDir, readOptional, restrict } from "./safe-file.js";
import { scanToml, put, replaceValues } from "./toml.js";
export { privateDir as ensurePrivateDir } from "./safe-file.js";
const defaults = { nativeMode: 'overview', providerHomes: {}, todosEnabled: false, sampleIntervalMs: 2000, follow: true, ascii: false, monochrome: false };
export async function loadSettings(configDir) { const text = await readOptional(join(configDir, 'settings.json')); if (!text)
    return { ...defaults, providerHomes: {} }; const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Settings must be an object'); const data = value; const result = { ...defaults, ...data }; if (!['overview', 'inspector-only', 'native'].includes(result.nativeMode))
    throw new Error('Invalid nativeMode'); for (const key of ['todosEnabled', 'follow', 'ascii', 'monochrome'])
    if (typeof result[key] !== 'boolean')
        throw new Error('Invalid setting ' + key); if (result.autostart !== undefined && typeof result.autostart !== 'boolean')
    throw new Error('Invalid autostart'); if (!Number.isInteger(result.sampleIntervalMs) || result.sampleIntervalMs < 250 || result.sampleIntervalMs > 60000)
    throw new Error('Invalid sampleIntervalMs'); if (!result.providerHomes || typeof result.providerHomes !== 'object' || Array.isArray(result.providerHomes))
    throw new Error('Invalid providerHomes'); for (const [provider, path] of Object.entries(result.providerHomes))
    if (!['codex', 'claude', 'pi'].includes(provider) || typeof path !== 'string' || path.includes('\0'))
        throw new Error('Invalid provider home'); if (result.costRates) {
    if (typeof result.costRates !== 'object' || Array.isArray(result.costRates))
        throw new Error('Invalid costRates');
    for (const rates of Object.values(result.costRates)) {
        if (!rates || typeof rates !== 'object')
            throw new Error('Invalid costRates');
        if (typeof rates.currency !== 'string' || !rates.currency.trim())
            throw new Error('Cost rate requires currency');
        for (const [key, rate] of Object.entries(rates))
            if (key !== 'currency' && (!['input', 'output', 'cacheRead', 'cacheWrite'].includes(key) || typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0))
                throw new Error('Invalid cost rate');
    }
} return result; }
export function nativeRows(theme = 'dark') { const add = theme === 'light' ? '#17784C' : '#42B883', del = theme === 'light' ? '#B42335' : '#E06C75'; return [['$hat_group'], ['state_icon', 'agent', '$hat_line'], ['machine', 'workspace', 'tab'], ['$hat_goal'], ['$hat_load', '$hat_counts'], ['$hat_branch', theme === 'mono' ? '$hat_add' : { token: '$hat_add', fg: add }, theme === 'mono' ? '$hat_del' : { token: '$hat_del', fg: del }], ['$hat_div', '$hat_conflict', '$hat_fresh'], ['$hat_last']]; }
function rowsToml(theme) { return '[\n' + nativeRows(theme).map(row => '  [' + row.map(token => typeof token === 'string' ? JSON.stringify(token) : `{ token = ${JSON.stringify(token.token)}, fg = ${JSON.stringify(token.fg)} }`).join(', ') + ']').join(',\n') + '\n]'; }
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function withLock(stateDir, operation) { await privateDir(stateDir); const path = join(stateDir, 'configuration.lock'); let handle; try {
    handle = await open(path, 'wx', 0o600);
}
catch (error) {
    if (error.code === 'EEXIST')
        throw new Error('Another configuration operation is running; retry after it completes');
    throw error;
} try {
    await restrict(path);
    return await operation();
}
finally {
    await handle.close();
    await unlink(path).catch(() => { });
} }
function manifestPath(stateDir) { return join(stateDir, 'configuration.json'); }
async function readManifest(stateDir) { const text = await readOptional(manifestPath(stateDir)); if (!text)
    return; const data = JSON.parse(text); if (data.version !== 1 || typeof data.configPath !== 'string' || typeof data.original !== 'string' || typeof data.backupPath !== 'string' || !Array.isArray(data.values) || data.values.some(x => !x || typeof x.path !== 'string' || typeof x.written !== 'string' || (x.original !== undefined && typeof x.original !== 'string')))
    throw new Error('Invalid configuration ownership manifest'); return data; }
async function writeConfig(path, before, after, hook) { let mode = 0o600; try {
    mode = (await lstat(path)).mode & 0o777;
}
catch (error) {
    if (error.code !== 'ENOENT')
        throw error;
} await atomicWrite(path, after, mode, async () => { await hook?.(); if (hash(await readOptional(path)) !== hash(before))
    throw new Error('Configuration changed concurrently; no replacement performed'); }); }
export async function configure(configPath, stateDir, options = {}) {
    if (options.mode === 'inspector-only')
        return { changed: false, conflicts: [] };
    return withLock(stateDir, async () => {
        const path = resolve(configPath);
        const before = await readOptional(path);
        const doc = scanToml(before);
        const old = await readManifest(stateDir);
        if (old && old.configPath !== path)
            throw new Error('State belongs to a different configuration path');
        const desired = new Map([['ui.sidebar.agents.rows', rowsToml(options.theme)]]);
        for (const entry of doc.entries)
            if (entry.path === 'ui.sidebar.agents.rows_by_agent' || entry.path.startsWith('ui.sidebar.agents.rows_by_agent.')) {
                if (entry.path === 'ui.sidebar.agents.rows_by_agent')
                    desired.set(entry.path, '{}');
                else
                    desired.set(entry.path, rowsToml(options.theme));
            }
        for (const [key, action] of Object.entries(options.keybindings ?? {})) {
            if (!/^[A-Za-z0-9_-]+$/.test(key) || typeof action !== 'string' || action.includes('\0'))
                throw new Error('Invalid optional keybinding');
            desired.set('keys.' + key, JSON.stringify(action));
        }
        const values = (old?.values ?? []).filter(v => !desired.has(v.path));
        let after = before;
        for (const [target, written] of desired) {
            const current = doc.entries.find(e => e.path === target)?.value;
            const previous = old?.values.find(v => v.path === target);
            if (current !== undefined && current !== written && (!previous || current !== previous.written) && !options.ownNative)
                throw new Error('Native sidebar/keybinding has existing ownership; choose ownNative explicitly or inspector-only');
            if (previous && current !== previous.written && current !== written)
                throw new Error('Managed configuration was edited by the user; unconfigure before replacing ' + target);
            values.push({ path: target, ...((previous?.original ?? current) !== undefined ? { original: previous ? previous.original : current } : {}), written });
            after = put(after, target, written);
        }
        const blocks = [...(old?.blocks ?? [])];
        if (options.pluginActionKey) {
            if (doc.entries.some(e => e.path === 'keys.command' || e.path.startsWith('keys.command.')) || doc.tables.some(t => t.path === 'keys.command'))
                throw new Error('Unsupported existing TOML topology for keys.command');
            const binding = options.pluginActionKey;
            for (const field of [binding.key, binding.command, binding.description ?? 'Prism'])
                if (typeof field !== 'string' || field.includes('\0') || field.length > 256)
                    throw new Error('Invalid plugin action key');
            const block = '\n# iob.herdr-prism command begin\n[[keys.command]]\nkey = ' + JSON.stringify(binding.key) + '\ntype = "plugin_action"\ncommand = ' + JSON.stringify(binding.command) + '\ndescription = ' + JSON.stringify(binding.description ?? 'Prism') + '\n# iob.herdr-prism command end\n';
            const previous = blocks[0];
            if (previous) {
                if (!after.includes(previous))
                    throw new Error('Plugin command binding was edited by user');
                after = after.replace(previous, block);
                blocks[0] = block;
            }
            else {
                if (after.includes('# iob.herdr-prism command begin'))
                    throw new Error('Foreign plugin command marker');
                after += block;
                blocks.push(block);
            }
            scanToml(after);
        }
        if (after === before)
            return { changed: false, conflicts: [], ...(old ? { backupPath: old.backupPath } : {}) };
        const backupPath = old?.backupPath ?? join(stateDir, 'configuration-original.toml');
        if (!old)
            await atomicWrite(backupPath, before);
        const manifest = { version: 1, configPath: path, original: old?.original ?? before, originalHash: old?.originalHash ?? hash(before), writtenHash: hash(after), backupPath, values, blocks };
        await atomicWrite(manifestPath(stateDir), JSON.stringify(manifest, null, 2) + '\n');
        try {
            await writeConfig(path, before, after, options.beforeCommit);
        }
        catch (error) {
            if (old)
                await atomicWrite(manifestPath(stateDir), JSON.stringify(old, null, 2) + '\n');
            else
                await unlink(manifestPath(stateDir)).catch(() => { });
            throw error;
        }
        return { changed: true, conflicts: [], backupPath };
    });
}
export async function unconfigure(configPath, stateDir) { return withLock(stateDir, async () => { const managed = await readManifest(stateDir); if (!managed)
    return { changed: false, conflicts: [] }; const path = resolve(configPath); if (path !== managed.configPath)
    throw new Error('State belongs to a different configuration path'); const before = await readOptional(path); let after = before; const conflicts = []; if (hash(before) === managed.writtenHash)
    after = managed.original;
else {
    const doc = scanToml(before);
    const edits = [];
    for (const value of managed.values) {
        const entry = doc.entries.find(e => e.path === value.path);
        if (!entry) {
            if (value.original !== undefined)
                conflicts.push(value.path);
            continue;
        }
        if (entry.value !== value.written) {
            conflicts.push(value.path);
            continue;
        }
        if (value.original !== undefined)
            edits.push({ start: entry.valueStart, end: entry.valueEnd, text: value.original });
        else
            edits.push({ start: entry.start, end: entry.end, text: '' });
    }
    after = replaceValues(before, edits);
    for (const block of managed.blocks ?? []) {
        const at = after.indexOf(block);
        if (at >= 0)
            after = after.slice(0, at) + after.slice(at + block.length);
        else
            conflicts.push('keys.command.plugin_action');
    }
    scanToml(after);
} if (after !== before)
    await writeConfig(path, before, after); if (!conflicts.length)
    await unlink(manifestPath(stateDir));
else {
    const remaining = { ...managed, values: managed.values.filter(v => conflicts.includes(v.path)), blocks: conflicts.includes('keys.command.plugin_action') ? managed.blocks : [] };
    await atomicWrite(manifestPath(stateDir), JSON.stringify(remaining, null, 2) + '\n');
} return { changed: after !== before, conflicts, backupPath: managed.backupPath }; }); }
