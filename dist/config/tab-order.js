export const defaultTabOrder = ['Overview', 'Notes', 'To-do', 'Git', 'Agents', 'Processes', 'Refs', 'Messages'];
const tabs = defaultTabOrder;
/** A partial order promotes named views; omitted views remain available at the end. */
export function normalizeTabOrder(value) {
    if (value === undefined)
        return [...tabs];
    if (!Array.isArray(value) || !value.length || value.length > tabs.length)
        throw new Error('ui.tabOrder must be a nonempty array of tab names');
    const order = [];
    for (const name of value) {
        const tab = typeof name === 'string' ? tabs.find(tab => tab.toLowerCase() === name.trim().toLowerCase()) : undefined;
        if (!tab)
            throw new Error('Invalid ui.tabOrder tab: ' + String(name));
        if (order.includes(tab))
            throw new Error('Duplicate ui.tabOrder tab: ' + tab);
        order.push(tab);
    }
    return [...order, ...tabs.filter(tab => !order.includes(tab))];
}
