import path from 'node:path';
import { readdir, lstat, readFile, unlink } from 'node:fs/promises';
import { openPanel } from "./actions.js";
import { existingController } from "./service.js";
import { StateStore, processIsAbsent } from "../state/store.js";
import { HerdrClient } from "../herdr/client.js";
import { configure, unconfigure, loadSettings } from "../config/index.js";
import { atomicWrite, readOptional, securePluginNamespace } from "../config/safe-file.js";
import { acquireAdmission } from "./admission.js";
import { pluginId, source, clearPublication } from "../native/publisher.js";
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function recordedPanes(store, controller) { return [await store.read('pane'), controller].filter((value) => !!value && typeof value.terminalId === 'string'); }
async function closeOwnedPanes(store, rpc, owned) {
    if (!owned.length)
        return;
    const response = await rpc.call('session.snapshot');
    const panes = (response.snapshot ?? response).panes;
    if (!Array.isArray(panes))
        throw new Error('Cannot verify owned dashboard panes without a session snapshot');
    const closed = new Set();
    for (const record of owned) {
        const pane = panes.find((p) => p.terminal_id === record.terminalId);
        if (!pane || typeof pane.pane_id !== 'string' || closed.has(pane.pane_id))
            continue;
        try {
            await rpc.call('plugin.pane.close', { pane_id: pane.pane_id });
        }
        catch (error) {
            // Herdr may remove the terminal as its collector exits after snapshot.
            // Its precise absence response means the requested cleanup is done.
            if (error.code !== 'plugin_pane_not_found')
                throw error;
        }
        closed.add(pane.pane_id);
    }
    // Do not erase a newer inspector's marker if it appeared during cleanup.
    const current = await store.read('pane');
    if (current && owned.some(p => p.terminalId === current.terminalId))
        await store.remove('pane');
}
export async function managedRequest(root, operation) {
    const receiptText = await readOptional(path.join(root, '.hat-managed-install.json'));
    if (!receiptText)
        return;
    const receipt = JSON.parse(receiptText);
    if (receipt.version !== 1 || receipt.pluginId !== pluginId || receipt.installRoot !== path.resolve(root) || typeof receipt.token !== 'string' || receipt.token.length < 16)
        throw new Error('Invalid managed installation receipt');
    const text = await readOptional(path.join(root, '.hat-lifecycle-request.json'));
    if (!text)
        return;
    const request = JSON.parse(text);
    if (request.version !== 1 || request.pluginId !== pluginId || request.token !== receipt.token || typeof request.requestId !== 'string' || request.operation !== operation || request.mode !== undefined && !['overview', 'inspector-only', 'own-native', 'remove'].includes(request.mode) || request.shortcut !== undefined && typeof request.shortcut !== 'boolean')
        throw new Error('Invalid lifecycle request');
    return request;
}
export async function acknowledge(root, request, value) {
    await atomicWrite(path.join(root, '.hat-lifecycle-result.json'), JSON.stringify({ ...request, ...value }) + '\n');
    const current = JSON.parse(await readOptional(path.join(root, '.hat-lifecycle-request.json')) || 'null');
    if (current?.requestId === request.requestId && current?.token === request.token)
        await unlink(path.join(root, '.hat-lifecycle-request.json'));
}
export async function activate(context, rpc, options = {}) {
    if (process.platform === 'win32' && process.env.HERDR_PLUGIN_ID === pluginId)
        await securePluginNamespace(context.configDir, context.stateDir);
    const state = new StateStore(context.stateDir), config = new StateStore(context.configDir);
    const admission = await acquireAdmission(context.stateDir, { allowDisabled: true, timeoutMs: options.timeoutMs });
    let changed;
    const mode = options.mode ?? 'overview';
    try {
        const lifecycle = await state.read('lifecycle');
        if (lifecycle?.removing && (!options.request || lifecycle.token === options.request.token))
            throw new Error('Removal is in progress; this installation cannot reactivate');
        await state.init();
        await config.init();
        // A failed activation leaves the reversible ownership manifest available to cleanup.
        await state.write('lifecycle', { disabled: false });
        changed = await configure(context.configPath, context.stateDir, { mode, ownNative: options.ownNative, ...(options.request?.shortcut ? { pluginActionKey: { key: 'prefix+i', command: pluginId + '.open', description: 'Open Prism' }, shortcutIfFree: true } : {}) });
        await config.write('settings', { ...await loadSettings(context.configDir), nativeMode: mode, autostart: true });
        if (options.request && options.root) {
            const owner = { version: 1, pluginId, token: options.request.token, installRoot: path.resolve(options.root) };
            await atomicWrite(path.join(context.configDir, '.hat-lifecycle-owner.json'), JSON.stringify(owner) + '\n');
            await atomicWrite(path.join(context.stateDir, '.hat-lifecycle-owner.json'), JSON.stringify(owner) + '\n');
        }
    }
    finally {
        await admission.release();
    }
    await rpc.call('server.reload_config');
    const prior = await existingController(context);
    const serverStore = new StateStore(context.serverStateDir);
    const oldPanes = await recordedPanes(serverStore, prior?.marker);
    if (prior) {
        await prior.client.request('shutdown');
        await waitForStopped(context.serverStateDir, options.timeoutMs ?? 15000);
    }
    await closeOwnedPanes(serverStore, rpc, oldPanes);
    const opened = await openPanel(rpc);
    const pluginPane = opened.plugin_pane;
    if (pluginPane?.plugin_id !== pluginId || pluginPane.entrypoint !== 'inspector' || typeof pluginPane.pane?.pane_id !== 'string' || typeof pluginPane.pane?.terminal_id !== 'string')
        throw new Error('Invalid dashboard pane ownership response');
    // The child may fail before it writes its controller; the server's open result
    // is the authoritative identity needed to close that pane during recovery.
    await serverStore.write('pane', { paneId: pluginPane.pane.pane_id, terminalId: pluginPane.pane.terminal_id });
    const deadline = Date.now() + (options.timeoutMs ?? 15000);
    while (Date.now() < deadline) {
        const controller = await existingController(context);
        if (controller) {
            try {
                const status = await controller.client.request('ping');
                if (status.ready && !status.stale)
                    return { activated: true, configDir: context.configDir, stateDir: context.stateDir, mode, conflicts: changed.conflicts, ...(changed.shortcut ? { shortcut: changed.shortcut } : {}) };
            }
            catch { /* Pane startup is asynchronous; wait for its authenticated ready signal. */ }
        }
        await sleep(100);
    }
    throw new Error('Dashboard did not become ready; run doctor or deactivate before retrying');
}
export async function waitForStopped(dir, timeoutMs = 15000) {
    const store = new StateStore(dir), deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const marker = await store.read('controller');
        let lock;
        try {
            const info = await lstat(path.join(dir, 'collector.lock'));
            if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
                throw new Error('Unsafe collector lease');
            lock = JSON.parse(await readFile(path.join(dir, 'collector.lock'), 'utf8'));
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
        }
        if (!marker && !lock)
            return;
        if ((!marker || processIsAbsent(marker.pid)) && (!lock || processIsAbsent(lock.pid))) {
            if (marker)
                await store.remove('controller');
            if (lock)
                await unlink(path.join(dir, 'collector.lock'));
            return;
        }
        await sleep(50);
    }
    throw new Error('Collector shutdown did not complete; refusing to purge live state');
}
export async function waitForDetailsStopped(dir, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        let live = false;
        for (const name of await readdir(dir).catch(e => {
            if (e.code === 'ENOENT')
                return [];
            throw e;
        })) {
            if (!/^detail-[a-f0-9-]{36}\.json$/.test(name))
                continue;
            const store = new StateStore(dir), record = await store.read(name.slice(0, -5));
            if (record && processIsAbsent(record.pid))
                await store.remove(name.slice(0, -5));
            else if (record)
                live = true;
        }
        if (!live)
            return;
        await sleep(50);
    }
    throw new Error('Detail popup shutdown did not complete; refusing purge');
}
export async function deactivate(context, rpc, options = {}) {
    if (process.platform === 'win32' && process.env.HERDR_PLUGIN_ID === pluginId)
        await securePluginNamespace(context.configDir, context.stateDir);
    const state = new StateStore(context.stateDir);
    await state.init();
    const admission = await acquireAdmission(context.stateDir, { allowDisabled: true, timeoutMs: options.timeoutMs });
    try {
        const previous = await state.read('lifecycle');
        await state.write('lifecycle', { disabled: true, removing: previous?.removing || options.request?.mode === 'remove', token: options.request?.token ?? previous?.token });
        const dirs = new Map([[context.serverStateDir, context.endpoint]]);
        const servers = path.join(context.stateDir, 'servers');
        for (const entry of await readdir(servers, { withFileTypes: true }).catch(e => {
            if (e.code === 'ENOENT')
                return [];
            throw e;
        })) {
            if (!/^[a-f0-9]{64}$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink())
                throw new Error('Unsafe server state path');
            const dir = path.join(servers, entry.name);
            const endpoint = await new StateStore(dir).read('server');
            if (endpoint?.endpoint)
                dirs.set(dir, endpoint.endpoint);
        }
        const factory = options.rpcFactory ?? ((endpoint) => new HerdrClient(endpoint));
        for (const [dir, endpoint] of dirs) {
            const serverStore = new StateStore(dir);
            const controller = await existingController({ ...context, serverStateDir: dir });
            const ownedPanes = await recordedPanes(serverStore, controller?.marker);
            if (controller) {
                try {
                    await controller.client.request('shutdown');
                }
                catch (error) {
                    if (!processIsAbsent(controller.marker.pid))
                        throw error;
                }
            }
            await waitForStopped(dir, options.timeoutMs);
            await waitForDetailsStopped(dir, options.timeoutMs);
            const client = endpoint === context.endpoint ? rpc : factory(endpoint);
            try {
                await closeOwnedPanes(serverStore, client, ownedPanes);
                await clearPublication(client, await serverStore.read('publication') ?? []);
                await client.call('agent.view.clear', { source });
            }
            catch (error) {
                const code = error.code;
                const text = error.message;
                if (!['ENOENT', 'ECONNREFUSED'].includes(code ?? '') && !/connect (ENOENT|ECONNREFUSED)/.test(text))
                    throw error;
            }
            finally {
                if (client !== rpc)
                    client.close?.();
            }
        }
        const result = await unconfigure(context.configPath, context.stateDir);
        await new StateStore(context.configDir).write('settings', { ...await loadSettings(context.configDir), nativeMode: 'inspector-only', autostart: false });
        for (const endpoint of new Set(dirs.values())) {
            const client = endpoint === context.endpoint ? rpc : factory(endpoint);
            try {
                await client.call('server.reload_config');
            }
            catch (error) {
                if (!['ENOENT', 'ECONNREFUSED'].includes(error.code ?? ''))
                    throw error;
            }
            finally {
                if (client !== rpc)
                    client.close?.();
            }
        }
        if (result.conflicts.length)
            throw new Error('User-modified configuration conflicts preserved: ' + result.conflicts.join(', '));
        if (options.request && options.root) {
            const owner = { version: 1, pluginId, token: options.request.token, installRoot: path.resolve(options.root) };
            await new StateStore(context.configDir).init();
            await atomicWrite(path.join(context.configDir, '.hat-lifecycle-owner.json'), JSON.stringify(owner) + '\n');
            await atomicWrite(path.join(context.stateDir, '.hat-lifecycle-owner.json'), JSON.stringify(owner) + '\n');
        }
        return { deactivated: true, configDir: context.configDir, stateDir: context.stateDir, conflicts: result.conflicts };
    }
    finally {
        await admission.release();
    }
}
