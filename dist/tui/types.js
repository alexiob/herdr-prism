export { defaultTabOrder as tabs } from "../config/tab-order.js";
import { defaultTabOrder as tabs } from "../config/tab-order.js";
export function orderedTabs(state) { return state.tabOrder ?? tabs; }
export function tabLabel(tab, compact) { return compact ? { Processes: 'Procs', Messages: 'Msgs' }[tab] ?? tab : tab; }
