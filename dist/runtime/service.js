import { acquireAdmission } from "./admission.js";
import { HerdrClient } from "../herdr/client.js";
import { loadSettings } from "../config/index.js";
import { StateStore } from "../state/store.js";
import { MailboxClient } from "../state/mailbox.js";
import { runtimeContext } from "./actions.js";
import { Collector } from "./collector.js";
export async function serviceContext(options = {}) {
    const context = runtimeContext(options);
    const configured = await new StateStore(context.stateDir).read('configuration');
    const settings = await loadSettings(context.configDir);
    if (!configured || options['inspector-only'])
        settings.nativeMode = 'inspector-only';
    return { ...context, settings };
}
export async function existingController(context) {
    const marker = await new StateStore(context.serverStateDir).read('controller');
    if (!marker || typeof marker.token !== 'string')
        return;
    const client = new MailboxClient(context.serverStateDir, marker.token, 2000);
    return { marker, client };
}
export async function finiteRefresh(options = {}) {
    const context = await serviceContext(options);
    if ((await new StateStore(context.stateDir).read('lifecycle'))?.disabled)
        return { disabled: true };
    const existing = await existingController(context);
    if (existing) {
        try {
            return await existing.client.request('refresh');
        }
        catch { /* A dead collector does not prevent a finite source reconciliation. */ }
    }
    const rpc = new HerdrClient(context.endpoint);
    const admission = await acquireAdmission(context.stateDir);
    const store = new StateStore(context.serverStateDir);
    let lease;
    try {
        await store.init();
        lease = await store.acquire();
        const collector = new Collector({ rpc, settings: context.settings, stateDir: context.serverStateDir });
        try {
            await store.write('server', { endpoint: context.endpoint });
            await collector.init();
            await collector.refresh();
            return { sessions: collector.data.sessions.length, stale: collector.data.stale, diagnostics: collector.data.diagnostics };
        }
        finally {
            try {
                await collector.close({ clearNative: false });
            }
            finally {
                rpc.close();
                await lease.release();
                await admission.release();
            }
        }
    }
    catch (error) {
        rpc.close();
        await lease?.release();
        await admission.release();
        throw error;
    }
}
