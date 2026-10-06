import path from 'node:path';
import { homedir } from 'node:os';
import { pluginId } from "../native/publisher.js";
import { identityName } from "../state/store.js";
const booleanOptions = new Set(['own-native', 'inspector-only', 'once', 'demo', 'ascii', 'monochrome', 'help', 'all', 'no-follow']);
export function parseArguments(argv) {
    const command = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'open';
    const options = {};
    const positionals = [];
    for (let i = 0; i < argv.length; i++) {
        const value = argv[i];
        if (value === '--') {
            positionals.push(...argv.slice(i + 1));
            break;
        }
        if (!value.startsWith('--')) {
            positionals.push(value);
            continue;
        }
        const [name, inline] = value.slice(2).split(/=(.*)/s);
        if (booleanOptions.has(name)) {
            options[name] = true;
            continue;
        }
        if (inline !== undefined) {
            options[name] = inline;
            continue;
        }
        if (!argv[i + 1] || argv[i + 1].startsWith('--'))
            throw new Error(`--${name} requires a value`);
        options[name] = argv[++i];
    }
    return { command, options, positionals };
}
export function runtimeContext(options = {}) {
    const configDir = String(options['config-dir'] ?? process.env.HERDR_PLUGIN_CONFIG_DIR ?? '');
    const stateDir = String(options['state-dir'] ?? process.env.HERDR_PLUGIN_STATE_DIR ?? '');
    if (!configDir || !stateDir)
        throw new Error('Run through Herdr plugin actions, or supply --config-dir and --state-dir');
    const base = process.env.XDG_CONFIG_HOME ?? (process.platform === 'win32' ? process.env.APPDATA : undefined) ?? path.join(homedir(), '.config');
    const configPath = String(options['config-path'] ?? process.env.HERDR_CONFIG_PATH ?? path.join(base, 'herdr', 'config.toml'));
    const endpoint = String(options.socket ?? process.env.HERDR_SOCKET_PATH ?? '');
    return { configDir, stateDir, configPath, endpoint, serverStateDir: path.join(stateDir, 'servers', identityName(endpoint || 'no-server')) };
}
export async function openPanel(rpc, options = {}) {
    let target = options.targetPaneId;
    if (!target) {
        const response = await rpc.call('session.snapshot');
        const snapshot = response.snapshot ?? response;
        target = snapshot.focused_pane_id ?? snapshot.agents?.[0]?.pane_id;
    }
    if (!target)
        throw new Error('No tiled pane available for the right-side dashboard');
    return rpc.call('plugin.pane.open', { plugin_id: pluginId, entrypoint: 'inspector', placement: 'split', direction: 'right', target_pane_id: target, focus: false, ...(process.platform === 'win32' ? { env: windowsPaneEnvironment() } : {}) });
}
/** Herdr's pane environment may have a different PATH from its finite action.
 * Carry the already-running Node runtime into ConPTY executable resolution. */
export function windowsPaneEnvironment() { return { PATH: path.dirname(process.execPath) + ';' + (process.env.PATH ?? ''), PATHEXT: process.env.PATHEXT ?? '.EXE;.CMD;.BAT' }; }
