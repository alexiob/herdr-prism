import {cellWidth,sanitize,truncate,wrap} from './text.ts';
import {styleSpans} from './theme.ts';
import type {ColorRole,TextSpan,ThemeName} from './theme.ts';

export const inspectorPreviewTabs=['Overview','Agents','Processes','Messages','Refs','To-do','Git','Notes'] as const;
export const previewViews=[...inspectorPreviewTabs,'Notes editor','Sidebar','Help','Detail'] as const;
export type PreviewView=typeof previewViews[number];
export interface PreviewEntry {
  id:string;label:string;value?:string;help:string;detail?:string;target?:PreviewView;role?:ColorRole;display?:string;
}
interface DetailField {label:string;value:string;role?:ColorRole;}
interface Section {title:string;entries:PreviewEntry[];description?:string[];descriptionRole?:ColorRole;fields?:DetailField[];column?:0|1;}
export interface PreviewOptions {width?:number;height?:number;selected?:number;scroll?:number;ascii?:boolean;theme?:ThemeName;entry?:PreviewEntry;}
export interface PreviewFrame {
  view:PreviewView;lines:string[];spans:TextSpan[][];entries:(PreviewEntry&{display:string})[];
  selectedLine?:number;bodyStart:number;bodyHeight:number;columns:1|2;scroll:number;footer:string;theme:ThemeName;
  positions:{entry:number;line:number;column:number;width:number}[];
}
const goal='Build reliable monitoring for local and remote harness sessions, with readable telemetry and safe installation.';
const note='# Session notes\n\n## Decisions\n- Run Prism on each remote server.\n- Keep visibility API work upstream.\n\n## Follow-up\nVerify the saved draft after reconnecting.';
const fact=(id:string,label:string,value:string,detail:string,help:string,role?:ColorRole):PreviewEntry=>({id,label,value,detail,help,role});
const link=(id:string,label:string,value:string,target:PreviewView,help:string,role?:ColorRole):PreviewEntry=>({id,label,value,target,help,role});
const usageDetail='Recorded usage\n\nInput: 42,180 tokens\nOutput: 6,210 tokens\nCache read: 30,000 tokens (subset of input)\nCache write: unavailable\nReasoning: unavailable\n\nCurrent context: 18,500 / 128,000 (14.5%)\nLast recorded turn: 4,230 tokens\nGeneration rate: unavailable\nCost: unavailable\n\nCoverage: retained provider counters.\nMissing values are unavailable, not zero.';
const gitDetail='Checkout\n\nBranch: feature/remote-monitor\nRepository: /work/herdr-prism\nCheckout: /work/trees/remote-monitor\nAdded lines: 128\nDeleted lines: 37\nUntracked files: 2\nConflicts: 0\nAhead: 3\nBehind: 0\nGit snapshot age: 2 seconds\n\nGit values belong to this exact checkout.';
const sections:Record<Exclude<PreviewView,'Help'|'Detail'>,Section[]>={
  Overview:[
    {title:'Work',entries:[
      fact('goal','Goal',goal,`Goal\n\n${goal}\n\nStatus: active\nSource: explicit goal record`,'An explicitly reported goal. Enter opens the full objective and its recorded source. Initial requests are kept separate.'),
      fact('task','Task','Review remote visibility', 'Delegated task\n\nReview remote visibility boundaries and document the upstream Herdr API dependency.','A delegated task is distinct from a goal. Enter opens its complete text.'),
      fact('turn','Timing','8m session · 23s turn','Session age: 8 minutes\nCurrent turn elapsed: 23 seconds\nHarness uptime: 8 minutes 12 seconds\nGeneration time: unavailable','Current-turn elapsed needs a sourced turn boundary. Harness uptime needs a verified harness process. Enter opens all recorded timings.'),
    ]},
    {title:'Resources',entries:[
      fact('cpu','CPU','124%  ▁▂▄▆▅█','CPU\n\nAggregate: 124%\n100% = one logical core.\nScope: self + verified owned jobs.\nHistory: sampled peaks; blank columns are gaps.\nThis aggregate may exceed 100%.','Sampled CPU of the selected scope. 100% means one core; history gaps are not interpolated. Enter opens readings and coverage.'),
      fact('memory','RSS sum','620 MiB  ▂▂▃▄▆█','Memory\n\nRSS sum: 620 MiB\nObserved peak: 710 MiB\nShared resident pages can be counted by more than one process.\nWindows reports working-set sum.','Resident-memory sum, not host memory percent. Shared pages can appear in several processes. Peak is the highest observed aggregate sample. Windows uses working-set sum. Enter opens the measurements and scope.'),
      link('processes','Processes','4/4 readable','Processes','Enter opens owned processes. The denominator includes verified unavailable processes; unreadable values are not measured zero.'),
    ]},
    {title:'Usage',entries:[
      fact('context','Context','14.5%  ▰▱▱▱▱▱▱▱',usageDetail,'Current-context occupancy is separate from lifetime consumption. A percent requires a measured numerator and compatible capacity. Enter opens exact counters.'),
      fact('tokens','Tokens','42.2k in · 6.2k out',usageDetail,'Recorded provider counters with retained coverage. Enter opens exact token, cache, reasoning, rate and cost facts.'),
    ]},
    {title:'Checkout',entries:[link('git','Git','+128 -37 · 0 conflicts','Git','Enter opens the exact checkout, branch and colored Git statistics. Untracked files are distinct from line additions.')]},
    {title:'Activity',entries:[
      link('agents','Agents','3 descendants','Agents','Enter opens the nested agent list. These are Prism targets; native Herdr focus indices are not claimed.'),
      link('messages','Messages','U12 A18 · 2 tools','Messages','Enter opens retained messages. Historical messages can be loaded explicitly; this summary is not a lifetime total.'),
      link('refs','Refs','8 targets · partial','Refs','Enter opens reference targets and their exact source messages. Partial coverage remains labeled.'),
      link('todo','To-do','2 pending · 1 checked','To-do','Enter opens reported requests and local checkmarks. A local checkmark does not change the agent transcript.'),
      link('notes','Notes','Saved 14:32','Notes','Enter opens private Markdown notes for this agent on the collecting server.'),
    ]},
  ],
  Agents:[{title:'Agent tree',description:['Prism target · state · checkout'],entries:[
    link('agent-root','▾ A1 Monitor','working · remote-monitor','Overview','Enter inspects this agent within Prism. f focuses its live Herdr pane. Space folds children; number + Enter selects the displayed Prism target.'),
    link('agent-parser','  ▾ A2 Parser','working · parser','Overview','Enter inspects Parser. f explicitly moves native focus when its pane exists. Space folds its nested children.'),
    link('agent-source','    A3 Source','waiting · parser','Overview','Enter inspects the nested source worker. Waiting is the reported state; no CPU work is requested for a background agent.'),
    link('agent-test','  A4 Linux tests','done · main','Overview','Enter inspects the test worker. Transcript-only sessions have no live pane to focus.'),
  ]},{title:'Selected agent',entries:[
    fact('agent-task','Task','Implement exact source cursors','Parser worker\n\nTask: Implement exact source cursors for paged reference history.\nParent: Monitor\nDepth: 1\nProvider: codex\nState: working\nCheckout: /work/trees/parser','The selected row determines which agent is inspected on Enter. This summary holds its task; full ancestry and identity remain in details.'),
    fact('agent-cached','Load','cached · 8s old','Last observed selected-scope load:\nCPU: 18%\nRSS sum: 92 MiB\nSample: 8 seconds ago\n\nBackground agents are not resampled by this view.','Cached readings are explicitly labeled. Merely browsing the tree does not trigger heavy collection for every agent.','warning'),
  ]}],
  Processes:[{title:'Owned processes',description:['PID      Name        CPU     RSS', '4/4 readable · self + jobs'],entries:[
    fact('p1','4102 prism','68%    184M','Process: prism-harness\nPID: 4102\nPPID: 4000\nCPU: 68%\nRSS: 184 MiB\nThreads: 12\nOwner: Monitor\nBirth identity: verified\n\nRead-only inspection; no kill action.','Enter opens the full process name, identity, owner, threads and measurements. Space folds process children.'),
    fact('p2','  4108 node','31%    162M','Process: node-worker\nPID: 4108\nPPID: 4102\nCPU: 31%\nRSS: 162 MiB\nOwner: Monitor','Child of the verified harness process. Enter opens full identity and measurement availability.'),
    fact('p3','  4110 test','25%    274M','Process: test-worker\nPID: 4110\nPPID: 4102\nCPU: 25%\nRSS: 274 MiB','Enter opens complete process facts. CPU is normalized to one logical core, not the entire machine.'),
    fact('p4','  4112 git',' 0%      0M','Process: git\nPID: 4112\nCPU: measured zero\nRSS: measured zero','Zero is a measured value. Enter opens source and sample availability.'),
  ]},{title:'Scope',entries:[fact('process-scope','Coverage','CPU 4/4 · memory 4/4','Scope: selected agent + owned jobs\nCPU: 4/4 readable\nMemory: 4/4 readable\nAggregate CPU: 124%\nAggregate RSS: 620 MiB\n\nIf any required process is unavailable, the aggregate CPU is unavailable.','Partial process samples do not establish a complete aggregate. Press u to choose subtree scope; Enter opens ownership and coverage.')]}],
  Messages:[{title:'Retained transcript',description:['Scrollback · 2 new · End follows'],entries:[
    fact('message-user','User · 3m ago','Review remote session support','User\n\nReview remote session support, preserving per-server installation and showing cached metrics honestly.','Enter opens the entire message. s opens its source when available, y copies the full text, and b loads older history.'),
    fact('message-assistant','Assistant · 2m','Collector runs on each server','Assistant\n\nThe collector runs on each remote Herdr server. The local client views its data. Background-machine visibility and the last viewer disconnect require an upstream host API.','Enter opens full text and recorded tools. Counts cover retained messages; new messages do not move a scrollback reader.'),
    fact('message-tool','Tool · 90s ago','exec_command · tests passed','Tool result\n\nexec_command\nTargeted tests passed: 51\nFailures: 0\n\nThe exact source record remains available.','Enter opens full tool summary and result. A tool result is distinct from an assistant message.','positive'),
    fact('message-agent','Agent · 1m ago','Parser → Monitor: ready','Inter-agent message\n\nAuthor: Parser\nRecipient: Monitor\nExact source cursors are ready for review.','Messages between agents retain author and recipient. Their text does not establish a request to the user.'),
  ]}],
  Refs:[{title:'Reference targets',description:['8 targets · partial source history'],entries:[
    fact('ref-session','✎ session.ts','src/providers','Target\n\n/work/herdr-prism/src/providers/session.ts:184\nEdited: yes\nSources: 3 mentions\n\nEnter on the live target opens the file. Space opens mention history.','Enter opens this reference target; Space opens its mentions, s the exact source message, and y copies the full target path.'),
    fact('ref-doc','visibility-api.md','docs','Target\n\n/work/herdr-prism/docs/remote-visibility-api.md\nEdited: no\nSource message: assistant-18','Long paths show a meaningful filename and location. Full paths remain available in details and copy. Enter opens the target.'),
    fact('ref-missing','? old-sampler.ts','src/process','Missing target\n\n/work/herdr-prism/src/process/old-sampler.ts\nTarget is no longer present.\nThe recorded reference and its source remain available.','The ? prefix means the file was not found; it is independent of the ? help key. Enter reports the missing target, Space opens mention sources.','warning'),
    link('older-refs','Older targets','Load another page','Refs','Enter or b loads older reference targets. Exact file/offset/hash cursors preserve historical source routing.'),
  ]}],
  'To-do':[{title:'Reported requests',description:['2 pending · list reported 12s ago'],entries:[
    fact('todo-review','[ ] Review plan','first seen 3m ago','Reported request\n\nReview the complete remote-session plan and verify the API dependency boundary before claiming visibility guarantees.\n\nFirst source: assistant-12\nLatest repeated source: assistant-18\nLocally checked: no','Enter opens the full request. s opens its source; x checks locally; y copies one inline command or the complete request.'),
    fact('todo-tests','[ ] Run Linux tests','repeated · 1m ago','Reported request\n\nRun `npm test` in the Linux fixture after rebasing.\n\nRepeated request: yes\nLocally checked: no','Enter opens the complete request. Repeated mentions share one local check state; they are not multiple independent tasks.'),
    fact('todo-done','[x] Install shortcut','locally checked','Reported request\n\nVerify Ctrl+B then i opens Prism in the live Herdr session.\n\nLocally checked: yes\nThe agent transcript was not edited.','Enter opens request facts. x reopens this local checkmark. Local completion does not claim the harness has completed a task.','positive'),
  ]}],
  Git:[{title:'Checkout',entries:[
    fact('git-branch','Branch','feature/remote-monitor',gitDetail,'Enter opens the full checkout identity. Same branch names on different worktrees are not merged.'),
    fact('git-diff','Lines','+128  -37',gitDetail,'Added/deleted line statistics from the exact checkout. Enter opens all Git fields.'),
    fact('git-untracked','Untracked','2 files',gitDetail,'Untracked file counts are independent of line additions. Enter opens the recorded Git snapshot.'),
    fact('git-conflicts','Conflicts','0',gitDetail,'Zero conflicts is a measured value. An unavailable Git snapshot is shown as unavailable, not zero.','positive'),
    fact('git-tracking','Upstream','↑3 ahead · ↓0 behind',gitDetail,'Ahead/behind is reported only for a compatible upstream. Enter opens the complete snapshot.'),
    fact('git-root','Worktree','remote-monitor',gitDetail,'Full repository family, checkout path, branch state and snapshot age are available on Enter.'),
  ]},{title:'Snapshot',entries:[fact('git-fresh','Age','2s · measured',gitDetail,'This is a cached Git snapshot, not an ongoing promise of a clean checkout. Heavy Git updates run only for the open selected session.')]}],
  Notes:[{title:'Private Markdown',description:['Saved 14:32 · this agent · local server'],entries:[
    {...link('notes-document','Edit notes','Session decisions and follow-up','Notes editor','Enter edits Markdown. Autosave after 500 ms; Ctrl+S flushes; Escape returns to reading. While editing, printable navigation keys insert text and follow is held.'),detail:note},
  ],},{title:'Document',description:note.split('\n'),entries:[]}],
  'Notes editor':[{title:'Markdown editor',description:['Editing · follow held · autosave 500ms','Draft belongs to Monitor on local/main','',...note.split('\n'),'','Cursor: line 9, column 1'],entries:[]}],
  Sidebar:[{title:'Native Agents · compact preset',description:['● codex Monitor','  Goal: Reliable session monitoring','  CPU 124% · RSS 620M · 3 agents','  local/project remote-monitor +128 -37'],entries:[]},
    {title:'Next agent · background',description:['● codex Parser','  Task: Exact source cursors','  CPU — · RSS — · cached','  local/project parser'],entries:[]}],
};

