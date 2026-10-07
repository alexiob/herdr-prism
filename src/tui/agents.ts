import type {DashboardData,UiState,ScreenRow,SessionView} from './types.ts';
import {sanitize} from './text.ts';
import {identityDocument} from './facts.ts';
import {summary} from './widgets.ts';
const match=(text:string,state:UiState)=>!state.filter||sanitize(text).toLocaleLowerCase().includes(state.filter.toLocaleLowerCase());
const pathName=(value?:string)=>value?.replace(/[\\/]+$/,'').split(/[\\/]/).at(-1);
const checkoutBadge=(session:SessionView)=>`${pathName(session.git?.root??session.evidence.cwd)??'checkout unavailable'}@${session.git?.branch??session.git?.branchState??'branch unavailable'}`;
export function agentRows(data:DashboardData,state:UiState,numeric:Map<number,string>,columns:number):ScreenRow[]{
  const rows:ScreenRow[]=[];const nodes=new Map(data.sessions.map(s=>[s.key,s]));let index=0;
  const owner=nodes.get(state.boundSessionKey??state.selectedKey??'');
  if(!owner)return [{id:'agent-owner-unavailable',text:'Panel owner unavailable',selectable:false,help:'The panel owner is no longer in the recorded session snapshot. Select its live native agent or reopen Prism for that agent.'}];
  // parentKey is the recorded relationship; global depth and cached child arrays
  // can describe a different root or lag behind the current snapshot.
  const children=new Map<string,SessionView[]>();
  for(const session of nodes.values())if(session.parentKey&&session.key!==owner.key){const siblings=children.get(session.parentKey)??[];siblings.push(session);children.set(session.parentKey,siblings);}
  const lineage:{session:SessionView;depth:number;hidden:boolean}[]=[],seen=new Set<string>();
  const pending=[{session:owner,depth:0,hidden:false}];
  while(pending.length){const item=pending.pop()!;if(seen.has(item.session.key))continue;seen.add(item.session.key);lineage.push(item);for(const child of [...children.get(item.session.key)??[]].reverse())pending.push({session:child,depth:item.depth+1,hidden:item.hidden||state.collapsed.has(item.session.key)});}
  let sessions=lineage.filter(({session,hidden})=>!hidden&&(session===owner||match(`${session.evidence.provider} ${session.evidence.title??session.evidence.id} ${session.evidence.state??'unknown'} ${session.evidence.task??''} ${session.evidence.goals.at(-1)?.objective??''}`,state)));
  if(state.view==='worktrees'){
    // Keep the owner's checkout first, with each remaining checkout contiguous.
    const groups=new Map<string,typeof sessions>();
    for(const item of sessions){const session=item.session,key=JSON.stringify([session.git?.familyKey,session.git?.checkoutKey??session.git?.root??session.evidence.cwd]);const group=groups.get(key)??[];group.push(item);groups.set(key,group);}
    sessions=[...groups.values()].flat();
  }
  let familyGroup='';let checkoutGroup='';
  for(const {session,depth:relativeDepth} of sessions){
    if(state.view==='worktrees'){const family=session.git?.familyKey;const familyKey=family??'unknown-family';if(familyKey!==familyGroup){rows.push({id:`family:${familyKey}`,text:family?`Repository ${family}`:'Repository family unavailable',selectable:false});familyGroup=familyKey;checkoutGroup='';}const checkout=session.git?.checkoutKey??session.git?.root??session.evidence.cwd??'unknown-checkout';if(checkout!==checkoutGroup){rows.push({id:`checkout:${checkout}`,text:`  Checkout ${session.git?.root??session.evidence.cwd??'unavailable'} · ${session.git?.branch??session.git?.branchState??'branch unavailable'}`,selectable:false});checkoutGroup=checkout;}}
    const value=++index;numeric.set(value,session.key);
    const hasChildren=!!children.get(session.key)?.length;
    const glyph=hasChildren?(state.collapsed.has(session.key)?(state.ascii?'+':'▸'):(state.ascii?'-':'▾')):'·';
    const depth=state.view==='lineage'?Math.min(relativeDepth,5):1;
    const live=session.attachment?'': ' · no pane';
    rows.push({id:session.key,text:`${' '.repeat(depth*2)}${glyph} A${value} ${relativeDepth>5&&state.view==='lineage'?`d${relativeDepth} `:''}${summary(session.evidence.title??session.evidence.id,Math.max(1,columns-6-depth*2-8-(session.evidence.state??'unknown').length))} · ${session.evidence.state??'unknown'}${columns>=80&&state.view==='lineage'?` · ${checkoutBadge(session)}`:''}${live}`,help:'This tree contains the panel owner and its recorded sub-agents. Enter inspects an agent; its worker banner offers Parent and Owning agent. Esc or Backspace returns to its parent outside details/help; Shift+F returns to the owner. f focuses its live pane; Space folds recorded children. Numbers + Enter select a displayed Prism target. d opens its complete identity.',document:identityDocument(session,data,Date.now()),action:{type:'select',sessionKey:session.key},disclosureColumn:hasChildren?depth*2+1:undefined});
    const task=session.evidence.goals.at(-1)?.objective??session.evidence.task;
    if(task)rows.at(-1)!.continuations=[{text:`${' '.repeat(depth*2+2)}${session.evidence.goals.at(-1)?.objective?'Goal':'Task'}: ${summary(task,Math.max(1,columns-depth*2-10))}`,role:'secondary'}];
    if(state.expanded.has(session.key)){
      rows.at(-1)!.continuations=[...(rows.at(-1)!.continuations??[]),{text:`  ${session.evidence.provider} · ${session.evidence.id}`,role:'secondary'},{text:`  ${session.git?.branch??session.evidence.cwd??'Checkout unavailable'} · ${session.evidence.messages.length} retained messages`,role:'secondary'}];
    }
  }
  if(lineage.length===1)rows.push({id:'agents-empty-descendants',text:'No recorded sub-agents',selectable:false,help:'This snapshot has no recorded child relationships for the panel owner. Other live host sessions are outside this tree. The owner remains available above for inspection and pane focus.'});
  return rows;
}
