const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function sanitize(input) { return String(input ?? '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, ''); }
function graphemeWidth(grapheme) {
    if (/^\p{Mark}+$/u.test(grapheme))
        return 0;
    if (/\p{Extended_Pictographic}/u.test(grapheme))
        return 2;
    const code = grapheme.codePointAt(0) ?? 0;
    return code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x20000 && code <= 0x3fffd)) ? 2 : 1;
}
const printableAscii = (value) => /^[\x20-\x7e]*$/.test(value);
export function cellWidth(input) { const value = sanitize(input); if (printableAscii(value))
    return value.length; let width = 0; for (const { segment } of segmenter.segment(value))
    width += graphemeWidth(segment); return width; }
export function truncate(input, width, ascii = false) { const value = sanitize(input).replace(/[\r\n\t]/g, ' '); if (width <= 0)
    return ''; const end = ascii ? '~' : '…'; if (printableAscii(value))
    return value.length <= width ? value : value.slice(0, Math.max(0, width - 1)) + end; if (cellWidth(value) <= width)
    return value; let out = '', used = 0; for (const { segment } of segmenter.segment(value)) {
    const n = graphemeWidth(segment);
    if (used + n > width - 1)
        break;
    out += segment;
    used += n;
} return out + end; }
export function wrap(input, width, maxLines = Infinity) {
    if (maxLines <= 0)
        return [];
    width = Math.max(1, Math.floor(width));
    const output = [];
    for (const raw of sanitize(input).replace(/\r/g, '').split('\n')) {
        const line = raw.replace(/\t/g, '    ');
        if (printableAscii(line)) {
            if (!line.length)
                output.push('');
            else
                for (let start = 0; start < line.length; start += width) {
                    output.push(line.slice(start, start + width));
                    if (output.length >= maxLines)
                        return output;
                }
        }
        else {
            let row = '', used = 0;
            for (const { segment } of segmenter.segment(line)) {
                const size = graphemeWidth(segment);
                if (used + size > width && row) {
                    output.push(row);
                    if (output.length >= maxLines)
                        return output;
                    row = '';
                    used = 0;
                }
                row += segment;
                used += size;
            }
            output.push(row);
        }
        if (output.length >= maxLines)
            return output;
    }
    return output;
}
export function bytes(value) { if (value === undefined)
    return '—'; try {
    const amount = BigInt(value);
    return amount >= 1073741824n ? `${(Number(amount) / 1073741824).toFixed(1)}GiB` : `${(Number(amount) / 1048576).toFixed(0)}MiB`;
}
catch {
    return '—';
} }
export function number(value) { return value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 1 }); }
export function age(timestamp, now = Date.now()) { if (timestamp === undefined)
    return '—'; const seconds = Math.max(0, Math.floor((now - timestamp) / 1000)); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`; }
export function spark(values, width, ascii = false) { if (!values.length)
    return '—'; const chars = ascii ? ' .:-=+*#@' : '▁▂▃▄▅▆▇█'; const slice = values.slice(-Math.max(1, width)); const max = Math.max(1, ...slice.filter((x) => x !== undefined)); return slice.map(v => v === undefined ? ' ' : chars[Math.min(chars.length - 1, Math.floor(Math.max(0, v) / max * (chars.length - 1)))]).join(''); }
