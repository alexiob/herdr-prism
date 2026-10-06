import type { DashboardSession, Forest, SessionEvidence } from './types.ts';

export function sessionKey(provider: string, id: string, host = ''): string { return `${host ? host + ':' : ''}${provider}:${id}`; }
export function buildForest(sessions: SessionEvidence[], nativeOrder?: ReadonlyMap<string,number>): Forest {
  const nodes = new Map<string,DashboardSession>();
  const diagnostics: string[] = [];
  for (const evidence of sessions) {
    const key = sessionKey(evidence.provider, evidence.id);
    const existing = nodes.get(key);
    if (existing && existing.evidence.parentId !== evidence.parentId) {
      existing.parentIssue = 'conflicting'; diagnostics.push(`conflicting parent: ${key}`); continue;
    }
    nodes.set(key, { key, evidence, depth: 0, children: [] });
  }
  for (const node of nodes.values()) {
    const id = node.evidence.parentId;
    if (!id || node.parentIssue) continue;
    const parentKey = sessionKey(node.evidence.parentProvider ?? node.evidence.provider, id);
    if (!nodes.has(parentKey)) { node.parentIssue = 'unresolved'; continue; }
    node.parentKey = parentKey;
  }
  const visited=new Set<string>();
  for(const start of nodes.values()){
    if(visited.has(start.key))continue;
    const chain:string[]=[];const positions=new Map<string,number>();let current:DashboardSession|undefined=start;
    while(current&&!visited.has(current.key)){
      if(positions.has(current.key)){
        const cyclic=chain.slice(positions.get(current.key)!);diagnostics.push(`cycle: ${cyclic.join(' -> ')}`);
        for(const key of cyclic){const node=nodes.get(key)!;node.parentIssue='cycle';node.parentKey=undefined;}break;
      }
      positions.set(current.key,chain.length);chain.push(current.key);current=current.parentKey?nodes.get(current.parentKey):undefined;
    }
    for(const key of chain)visited.add(key);
  }
  for (const node of nodes.values()) if (node.parentKey) nodes.get(node.parentKey)!.children.push(node.key);
  const order: DashboardSession[] = [];
  const stack=[...nodes.values()].filter(node=>!node.parentKey).reverse().map(node=>({node,depth:0}));
  while(stack.length){const{node,depth}=stack.pop()!;node.depth=depth;order.push(node);for(let i=node.children.length-1;i>=0;i--)stack.push({node:nodes.get(node.children[i])!,depth:depth+1});}
  let ordered=order;
  if(nativeOrder?.size){
    // Move whole root subtrees; explicit parentage and sibling discovery stay intact.
    // A transcript-only root follows its earliest attached descendant. Historical
    // trees without live attachments remain in stable discovery order at the end.
    const groups:{nodes:DashboardSession[];rank:number;rootAttached:boolean}[]=[];
    for(const node of order){
      if(node.depth===0)groups.push({nodes:[],rank:nativeOrder.get(node.key)??Number.MAX_SAFE_INTEGER,rootAttached:nativeOrder.has(node.key)});
      const group=groups.at(-1)!;group.nodes.push(node);
      if(!group.rootAttached)group.rank=Math.min(group.rank,nativeOrder.get(node.key)??Number.MAX_SAFE_INTEGER);
    }
    groups.sort((a,b)=>a.rank-b.rank);ordered=groups.flatMap(group=>group.nodes);
  }
  return { nodes, order:ordered, diagnostics };
}