const span=(text:string,role:ColorRole='text',selected=false):TextSpan=>({text,role,selected});
const pad=(text:string,width:number)=>text+' '.repeat(Math.max(0,width-cellWidth(text)));
function asciiText(text:string):string{return text.replace(/[┌┐└┘├┤]/g,'+').replace(/[─▱]/g,'-').replace(/│/g,'|').replace(/→/g,'>').replace(/←/g,'<').replace(/▾/g,'v').replace(/▸/g,'>').replace(/●/g,'*').replace(/·/g,'.').replace(/✎/g,'*').replace(/↑/g,'^').replace(/↓/g,'v').replace(/—/g,'-').replace(/[▁▂▃▄▅▆▇█▰]/g,'#');}
/** Summaries stop at whole words; exact original text stays in the detail. */
function summarize(value:string,width:number):string{
  const text=sanitize(value).replace(/[\r\n\t]/g,' ').trim();if(cellWidth(text)<=width)return text;
  let out='';for(const word of text.split(' ')){const next=out?out+' '+word:word;if(cellWidth(next)>width)break;out=next;}
  return out||truncate(text,width);
}
function compactEntry(entry:PreviewEntry,width:number):string{
  const arrow=entry.target||entry.detail?' →':'';
  const label=entry.label,value=entry.value??'';
  // Reserve the action indicator before fitting either part of the summary.
  const room=Math.max(1,width-cellWidth(arrow));
  if(/^p\d+$/.test(entry.id)){
    const [cpu='',memory='']=value.trim().split(/\s+/);
    const nameWidth=Math.min(20,Math.max(1,room-12));
    return pad(summarize(label,nameWidth),nameWidth)+pad(cpu.padStart(4)+' '+memory.padStart(6),room-nameWidth)+arrow;
  }
  const prefix=cellWidth(label)<11?pad(label,11):label+' · ';
  const text=!value?summarize(label,room):cellWidth(prefix)<room?prefix+summarize(value,room-cellWidth(prefix)):summarize(label,room);
  return pad(text,room)+arrow;
}
function readableWrap(value:string,width:number):string[]{
  const lines:string[]=[];
  for(const raw of sanitize(value).replace(/\r/g,'').split('\n')){
    let rest=raw;if(!rest){lines.push('');continue;}
    while(cellWidth(rest)>width){
      const fit=wrap(rest,width,1)[0]!;const boundary=fit.lastIndexOf(' ');
      const separator=Math.max(fit.lastIndexOf('/'),fit.lastIndexOf('\\'));
      const cut=boundary>0?boundary:separator>0?separator+1:fit.length;
      lines.push(rest.slice(0,cut).trimEnd());rest=rest.slice(cut).replace(/^ +/,'');
    }
    lines.push(rest);
  }
  return lines;
}
/** Detail presentation uses the fixture's facts, keeping metric explanations in help. */
function structuredDetail(entry:PreviewEntry):Section[]|undefined{
  const text=entry.detail??'';
  const values=new Map<string,string>();
  for(const line of text.split('\n')){const field=/^([A-Za-z][A-Za-z -]*):\s+(.+)$/.exec(line);if(field)values.set(field[1]!,field[2]!);}
  const section=(title:string,fields:DetailField[],column:0|1=0):Section=>({title,entries:[],fields,column});
  const known=(keys:[string,string,ColorRole?][]):DetailField[]=>keys.flatMap(([key,label,role])=>values.has(key)?[{label,value:values.get(key)!,role}]:[]);
  if(entry.id==='memory')return[
    section('Memory',[
      ...known([['RSS sum','Current','quantity'],['Observed peak','Peak','quantity']]),
      {label:'History',value:'▂▂▃▄▆█',role:'quantity'},
    ]),
    section('Sample scope',[{label:'Metric',value:'RSS sum',role:'identity'},{label:'Includes',value:'Selected agent + owned jobs'}],1),
  ];
  if(entry.id==='cpu')return[
    section('CPU',known([['Aggregate','Current','quantity']])),
    section('Sample scope',known([['Scope','Includes']]),1),
    section('History',[{label:'Samples',value:'▁▂▄▆▅█',role:'quantity'}]),
  ];
  if(entry.id==='context'||entry.id==='tokens'){
    const context=/^([\d,]+) \/ ([\d,]+) \(([\d.]+)%\)$/.exec(values.get('Current context')??'');
    const cache=values.get('Cache read')?.replace(/\s+\(.+\)$/,'');
    return[
      section('Recorded tokens',[
        ...known([['Input','Input','quantity'],['Output','Output','quantity']]),
        ...(cache?[{label:'Cache read',value:cache,role:'quantity' as const}]:[]),
        ...known([['Cache write','Cache write','quantity'],['Reasoning','Reasoning','quantity']]),
        ...(values.get('Cache read')?.includes('subset')?[{label:'Cache mode',value:'Subset of input',role:'identity' as const}]:[]),
      ]),
      section('Context',context?[
        {label:'Used',value:context[1]+' tokens',role:'quantity'},
        {label:'Capacity',value:context[2]+' tokens',role:'quantity'},
        {label:'Occupancy',value:context[3]+'%',role:'quantity'},
        {label:'Meter',value:'▰▱▱▱▱▱▱▱',role:'quantity'},
      ]:[],1),
      section('Turn',known([['Last recorded turn','Last turn','quantity']]),1),
      section('Rates and cost',known([['Generation rate','Generation','quantity'],['Cost','Cost','quantity']]),1),
      section('Provenance',known([['Coverage','Coverage']])),
    ].filter(item=>item.fields!.length);
  }
  if(entry.id.startsWith('git-'))return[
    section('Checkout identity',known([['Branch','Branch','identity'],['Repository','Repository','path'],['Checkout','Worktree','path']])),
    section('Changes',known([['Added lines','Added','positive'],['Deleted lines','Deleted','negative'],['Untracked files','Untracked','quantity'],['Conflicts','Conflicts']]).map(field=>({...field,value:field.label==='Added'?`+${field.value} lines`:field.label==='Deleted'?`-${field.value} lines`:field.label==='Untracked'?field.value+' files':field.value,role:field.label==='Conflicts'?(field.value==='0'?'positive':'negative'):field.role})),1),
    section('Tracking',known([['Ahead','Ahead','quantity'],['Behind','Behind','quantity']]).map(field=>({...field,value:field.value+' commits'})),1),
    section('Snapshot',known([['Git snapshot age','Age','duration']])),
  ];
  if(entry.id==='turn')return[
    section('Session',known([['Session age','Age','duration'],['Harness uptime','Uptime','duration']])),
    section('Turn',known([['Current turn elapsed','Elapsed','duration'],['Generation time','Generation','duration']]),1),
  ];
  if(entry.id==='agent-cached')return[
    section('Cached resources',known([['CPU','CPU','quantity'],['RSS sum','RSS','quantity']])),
    section('Observation',known([['Sample','Age','duration']]),1),
  ];
  if(/^p\d+$/.test(entry.id))return[
    section('Identity',known([['Process','Name','identity'],['PID','PID','identity'],['PPID','PPID','identity'],['Birth identity','Birth']])),
    section('Resources',known([['CPU','CPU','quantity'],['RSS','RSS','quantity'],['Threads','Threads','quantity'],['Availability','Status','warning']]),1),
    section('Ownership',known([['Owner','Agent','identity']])),
  ].filter(item=>item.fields!.length);
  if(entry.id==='process-scope')return[
    section('Selected scope',known([['Scope','Includes','identity']])),
    section('Readable samples',known([['CPU','CPU','positive'],['Memory','Memory','positive']]),1),
    section('Aggregate readings',known([['Aggregate CPU','CPU','quantity'],['Aggregate RSS','RSS','quantity']]),1),
  ];
  if(entry.id.startsWith('ref-')){
    const target=text.split('\n').find(line=>/^(?:\/|[A-Za-z]:[\\/])/.test(line));
    if(!target)return;
    const match=/^(.*?)(?::(\d+))?$/.exec(target)!;const fullPath=match[1]!,name=fullPath.split(/[\\/]/).at(-1)!;
    const missing=entry.id==='ref-missing';
    return[
      section('Reference target',[
        {label:'Name',value:name,role:'identity'},
        {label:'Path',value:fullPath,role:'path'},
        ...(match[2]?[{label:'Line',value:match[2],role:'quantity' as const}]:[]),
      ]),
      section('Recorded facts',[
        {label:'State',value:missing?'Missing target':'Recorded target',role:missing?'warning':'text'},
        ...known([['Edited','Edited'],['Sources','Sources','accent'],['Source message','Message','accent']]),
      ],1),
    ];
  }
  if(values.size){
    const fields=[...values].map(([label,value]):DetailField=>({label,value,role:/^(?:status|state|locally checked)$/i.test(label)?/^(?:active|working|done|yes)$/i.test(value)?'positive':/^(?:waiting|blocked|unknown)$/i.test(value)?'warning':'text':/source|author|recipient|parent|provider/i.test(label)?'identity':/checkout|repository|path/i.test(label)?'path':/^\d/.test(value)?'quantity':undefined}));
    const narrative=text.split('\n').filter(line=>!/^([A-Za-z][A-Za-z -]*):\s+(.+)$/.test(line));
    return [{title:entry.label,entries:[],description:narrative,descriptionRole:'text'},section('Recorded facts',fields,1)];
  }
}
function semanticText(text:string,role:ColorRole='text',selected=false):TextSpan[]{
  return text.split(/([+]\d+|-\d+)/g).filter(Boolean).map(part=>span(part,/^\+\d+$/.test(part)?'positive':/^-\d+$/.test(part)?'negative':role,selected));
}
function fieldSpans(text:string,role:ColorRole='text'):TextSpan[]{
  if(/^(?:unavailable|—)/i.test(text.trim()))return [span(text,'warning')];
  return text.split(/(\b(?:tokens|MiB|GiB|KiB|lines|files|commits|seconds|minutes)\b)/g).filter(Boolean).map(part=>span(part,/^(?:tokens|MiB|GiB|KiB|lines|files|commits|seconds|minutes)$/.test(part)?'secondary':role));
}

