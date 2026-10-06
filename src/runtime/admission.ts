import { StateStore } from '../state/store.ts';
import path from 'node:path';
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** No mkdir: delayed invocations cannot recreate a removed installation's state. */
export async function acquireAdmission(stateDir: string, options: {
    allowDisabled?: boolean;
    timeoutMs?: number;
} = {}) {
    const store = new StateStore(stateDir), deadline = Date.now() + (options.timeoutMs ?? 15000);
    while (Date.now() < deadline) {
        let lease;
        try {
            lease = await store.acquire({ name: 'admission', create: false });
        }
        catch (error) {
            // A Windows owner can release the exact lease after EEXIST but
            // before inspection. Retry through the same guarded acquisition;
            // absence of the state directory itself must still fail immediately.
            const missingWindowsLease=process.platform==='win32'&&(error as NodeJS.ErrnoException).code==='ENOENT'&&(error as NodeJS.ErrnoException).path===path.join(stateDir,'admission.lock');
            if (missingWindowsLease||/owner is live|recovery in progress|lease initialization in progress|now owns/.test((error as Error).message)) {
                await sleep(25);
                continue;
            }
            throw error;
        }
        try {
            if (!options.allowDisabled && (await store.read<{
                disabled: boolean;
            }>('lifecycle'))?.disabled)
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
