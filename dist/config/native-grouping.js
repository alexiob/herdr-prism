export function normalizeNativeGrouping(value) { if (value === undefined)
    return 'none'; if (typeof value !== 'string' || !['project', 'none', 'tab'].includes(value))
    throw Error('ui.nativeGrouping must be project, none or tab'); return value; }
