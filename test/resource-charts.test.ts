import test from 'node:test';
import assert from 'node:assert/strict';
import {SampleHistory} from '../src/metrics/history.ts';
import {demoData} from '../src/runtime/demo.ts';
import {createUiState,renderScreen} from '../src/tui/screen.ts';
import {historyValues,resourceDocument} from '../src/tui/facts.ts';
import {spark} from '../src/tui/text.ts';

const session=()=>demoData().sessions[0]!;
const sampled=(count=30)=>{
 const root=session(),history=new SampleHistory();
 for(let i=0;i<count;i++)history.add(root.key,'self',{at:1000+i*1000,cpuPercent:i?16.2:undefined,memoryBytes:'1395864371'});
 root.history=history.view(root.key,'self',count*1000);
 return root;
};

test('startup charts distribute observed samples instead of collapsing fifteen minutes into one bar',()=>{
 const root=sampled(),cpu=historyValues(root,'cpu',8,30000),memory=historyValues(root,'memory',8,30000);
 assert.deepEqual(cpu,Array(8).fill(16.2));
 assert.deepEqual(memory,Array(8).fill(1395864371));
});

test('history includes the sample captured exactly at the render time',()=>{
 const root=sampled(1);
 assert.equal(historyValues(root,'memory',8,1000).at(-1),1395864371);
});

test('each time bucket retains its last measured observation when current CPU needs warmup',()=>{
 const root=session();root.history={windowMs:8000,points:[{at:0},{at:10},{at:1000},{at:7900},{at:7950},{at:8000}],cpu:[undefined,50,25,70,undefined,30],memory:[]};
 assert.deepEqual(historyValues(root,'cpu',8,8000),[50,25,undefined,undefined,undefined,undefined,undefined,30]);
 root.history.points!.pop();root.history.cpu.pop();
 assert.equal(historyValues(root,'cpu',8,8000).at(-1),70);
});

test('coarse CPU charts retain measurements while current aggregate CPU remains unavailable',()=>{
 const root=session(),state=createUiState();
 root.history={windowMs:8000,points:[{at:0},{at:10},{at:1000},{at:1100},{at:2000},{at:2100}],cpu:[50,undefined,25,undefined,0,undefined],memory:[]};
 root.resource={...root.resource!,cpuPercent:undefined,cpuCoverage:{readable:1,total:2}};
 const values=historyValues(root,'cpu',2,2100);
 assert.deepEqual(values,[25,0]);
 const fields=resourceDocument(root,'cpu',state,2100).sections[0]!.fields!;
 assert.equal(fields.find(field=>field.label==='Current')!.value,'—');
 assert.doesNotMatch(fields.find(field=>field.label==='History')!.value,/no history/i);
 assert.match(fields.find(field=>field.label==='Sampling')!.value,/last measured/i);
 assert.equal(fields.find(field=>field.label==='Last measured')!.value,new Date(2000).toISOString());
 assert.deepEqual(root.resource.cpuCoverage,{readable:1,total:2});
});

test('explicit gaps clear chart columns without mislabeling retained measurements as no history',()=>{
 const root=session(),state=createUiState();
 root.history={windowMs:1000,points:[{at:0},{at:10,gap:true},{at:500},{at:510,gap:true}],cpu:[50,undefined,25,undefined],memory:['100',undefined,'200',undefined]};
 for(const kind of ['cpu','memory'] as const){
  assert.deepEqual(historyValues(root,kind,2,1000),[undefined,undefined]);
  const fields=resourceDocument(root,kind,state,1000).sections[0]!.fields!;
  assert.match(fields.find(field=>field.label==='History')!.value,/sampling gaps/i);
  assert.equal(fields.find(field=>field.label==='Last measured')!.value,new Date(500).toISOString());
  assert.match(fields.find(field=>field.label==='Sampling')!.value,/explicit gaps/i);
  assert.doesNotMatch(fields.find(field=>field.label==='Scale')!.value,/until measured/i);
 }
});

test('measurement and gap labels are metric-specific and exclude records outside the visible window',()=>{
 const root=session(),state=createUiState();
 root.history={windowMs:1000,points:[{at:0},{at:1500},{at:1510,gap:true}],cpu:[50,undefined,undefined],memory:['100','200',undefined]};
 const fields=(kind:string)=>resourceDocument(root,kind,state,2000).sections[0]!.fields!;
 assert.match(fields('cpu').find(field=>field.label==='History')!.value,/no history/i);
 assert.equal(fields('cpu').find(field=>field.label==='Measured samples')!.value,'0');
 assert.equal(fields('cpu').find(field=>field.label==='Last measured')!.value,'—');
 assert.match(fields('memory').find(field=>field.label==='History')!.value,/sampling gaps/i);
 assert.equal(fields('memory').find(field=>field.label==='Measured samples')!.value,'1');
 assert.equal(fields('memory').find(field=>field.label==='Last measured')!.value,new Date(1500).toISOString());
});

test('a later measurement after an explicit gap is plotted without filling other empty columns',()=>{
 const root=session();root.history={windowMs:1000,points:[{at:0},{at:100,gap:true},{at:200},{at:300},{at:900}],cpu:[50,undefined,undefined,25,undefined],memory:[]};
 assert.deepEqual(historyValues(root,'cpu',5,1000),[undefined,25,undefined,undefined,undefined]);
});

