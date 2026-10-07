import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { parseArguments, runtimeContext, openPanel } from '../runtime/actions.ts';
import { serviceContext, existingController, finiteRefresh } from '../runtime/service.ts';
import {openTabPanel} from '../runtime/collector-service.ts';
import { HerdrClient } from '../herdr/client.ts';
import { StateStore } from '../state/store.ts';
import { activate, deactivate, managedRequest, acknowledge } from '../runtime/lifecycle.ts';
import { configure, unconfigure, loadSettings } from '../config/index.ts';
import { pluginId, source } from '../native/publisher.ts';
import { supportedMethods } from '../herdr/schema.ts';
export async function main(argv = process.argv.slice(2)): Promise<unknown> {
    const args = parseArguments([...argv]);
    if (args.options.help)
        return { usage: 'action.js activate|deactivate|open|configure|unconfigure|refresh|native|settings|doctor|set-goal [--config-dir PATH --state-dir PATH]' };
    const context = await serviceContext(args.options);
    const settings = context.settings;
    if (['activate', 'activate-overview', 'activate-inspector', 'deactivate'].includes(args.command)) {
        const operation = args.command === 'deactivate' ? 'deactivate' : 'activate';
        const root = String(process.env.HERDR_PLUGIN_ROOT ?? fileURLToPath(new URL('../../', import.meta.url)));
        const request = await managedRequest(root, operation);
        const rpc = new HerdrClient(context.endpoint);
        try {
            const result = operation === 'deactivate' ? await deactivate(context, rpc, { request, root }) : await activate(context, rpc, { mode: args.command === 'activate-inspector' || request?.mode === 'inspector-only' ? 'inspector-only' : 'overview', ownNative: args.command !== 'activate-inspector' && (request?.mode === 'own-native' || request === undefined), root, request, restoreViewsOnly: args.options['restore-views-only']===true });
            if (request)
                await acknowledge(root, request, { ok: true, result });
            return result;
        }
        catch (error) {
            if (request)
                await acknowledge(root, request, { ok: false, error: (error as Error).message });
            throw error;
        }
        finally {
            rpc.close();
        }
    }
    if (args.command === 'configure') {
        const result = await configure(context.configPath, context.stateDir, { mode: args.options['inspector-only'] ? 'inspector-only' : 'overview', ownNative: args.options['own-native'] === true, theme: args.options.theme === 'light' ? 'light' : args.options.theme === 'mono' ? 'mono' : 'dark', ...(typeof args.options.key === 'string' ? { pluginActionKey: { key: args.options.key, command: pluginId + '.open', description: 'Prism dashboard' } } : {}) });
        const original = await loadSettings(context.configDir);
        await new StateStore(context.configDir).write('settings', { ...original, nativeMode: args.options['inspector-only'] ? 'inspector-only' : 'overview' });
        return result;
    }
    if (args.command === 'settings') {
        const value = await loadSettings(context.configDir);
        if (typeof args.options.set === 'string') {
            const index = args.options.set.indexOf('=');
            if (index < 1)
                throw new Error('--set requires KEY=JSON_VALUE');
            const key = args.options.set.slice(0, index);
            if (!Object.hasOwn(value, key) && key !== 'costRates')
                throw new Error('Unknown setting');
            const next = { ...value, [key]: JSON.parse(args.options.set.slice(index + 1)) };
            const store = new StateStore(context.configDir);
            const previous = value;
            await store.write('settings', next);
            try {
                await loadSettings(context.configDir);
            }
            catch (error) {
                await store.write('settings', previous);
                throw error;
            }
            return { saved: true, settings: next };
        }
        return { path: path.join(context.configDir, 'settings.json'), settings: value };
    }
    if(args.command==='reload-settings'){const owner=await existingController(context);if(!owner)return{reloaded:true,active:false,tabOrder:settings.ui?.tabOrder};return owner.client.request('reload-settings',{tabOrder:settings.ui?.tabOrder,nativeGrouping:settings.ui?.nativeGrouping});}
    if (args.command === 'refresh' || args.command === 'native')
        return finiteRefresh(args.options);
    const rpc = new HerdrClient(context.endpoint);
    try {
        const controller = await existingController(context);
        if (args.command === 'open') {
            const response=await rpc.call('session.snapshot');
            const snapshot=response.snapshot??response;
            return await openTabPanel(context,snapshot.focused_pane_id);
        }
        if (args.command === 'unconfigure')
            return await deactivate(context, rpc);
        if (args.command === 'set-goal') {
            if (!controller)
                throw new Error('Open the dashboard before setting a session goal');
            const session = String(args.options.session ?? '');
            const objective = String(args.options.objective ?? args.positionals.join(' '));
            if (!session || !objective)
                throw new Error('set-goal requires --session PROVIDER:ID and --objective TEXT');
            return controller.client.request('set-goal', { session, objective, status: String(args.options.status ?? 'active') });
        }
        if (args.command === 'doctor') {
            let ping: unknown, error: string | undefined;
            try {
                ping = await rpc.call('ping');
            }
            catch (e) {
                error = (e as Error).message;
            }
            const root = fileURLToPath(new URL('../../', import.meta.url));
            let helper = true;
            if (process.platform !== 'linux')
                try {
                    await access(path.join(root, 'bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'hat-sampler.exe' : 'hat-sampler'));
                }
                catch {
                    helper = false;
                }
            return { plugin: pluginId, node: process.version, platform: process.platform, arch: process.arch, herdr: ping, connectionError: error, methods: supportedMethods(), collector: !!controller, samplerPresent: helper, nativeConfigured: settings.nativeMode !== 'inspector-only', todoParserEnabled: settings.todosEnabled };
        }
        throw new Error(`Unknown action: ${args.command}`);
    }
    finally {
        rpc.close();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
