/** Remove terminal controls without changing visible commands or file spelling. */
export function safeText(value) { return value.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ''); }
export function outsideFences(text) {
    let fence;
    const result = [];
    for (const line of safeText(text).split('\n')) {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (marker) {
            if (!fence)
                fence = { char: marker[1][0], size: marker[1].length };
            else if (marker[1][0] === fence.char && marker[1].length >= fence.size && !marker[2].trim())
                fence = undefined;
            continue;
        }
        if (!fence)
            result.push(line);
    }
    return result.join('\n');
}