test('history retains visibility gaps and never fills them with zero or an interpolated measurement',()=>{
 const root=session(),history=new SampleHistory({gapMs:5000});
 history.add(root.key,'self',{at:1000,cpuPercent:50,memoryBytes:'1024'});
 history.add(root.key,'self',{at:21000,cpuPercent:0,memoryBytes:'2048'});
 root.history=history.view(root.key,'self',21000);
 assert.deepEqual(historyValues(root,'cpu',8,21000),[50,undefined,undefined,undefined,undefined,undefined,undefined,0]);
});

test('resource charts show explicit no history instead of invisible whitespace',()=>{
 const data=demoData(),root=data.sessions[0]!;root.history={cpu:[undefined,undefined],memory:[undefined]};
 const state=createUiState();state.selectedKey=root.key;
 const frame=renderScreen(data,state,80,35,30000);
 for(const id of ['cpu','memory'])assert.match(frame.rows.find(row=>row.id===id)!.value!,/no history/i);
 for(const id of ['cpu','memory'])assert.match(resourceDocument(root,id,state,30000).sections[0]!.fields!.find(field=>field.label==='History')!.value,/no history/i);
});

test('resource detail states the plotted period and scales without presenting memory as host percentage',()=>{
 const root=sampled(),state=createUiState();
 const fields=(id:string)=>resourceDocument(root,id,state,30000).sections[0]!.fields!;
 assert.ok(fields('cpu').find(field=>field.label==='Period'),'CPU history needs its plotted period');
 assert.match(fields('cpu').find(field=>field.label==='Period')!.value,/29s/);
 assert.match(fields('cpu').find(field=>field.label==='Scale')!.value,/0–100%/);
 assert.match(fields('memory').find(field=>field.label==='Scale')!.value,/1\.3GiB.*observed/i);
 assert.match(fields('memory').find(field=>field.label==='Scale')!.value,/host/i);
});

test('ASCII measured zero stays visible and differs from an unavailable chart column',()=>{
 assert.notEqual(spark([0],1,true).trim(),'');
 assert.equal(spark([undefined,0],2,true)[0],' ');
 assert.notEqual(spark([undefined,0],2,true)[1],' ');
});

 test('CPU spark scale preserves one-core meaning and grows for multi-core measurements',()=>{
 const root=session(),state=createUiState();
 const chart=()=>resourceDocument(root,'cpu',state,30000).sections[0]!.fields!.find(field=>field.label==='History')!.value;
 root.history={cpu:[0,50,100],memory:[]};assert.equal(chart(),'▁▄█');
 root.history={cpu:[50],memory:[]};assert.equal(chart(),'▄');
 root.history={cpu:[50,200],memory:[]};assert.equal(chart(),'▂█');
 });

 test('invalid resource observations never appear as measured zero or crash rendering',()=>{
 const root=session();root.history={cpu:[NaN,Infinity,-1,0],memory:['invalid','-1','0']};
 assert.deepEqual(historyValues(root,'cpu',8,30000),[undefined,undefined,undefined,0]);
 assert.deepEqual(historyValues(root,'memory',8,30000),[undefined,undefined,0]);
 });
test('overview CPU and resident-memory graphs share a fixed left edge across numeric lengths',()=>{
 for(const [cpu,memory] of [[4.7,'2469606195'],[124.2,'65536'],[0,'0'],[2345.7,'107374182400']] as const){const root=sampled();root.resource={...root.resource!,cpuPercent:cpu,memoryBytes:memory};const state=createUiState();state.selectedKey=root.key;const frame=renderScreen({sessions:[root],updatedAt:30000,stale:false,diagnostics:[]},state,80,34,30000);const cpuLine=frame.lines.find(l=>/^│.? CPU\s|^│.?CPU\s/.test(l))??frame.lines.find(l=>l.includes('CPU')&&/[▁▂▃▄▅▆▇█]/.test(l));const memLine=frame.lines.find(l=>l.includes('RSS sum')&&/[▁▂▃▄▅▆▇█]/.test(l));assert.ok(cpuLine&&memLine);assert.equal(cpuLine.search(/[▁▂▃▄▅▆▇█]/),memLine.search(/[▁▂▃▄▅▆▇█]/));}
});

test('partial CPU retains an explicit measured lower bound in current values and history',()=>{
 const root=sampled();root.resource={...root.resource!,cpuPercent:undefined,cpuLowerBound:124.5,cpuCoverage:{readable:1,total:2}};
 root.history={cpu:[undefined,undefined],memory:['1024','2048'],windowMs:60000,points:[{at:1000,cpuLowerBound:125},{at:2000,cpuLowerBound:124.5}]};
 const state=createUiState();state.selectedKey=root.key;
 const frame=renderScreen({sessions:[root],updatedAt:2000,stale:false,diagnostics:[]},state,80,34,2000),row=frame.rows.find(row=>row.id==='cpu')!;
 assert.match(row.value!,/≥124.5%/);assert.ok(/[▁▂▃▄▅▆▇█]/.test(row.value!));assert.match(row.help!,/lower bound/);
 const doc=row.document!,fields=doc.sections.flatMap(section=>section.fields??[]);assert.equal(fields.find(field=>field.label==='Current')!.value,'≥124.5%');assert.ok(fields.some(field=>field.label==='Partial samples'&&field.value==='2'));
});
