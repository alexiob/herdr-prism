import path from 'node:path';
import { homedir } from 'node:os';
import type { Rpc } from '../model/types.ts';
import { pluginId } from '../native/publisher.ts';
import { identityName } from '../state/store.ts';
export interface Arguments {
    command: string;
    options: Record<string, string | boolean>;
    positionals: string[];
}
const booleanOptions = new Set(['own-native', 'inspector-only', 'once', 'demo', 'ascii', 'monochrome', 'help', 'all', 'no-follow']);
export function parseArguments(argv: string[]): Arguments { const command = argv[0] && !argv[0].startsWith('--') ? argv.shift()! : 'open'; const options: Record<string, string | boolean> = {}; const positionals: string[] = []; for (let i = 0; i < argv.length; i++) {
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
} return { command, options, positionals }; }
export function runtimeContext(options: Record<string, string | boolean> = {}) {
    const configDir = String(options['config-dir'] ?? process.env.HERDR_PLUGIN_CONFIG_DIR ?? '');
    const stateDir = String(options['state-dir'] ?? process.env.HERDR_PLUGIN_STATE_DIR ?? '');
    if (!configDir || !stateDir)
        throw new Error('Run through Herdr plugin actions, or supply --config-dir and --state-dir');
    const base = process.env.XDG_CONFIG_HOME ?? (process.platform === 'win32' ? process.env.APPDATA : undefined) ?? path.join(homedir(), '.config');
    const configPath = String(options['config-path'] ?? process.env.HERDR_CONFIG_PATH ?? path.join(base, 'herdr', 'config.toml'));
    const endpoint = String(options.socket ?? process.env.HERDR_SOCKET_PATH ?? '');
    return { configDir, stateDir, configPath, endpoint, serverStateDir: path.join(stateDir, 'servers', identityName(endpoint || 'no-server')) };
}
export async function openPanel(rpc: Rpc, options: {
    targetPaneId?: string;
    existingPaneId?: string;
    existingTerminalId?: string;
} = {}) {
    if (options.existingPaneId) {
        const response = await rpc.call('session.snapshot');
        const snapshot = response.snapshot ?? response;
        const targetId = options.targetPaneId ?? snapshot.focused_pane_id;
        const target = snapshot.panes?.find((pane: any) => pane.pane_id === targetId);
        const existing = snapshot.panes?.find((pane: any) => options.existingTerminalId ? pane.terminal_id === options.existingTerminalId : pane.pane_id === options.existingPaneId);
        let paneId = existing?.pane_id ?? (options.existingTerminalId ? undefined : options.existingPaneId);
        if (!paneId)
            throw new Error('Existing dashboard pane is unavailable; retry or inspect doctor');
        if (target?.tab_id && existing?.tab_id && target.tab_id !== existing.tab_id) {
            const moved = await rpc.call('pane.move', { pane_id: paneId, destination: { type: 'tab', tab_id: target.tab_id, target_pane_id: target.pane_id, split: 'right', ratio: 0.68 }, focus: false });
            paneId = moved.move_result?.pane?.pane_id ?? moved.pane?.pane_id ?? paneId;
        }
        return rpc.call('plugin.pane.focus', { pane_id: paneId });
    }
    let target = options.targetPaneId;
    if (!target) {
        const response = await rpc.call('session.snapshot');
        const snapshot = response.snapshot ?? response;
        target = snapshot.focused_pane_id ?? snapshot.agents?.[0]?.pane_id;
    }
    if (!target)
        throw new Error('No tiled pane available for the right-side dashboard');
    return rpc.call('plugin.pane.open', { plugin_id: pluginId, entrypoint: 'inspector', placement: 'split', direction: 'right', target_pane_id: target, focus: false, ...(process.platform==='win32'?{env:windowsPaneEnvironment()}: {}) });
}
/** Herdr's pane environment may have a different PATH from its finite action.
 * Carry the already-running Node runtime into ConPTY executable resolution. */
export function windowsPaneEnvironment():Record<string,string>{return {PATH:path.dirname(process.execPath)+';'+(process.env.PATH??''),PATHEXT:process.env.PATHEXT??'.EXE;.CMD;.BAT'};}
