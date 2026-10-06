import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, unlink, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, identityName } from '../src/state/store.ts';
import { RpcError } from '../src/herdr/client.ts';
import { activate, deactivate } from '../src/runtime/lifecycle.ts';
import { MailboxServer } from '../src/state/mailbox.ts';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {acquireAdmission} from '../src/runtime/admission.ts';

test('admission waits for an exclusively created lease to finish rather than parsing or reclaiming its empty owner record',async t=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-lease-initializing-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const lock=path.join(dir,'admission.lock');await writeFile(lock,'');
 let settled=false;const pending=acquireAdmission(dir,{timeoutMs:1000}).then(value=>{settled=true;return value;});
 // Observe the rejection immediately too, so the red regression has no unhandled promise.
 const observed=pending.catch(error=>error);
 await new Promise(resolve=>setTimeout(resolve,100));assert.equal(await readFile(lock,'utf8'),'','An uncertain initializer must remain untouched');
 await unlink(lock);const lease=await observed;if(lease instanceof Error)throw lease;
 assert.equal(settled,true);await lease.release();
});

test('activation replaces an owned inspector that exits between snapshot and close', async t => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'prism-pane-race-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const context = { stateDir: path.join(dir, 'state'), configDir: path.join(dir, 'config'), configPath: path.join(dir, 'config.toml'), endpoint: 'pane-race', serverStateDir: path.join(dir, 'state', 'servers', identityName('pane-race')) };
    const store = new StateStore(context.serverStateDir);
    await store.write('pane', { paneId: 'exiting', terminalId: 'exiting-terminal' });
    let gone = false, opened = false;
    let mailbox: MailboxServer | undefined;
    t.after(async () => { await mailbox?.close(); });
    const rpc = { call: async (method: string, params: any = {}): Promise<any> => {
        if (method === 'session.snapshot') return { snapshot: { focused_pane_id: 'original', panes: gone ? [] : [{ pane_id: 'exiting', terminal_id: 'exiting-terminal' }] } };
        if (method === 'plugin.pane.close') {
            assert.equal(params.pane_id, 'exiting');
            gone = true;
            throw new RpcError('plugin_pane_not_found', 'plugin pane not found');
        }
        if (method === 'plugin.pane.open') {
            assert.ok(gone);
            opened = true;
            await store.write('controller', { token: 'replacement-token', pid: process.pid });
            mailbox = new MailboxServer(context.serverStateDir, 'replacement-token', async () => ({ ready: true, stale: false }));
            await mailbox.start();
            return { plugin_pane: { plugin_id: 'iob.herdr-prism', entrypoint: 'inspector', pane: { pane_id: 'replacement', terminal_id: 'replacement-terminal' } } };
        }
        return {};
    } };
    const result = await activate(context, rpc, { mode: 'inspector-only', timeoutMs: 3000 });
    assert.ok(result.activated && opened);
    assert.deepEqual(await store.read('pane'), { paneId: 'replacement', terminalId: 'replacement-terminal' });
});

test('owned pane cleanup preserves recovery marker and fails on other close errors', async t => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'prism-pane-error-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const context = { stateDir: path.join(dir, 'state'), configDir: path.join(dir, 'config'), configPath: path.join(dir, 'config.toml'), endpoint: 'close-error', serverStateDir: path.join(dir, 'state', 'servers', identityName('close-error')) };
    const store = new StateStore(context.serverStateDir), marker = { paneId: 'owned', terminalId: 'owned-terminal' };
    await store.write('pane', marker);
    const failure = new RpcError('permission_denied', 'close rejected');
    const rpc = { call: async (method: string): Promise<any> => {
        if (method === 'session.snapshot') return { snapshot: { panes: [{ pane_id: 'owned', terminal_id: 'owned-terminal' }] } };
        if (method === 'plugin.pane.close') throw failure;
        return {};
    } };
    await assert.rejects(deactivate(context, rpc), error => error === failure);
    assert.deepEqual(await store.read('pane'), marker);
});