export function renderPreview(view:PreviewView,options:PreviewOptions={}):PreviewFrame{
  const width=Math.max(26,Math.floor(options.width??50)),height=Math.max(10,Math.floor(options.height??34));
  const theme=options.theme??'dark';let two=view==='Overview'&&width>=80;
  const allEntries:(PreviewEntry&{display:string})[]=[];
  const positions:PreviewFrame['positions']=[];
  type BodyLine={parts:TextSpan[];entries:{index:number;column:number;width:number}[]};
  const sectionLines=(items:Section[],innerWidth:number):BodyLine[]=>{
    const result:BodyLine[]=[];
    for(const section of items){
      const heading=`┌ ${section.title} `;result.push({parts:[span(heading,'accent'),span('─'.repeat(Math.max(0,innerWidth-cellWidth(heading)-1))+'┐','border')],entries:[]});
      for(const field of section.fields??[]){
        const labelWidth=12,valueWidth=innerWidth-4-labelWidth;
        if(cellWidth(field.label)>labelWidth)for(const label of readableWrap(field.label,innerWidth-4))result.push({parts:[span('│ ','border'),span(pad(label,innerWidth-4),'secondary'),span(' │','border')],entries:[]});
        for(const [index,line]of readableWrap(field.value,valueWidth).entries())result.push({parts:[
          span('│ ','border'),span(pad(index||cellWidth(field.label)>labelWidth?'':field.label,labelWidth),'secondary'),
          ...fieldSpans(pad(line,valueWidth),field.role),span(' │','border'),
        ],entries:[]});
      }
      for(const text of section.description??[])for(const line of readableWrap(text,innerWidth-4))result.push({parts:[span('│ ','border'),...semanticText(pad(line,innerWidth-4),section.descriptionRole??'secondary'),span(' │','border')],entries:[]});
      for(const entry of section.entries){
        const index=allEntries.length,display=compactEntry(entry,innerWidth-4);allEntries.push({...entry,display});
        result.push({parts:[span('│','border'),...semanticText(' '+display+' ',entry.role??'text',index===(options.selected??0)),span('│','border')],entries:[{index,column:2,width:innerWidth-2}]});
      }
      result.push({parts:[span('└'+'─'.repeat(innerWidth-2)+'┘','border')],entries:[]});
    }
    return result;
  };
  const columns=(leftItems:Section[],rightItems:Section[]):BodyLine[]=>{
    const colWidth=Math.floor((width-2)/2),left=sectionLines(leftItems,colWidth),right=sectionLines(rightItems,width-colWidth-2);
    return Array.from({length:Math.max(left.length,right.length)},(_,i)=>{
      const l=left[i],r=right[i];return {parts:[...(l?.parts??[span(' '.repeat(colWidth))]),span('  '),...(r?.parts??[span(' '.repeat(width-colWidth-2))])],entries:[...l?.entries??[],...(r?.entries??[]).map(e=>({...e,column:e.column+colWidth+2}))]};
    });
  };
  let body:BodyLine[];
  if(view==='Help'||view==='Detail'){
    const entry=options.entry??sections.Overview[0]!.entries[0]!;
    const title=view==='Help'?`Help · ${entry.label}`:`Detail · ${entry.label}`;
    const text=view==='Help'?`${entry.help}\n\nEnter opens ${entry.target??'full content'}.\n? shows this entry's help.\nEscape returns to your previous selection.`:entry.detail??`${entry.label}\n\n${entry.value??''}\n\nDestination: ${entry.target??'none'}`;
    const detail=view==='Detail'?structuredDetail(entry):undefined;
    two=width>=80&&Boolean(detail?.some(section=>section.column===1));
    body=two?columns(detail!.filter(section=>section.column!==1),detail!.filter(section=>section.column===1)):sectionLines(detail??[{title,description:text.split('\n'),descriptionRole:'text',entries:[]}],width);
  }else if(two){
    const items=sections.Overview;body=columns([items[1]!,items[2]!],[items[0]!,items[3]!,items[4]!]);
  }else body=sectionLines(sections[view],width);
  const detailId=options.entry?.id??'';
  const detailContext=detailId.startsWith('ref-')?'Refs':detailId==='process-scope'||/^p\d+$/.test(detailId)?'Processes':detailId.startsWith('git-')?'Git':detailId.startsWith('agent-')?'Agents':detailId.startsWith('message-')?'Messages':detailId.startsWith('todo-')?'To-do':'Overview';
  const detailTitles:Record<string,string>={memory:'Memory',cpu:'CPU',context:'Recorded usage',tokens:'Recorded usage',turn:'Timing','process-scope':'Scope coverage','agent-cached':'Cached resources'};
  const detailTitle=detailTitles[detailId]??(detailContext==='Processes'?'Process details':detailContext==='Refs'?'Reference details':detailContext==='Git'?'Git checkout':options.entry?.label??'Detail');
  const active=view==='Notes editor'?'Notes':view==='Detail'||view==='Help'?detailContext:inspectorPreviewTabs.includes(view as any)?view:'Overview';
  const tabNames=width<50?['Overview','Agents','Procs','Msgs','Refs','To-do','Git','Notes']:inspectorPreviewTabs;
  const tabParts=tabNames.map((name,i)=>({name,active:inspectorPreviewTabs[i]===active}));
  const tabLines:TextSpan[][]=[];let tabLine:TextSpan[]=[],used=0;
  for(const item of tabParts){const label=(item.active?'['+item.name+']':item.name)+' ';if(used+cellWidth(label)>width&&tabLine.length){tabLines.push(tabLine);tabLine=[];used=0;}tabLine.push(span(label,item.active?'accent':'secondary'));used+=cellWidth(label);}
  if(tabLine.length)tabLines.push(tabLine);
  const chrome:TextSpan[][]=[
    [span(truncate(`PRISM · DESIGN · ${view==='Detail'?detailTitle:view}`,width),'accent')],
    [span(width<50?'Monitor · codex · working':'Monitor · codex / demo-model · working','text')],
    [span(truncate('local/main · Self + jobs · Follow',width),'secondary')],...tabLines,
  ];
  const bodyStart=chrome.length,bodyHeight=Math.max(1,height-bodyStart-2);
  const selected=Math.max(0,Math.min(options.selected??0,allEntries.length-1));
  const selectedBodyLine=body.findIndex(line=>line.entries.some(e=>e.index===selected));
  let scroll=Math.max(0,Math.min(options.scroll??0,Math.max(0,body.length-bodyHeight)));
  if(selectedBodyLine>=0&&(selectedBodyLine<scroll||selectedBodyLine>=scroll+bodyHeight))scroll=Math.max(0,selectedBodyLine-bodyHeight+1);
  const spans=[...chrome];
  for(let i=scroll;i<Math.min(body.length,scroll+bodyHeight);i++){
    const line=body[i]!;
    for(const position of line.entries)positions.push({entry:position.index,line:bodyStart+i-scroll,column:position.column,width:position.width});
    // A visible marker also communicates selection in monochrome terminals.
    const parts=line.parts.map(p=>({...p}));
    for(const position of line.entries)if(position.index===selected){const part=parts.find(p=>p.selected);if(part)part.text='›'+part.text.slice(1);}
    spans.push(parts);
  }
  while(spans.length<height-2)spans.push([span('')]);
  const footer=view==='Help'||view==='Detail'?'↑↓ scroll · Esc back · ? help':view==='Agents'?'Enter inspect · f focus · ? help':view==='Notes editor'?'Ctrl+S save · Esc read · text inserts':view==='Sidebar'?'Ctrl+B i opens Prism · ? help in Prism':view==='Notes'?'Enter edit · Ctrl+S save · ? help':'Enter open · Tab views · ? help';
  spans.push([span(truncate(`DESIGN ONLY · synthetic data${body.length>bodyHeight?` · ${scroll+1}/${body.length}`:''}`,width),'warning')],[span(truncate(footer,width),'secondary')]);
  if(options.ascii)for(const line of spans)for(const part of line)part.text=asciiText(part.text).replace(/›/g,'>');
  return {view,lines:spans.map(parts=>parts.map(p=>p.text).join('').trimEnd()),spans,entries:allEntries,selectedLine:selectedBodyLine<0?undefined:bodyStart+selectedBodyLine-scroll,bodyStart,bodyHeight,columns:two?2:1,scroll,footer,theme,positions};
}
export function formatPreview(frame:PreviewFrame,options:{color?:boolean;depth?:4|8|24}={}):string{
  return frame.spans.map(line=>styleSpans(line,{theme:frame.theme,...options})).join('\n')+'\n';
}
