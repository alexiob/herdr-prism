import { finiteRefresh, serviceContext } from '../runtime/service.ts';
import { StateStore } from '../state/store.ts';
import { HerdrClient } from '../herdr/client.ts';
import { openPanel } from '../runtime/actions.ts';
async function main() { const context = await serviceContext(); if ((await new StateStore(context.stateDir).read<{
    disabled: boolean;
}>('lifecycle'))?.disabled)
    return; if (context.settings.nativeMode !== 'inspector-only')
    await finiteRefresh(); const value = context.settings as unknown as {
    autostart?: boolean;
}; if (value.autostart) {
    const rpc = new HerdrClient(context.endpoint);
    try {
        await openPanel(rpc);
    }
    finally {
        rpc.close();
    }
} }
main().catch(error => { console.error(error.message); process.exitCode = 1; });
