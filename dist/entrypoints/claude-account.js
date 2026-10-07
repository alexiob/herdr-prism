import { fileURLToPath } from 'node:url';
import { submitClaudeAccount } from "../runtime/claude-account.js";
const args = process.argv.slice(2);
let stateDir = process.env.HERDR_PLUGIN_STATE_DIR ?? '', endpoint = process.env.HERDR_SOCKET_PATH ?? '', passthrough = false, printConfig = false;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--print-config')
        printConfig = true;
    else if (args[i] === '--passthrough')
        passthrough = true;
    else if (args[i] === '--state-dir' && args[i + 1])
        stateDir = args[++i];
    else if (args[i] === '--socket' && args[i + 1])
        endpoint = args[++i];
    else
        throw Error('Use --state-dir DIR [--socket ENDPOINT] [--passthrough] [--print-config]');
}
if (printConfig) {
    if (!stateDir)
        throw Error('--state-dir is required');
    const quote = (value) => process.platform === 'win32' ? '"' + value.replaceAll('"', '\\"') + '"' : "'" + value.replaceAll("'", "'\"'\"'") + "'";
    console.log(JSON.stringify({ statusLine: { type: 'command', command: [process.execPath, fileURLToPath(import.meta.url), '--state-dir', stateDir, ...args.includes('--socket') ? ['--socket', endpoint] : []].map(quote).join(' ') } }, null, 2));
    process.exit(0);
}
let bytes = 0, oversized = false;
const chunks = [];
// Fail quietly so a missing/deactivated plugin cannot break another status line.
try {
    for await (const chunk of process.stdin) {
        const data = Buffer.from(chunk);
        if (passthrough)
            process.stdout.write(data);
        bytes += data.length;
        if (bytes > 1024 * 1024) {
            oversized = true;
            chunks.length = 0;
        }
        if (!oversized)
            chunks.push(data);
    }
    if (!oversized)
        await submitClaudeAccount(stateDir, endpoint, JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
catch { /* No credential-bearing input or error payload is logged. */ }
