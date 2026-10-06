import { StateStore } from "../state/store.js";
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** No mkdir: delayed invocations cannot recreate a removed installation's state. */
export async function acquireAdmission(stateDir, options = {}) {
    const store = new StateStore(stateDir), deadline = Date.now() + (options.timeoutMs ?? 15000);
    while (Date.now() < deadline) {
        let lease;
        try {
            lease = await store.acquire({ name: 'admission', create: false });
        }
        catch (error) {
            if (/owner is live|recovery in progress|now owns/.test(error.message)) {
                await sleep(25);
                continue;
            }
            throw error;
        }
        try {
            if (!options.allowDisabled && (await store.read('lifecycle'))?.disabled)
                throw new Error('Plugin is deactivated');
            return lease;
        }
        catch (error) {
            await lease.release();
            throw error;
        }
    }
    throw new Error('Plugin lifecycle admission timed out');
}
