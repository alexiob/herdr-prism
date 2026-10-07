const palettes = {
    dark: { text: '#D7DEE7', secondary: '#9AA8BA', border: '#526074', accent: '#70C9D5', quantity: '#8AC8F5', duration: '#D9BD84', identity: '#C6ABDD', path: '#AAD0CF', positive: '#8DC98A', warning: '#E6BF74', negative: '#E58B88', selection: '#243746', selectionIndexed: [253, 238], selectionBasic: [30, 46], messageBasic: { identity: 96, secondary: 37, accent: 96, positive: 92, warning: 93 }, messageIndexed: { identity: 146, secondary: 250, accent: 116, positive: 114, negative: 217 }, surfaces: {
            tabbar: { foreground: '#9AA8BA', background: '#141C26', indexedForeground: 250, indexedBackground: 233, basicForeground: 37, basicBackground: 40 },
            tab: { foreground: '#D7DEE7', background: '#253344', indexedForeground: 253, indexedBackground: 236, basicForeground: 97, basicBackground: 44 },
            activeTab: { foreground: '#13252F', background: '#70C9D5', indexedForeground: 233, indexedBackground: 116, basicForeground: 30, basicBackground: 46 },
            messageEven: { foreground: '#D7DEE7', background: '#0E141C', indexedForeground: 253, indexedBackground: 232, basicForeground: 97, basicBackground: 40 },
            messageOdd: { foreground: '#D7DEE7', background: '#19222E', indexedForeground: 253, indexedBackground: 234, basicForeground: 97, basicBackground: 44 },
        } },
    light: { text: '#202938', secondary: '#566579', border: '#A8B3C2', accent: '#006879', quantity: '#205A8A', duration: '#795900', identity: '#6F408D', path: '#245F65', positive: '#256A38', warning: '#805800', negative: '#A52D38', selection: '#D9EAF0', selectionIndexed: [235, 153], selectionBasic: [30, 46], messageBasic: { identity: 35, accent: 34 }, messageIndexed: { identity: 90, secondary: 239, accent: 23, positive: 22, negative: 88 }, surfaces: {
            tabbar: { foreground: '#566579', background: '#E4EAF0', indexedForeground: 239, indexedBackground: 255, basicForeground: 30, basicBackground: 47 },
            tab: { foreground: '#202938', background: '#CBD5E1', indexedForeground: 235, indexedBackground: 252, basicForeground: 30, basicBackground: 46 },
            activeTab: { foreground: '#FFFFFF', background: '#006879', indexedForeground: 231, indexedBackground: 23, basicForeground: 97, basicBackground: 44 },
            messageEven: { foreground: '#202938', background: '#FAFBFC', indexedForeground: 235, indexedBackground: 255, basicForeground: 30, basicBackground: 107 },
            messageOdd: { foreground: '#202938', background: '#E9EDF2', indexedForeground: 235, indexedBackground: 253, basicForeground: 30, basicBackground: 47 },
        } },
};
const basic = { text: 39, secondary: 37, border: 90, accent: 36, quantity: 36, duration: 33, identity: 35, path: 34, positive: 32, warning: 33, negative: 31 };
function rgb(hex) { return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)); }
function ansiColor(hex, depth, basicCode, background = false, indexedCode) {
    const color = rgb(hex), prefix = background ? 48 : 38;
    return depth === 24 ? `${prefix};2;${color.join(';')}` : depth === 8 ? `${prefix};5;${indexedCode ?? 16 + 36 * Math.round(color[0] / 51) + 6 * Math.round(color[1] / 51) + Math.round(color[2] / 51)}` : String(basicCode);
}
/** Color never carries meaning without the accompanying text/glyph. */
export function styleSpans(spans, options = {}) {
    const { theme = 'dark', color = true, depth = 24 } = options;
    if (!color || theme === 'mono')
        return spans.map(span => span.text).join('');
    return spans.map(span => {
        const palette = palettes[theme], messageBand = span.surface === 'messageEven' || span.surface === 'messageOdd', surface = span.surface && !(messageBand && span.selected) ? palette.surfaces[span.surface] : undefined;
        const foreground = span.selected && depth !== 24 ? (depth === 8 ? `38;5;${palette.selectionIndexed[0]}` : String(palette.selectionBasic[0])) : ansiColor(messageBand ? palette[span.role] : surface?.foreground ?? palette[span.role], depth, messageBand ? palette.messageBasic[span.role] ?? surface?.basicForeground ?? basic[span.role] : surface?.basicForeground ?? basic[span.role], false, messageBand ? palette.messageIndexed[span.role] ?? surface?.indexedForeground : surface?.indexedForeground);
        const background = span.selected ? (depth === 24 ? `;48;2;${rgb(palette.selection).join(';')}` : depth === 8 ? `;48;5;${palette.selectionIndexed[1]}` : `;${palette.selectionBasic[1]}`) : surface ? ';' + ansiColor(surface.background, depth, surface.basicBackground, true, surface.indexedBackground) : '';
        return `\x1b[${foreground}${background}${span.bold ? ';1' : ''}m${span.text}\x1b[0m`;
    }).join('');
}
