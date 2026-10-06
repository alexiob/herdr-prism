import { finiteRefresh, serviceContext } from "../runtime/service.js";
import { StateStore } from "../state/store.js";
import { HerdrClient } from "../herdr/client.js";
import { openPanel } from "../runtime/actions.js";
async function main() {
    const context = await serviceContext();
    if ((await new StateStore(context.stateDir).read('lifecycle'))?.disabled)
        return;
    if (context.settings.nativeMode !== 'inspector-only')
        await finiteRefresh();
    const value = context.settings;
    if (value.autostart) {
        const rpc = new HerdrClient(context.endpoint);
        try {
            await openPanel(rpc);
        }
        finally {
            rpc.close();
        }
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
