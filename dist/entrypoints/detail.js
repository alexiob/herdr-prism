import { acquireAdmission } from "../runtime/admission.js";
import { randomUUID } from 'node:crypto';
import { StateStore } from "../state/store.js";
import { runtimeContext } from "../runtime/actions.js";
import { existingController } from "../runtime/service.js";
import { TerminalUi } from "../tui/terminal.js";
import { wrap, truncate } from "../tui/text.js";
import { ProviderIndex } from "../providers/index.js";
async function main() {
    const context = runtimeContext();
    const globalStore = new StateStore(context.stateDir);
    if ((await globalStore.read('lifecycle'))?.disabled)
        throw new Error('Plugin is deactivated');
    const controller = await existingController(context);
    if (!controller)
        throw new Error('Owning dashboard unavailable');
    const admission = await acquireAdmission(context.stateDir);
    const store = new StateStore(context.serverStateDir);
    const marker = 'detail-' + randomUUID();
    try {
        await store.write(marker, { pid: process.pid, token: controller.marker.token });
    }
    finally {
        await admission.release();
    }
    try {
        const locator = await controller.client.request('message-locator', { session: process.env.HAT_DETAIL_SESSION, id: process.env.HAT_DETAIL_MESSAGE });
        const index = new ProviderIndex({ codexHome: locator.providerHomes?.codex, claudeHome: locator.providerHomes?.claude, piHome: locator.providerHomes?.pi });
        index.setActiveRefs([{ provider: locator.provider, ...locator.ref }]);
        index.setDetailedRefs([]); // readMessage is an explicit single-source fetch.
        let message;
        try {
            message = await index.readMessage(locator.provider, locator.ref, locator.messageId);
        }
        finally {
            index.close();
        }
        if (!message)
            throw new Error('Message unavailable');
        const text = `${message.role} · ${message.timestamp ? new Date(message.timestamp).toISOString() : 'time unavailable'}\n\n${message.text}\n\n${(message.tools ?? []).map((t) => `${t.status} ${t.name}: ${t.summary ?? ''}`).join('\n')}`;
        const ui = new TerminalUi();
        let scroll = 0;
        const paint = () => { const lines = wrap(text, ui.columns); scroll = Math.max(0, Math.min(scroll, Math.max(0, lines.length - ui.rows + 1))); ui.paint({ lines: [...lines.slice(scroll, scroll + ui.rows - 1).map(l => truncate(l, ui.columns)), 'j/k scroll · y copy · Esc close'], rows: [], bodyStart: 0, bodyHeight: ui.rows - 1, numericTargets: new Map() }); };
        if (!process.stdin.isTTY) {
            paint();
            return;
        }
        ui.start();
        paint();
        await new Promise(resolve => {
            let done = false;
            const close = () => {
                if (done)
                    return;
                done = true;
                clearInterval(health);
                ui.close();
                resolve();
            };
            const health = setInterval(() => void store.read('controller').then(current => {
                if (!current || current.token !== controller.marker.token)
                    close();
            }).catch(() => close()), 100);
            ui.on('resize', paint);
            ui.on('input', async (event) => {
                if (event.type !== 'key')
                    return;
                if (['escape', 'q', 'ctrl+c'].includes(event.key))
                    return close();
                if (['j', 'down'].includes(event.key))
                    scroll++;
                if (['k', 'up'].includes(event.key))
                    scroll--;
                if (event.key === 'pagedown')
                    scroll += ui.rows - 1;
                if (event.key === 'pageup')
                    scroll -= ui.rows - 1;
                if (event.key === 'y') {
                    const { copyText } = await import("../tui/platform.js");
                    await copyText(message.text).catch(() => { });
                }
                paint();
            });
            process.once('SIGTERM', close);
            process.stdin.once('end', close);
        });
    }
    finally {
        await store.remove(marker);
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
