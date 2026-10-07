import { object, identity } from "../providers/common.js";
import { parseAccountLimits } from "../metrics/account-limits.js";
import { StateStore, identityName, processIsAbsent } from "../state/store.js";
import { MailboxClient } from "../state/mailbox.js";
import { acquireAdmission } from "./admission.js";
import path from 'node:path';
/** Forward an allowlist only. Never spool the full status-line input or credentials. */
export function claudeAccountPayload(input, now = Date.now()) {
    const value = object(input), sessionId = identity(value.session_id);
    if (!sessionId)
        return;
    const a = parseAccountLimits('claude', sessionId, value.rate_limits, now, 'Claude status line');
    if (!a)
        return { sessionId, rateLimits: null };
    const rateLimits = {};
    for (const w of a.windows)
        rateLimits[w.id] = { used_percentage: w.usedPercent, ...(w.resetsAt === undefined ? {} : { resets_at: w.resetsAt / 1000 }) };
    if (a.spend)
        rateLimits.spend_limit = { ...object(rateLimits.spend_limit), used_usd: a.spend.usedUsd, limit_usd: a.spend.limitUsd, period: a.spend.period };
    return { sessionId, rateLimits };
}
export async function submitClaudeAccount(stateDir, endpoint, input) {
    const payload = claudeAccountPayload(input);
    if (!payload || !stateDir || !endpoint)
        return false;
    // Admission never creates directories and serializes with complete uninstall.
    const admission = await acquireAdmission(stateDir, { timeoutMs: 1000 });
    try {
        const dir = path.join(stateDir, 'servers', identityName(endpoint)), marker = await new StateStore(dir).read('controller');
        if (!marker || marker.kind !== 'collector-service' || marker.endpoint !== endpoint || typeof marker.token !== 'string' || !marker.token || marker.token.length > 128 || !Number.isSafeInteger(marker.pid) || marker.pid < 1 || processIsAbsent(marker.pid))
            return false;
        const reply = await new MailboxClient(dir, marker.token, 1000).request('account-report', payload);
        return reply.accepted === true;
    }
    finally {
        await admission.release();
    }
}
