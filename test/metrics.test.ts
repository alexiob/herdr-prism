import test from 'node:test';
import assert from 'node:assert/strict';
import {reduceUsage,reduceUsageScope,reduceTurnUsage} from '../src/metrics/usage-reducer.ts';
import {summarizeMessages} from '../src/metrics/message-counts.ts';
import {SampleHistory} from '../src/metrics/history.ts';
import type {UsageRecord} from '../src/model/types.ts';
const u=(id:string,input:number,kind:'cumulative'|'delta'='cumulative',extra:Partial<UsageRecord>={}):UsageRecord=>({id,input,output:10,kind,cacheSemantics:'subset',...extra});
test('explicit provider turn snapshots replace each other without adding to thread lifetime totals',()=>{
 const records=[u('a',100,'cumulative',{sessionId:'s',turnId:'t',timestamp:1,turnCounters:{input:20,output:5,total:25,cacheRead:4,cacheSemantics:'subset'}}),u('b',200,'cumulative',{sessionId:'s',turnId:'t',timestamp:2,turnCounters:{input:30,output:7,total:37,cacheRead:6,cacheSemantics:'subset'}})];
 const result=reduceUsage(records,{activeTurnId:'t'});assert.equal(result.input,200);assert.equal(result.output,10);assert.equal(result.turnUsage?.input,30);assert.equal(result.turnUsage?.total,37);assert.equal(result.turnUsage?.cacheRead,6);assert.equal(result.turnUsage?.source,'provider-turn');assert.equal(result.turnUsage?.availability,'known');
 assert.equal(reduceUsage(records,{activeTurnId:'missing'}).turnUsage?.availability,'unavailable');
});
test('direct turn observations retain unknown cache semantics and diagnose backwards counters',()=>{
 const partial=reduceTurnUsage([u('a',100,'cumulative',{sessionId:'s',turnId:'t',turnCounters:{input:20,output:5,cacheRead:4,cacheSemantics:'unknown'}})],'t');assert.equal(partial?.input,20);assert.equal(partial?.total,undefined);assert.equal(partial?.availability,'partial');
 const reset=reduceTurnUsage([u('a',100,'cumulative',{sessionId:'s',turnId:'t',timestamp:1,turnCounters:{input:20,output:5,total:25}}),u('b',110,'cumulative',{sessionId:'s',turnId:'t',timestamp:2,turnCounters:{input:5,output:2,total:7}})],'t');assert.equal(reset?.availability,'partial');assert.equal(reset?.total,undefined);assert.match(reset!.diagnostics.join(' '),/backwards/i);
});
test('inter-agent communication has its own retained count and cannot become user or assistant chat',()=>{
 const result=summarizeMessages([{id:'chat',role:'assistant',text:'visible'},{id:'between',role:'assistant',text:'delegation',kind:'inter-agent',author:'parent',recipient:'child'}]);assert.deepEqual(result.byRole,{user:0,assistant:1,tool:0});assert.equal(result.interAgentMessages,1);assert.equal(result.visibleMessages,1);assert.equal(result.messages,2);
});
test('cumulative snapshots and represented deltas do not double count',()=>{
 const result=reduceUsage([u('d1',30,'delta'),u('c1',30),u('c2',50),u('c2',50),u('d2',5,'delta',{timestamp:4})]);
 assert.equal(result.input,55); assert.equal(result.output,20); assert.equal(result.total,75);
});
test('request streaming duplicates retain latest and validated backward counters start epochs',()=>{
 assert.equal(reduceUsage([u('x',4,'delta',{requestId:'r'}),u('y',8,'delta',{requestId:'r'})]).input,8);
 const x=reduceUsage([u('a',100),u('b',20),u('c',30),u('d',7,'cumulative',{model:'new'})]);
 assert.equal(x.input,137); assert.equal(x.epochs,3);
 assert.equal(reduceUsage([]).input,undefined);
});
test('cache category meaning controls totals, unknown semantics do not invent totals',()=>{
 assert.equal(reduceUsage([u('x',100,'delta',{cacheRead:40,cacheWrite:10})]).total,110);
 assert.equal(reduceUsage([u('x',100,'delta',{cacheRead:40,cacheWrite:10,cacheSemantics:'separate'})]).total,160);
 assert.equal(reduceUsage([u('x',100,'delta',{cacheRead:40,cacheSemantics:'unknown'})]).total,undefined);
});
test('context/rates use compatible evidence and configured cost is partial when a price is absent',()=>{
 const x=reduceUsage([u('x',100,'delta',{model:'m',contextUsed:200,contextLimit:1000,turnMs:2000})],{rates:{m:{currency:'EUR',input:2,output:4}}});
 assert.equal(x.contextPercent,20); assert.equal(x.generationTokensPerSecond,undefined); assert.equal(x.turnTokensPerSecond,5);
 assert.equal(x.cost?.amount,0.00024); assert.equal(x.cost?.currency,'EUR');
 assert.equal(reduceUsage([u('x',100,'delta',{model:'m',cacheRead:20})],{rates:{m:{currency:'EUR',input:2,output:4}}}).cost?.availability,'partial');
 assert.equal(reduceUsage([u('x',100)]).contextPercent,undefined);
});
test('subtree usage never adds child counters to inclusive parent and unknown inclusion is partial',()=>{
 assert.equal(reduceUsageScope([{key:'a',records:[u('a',100,'delta',{includesChildren:true})]},{key:'b',records:[u('b',50,'delta')],parentKey:'a'}]).input,100);
 const x=reduceUsageScope([{key:'a',records:[u('a',100,'delta')]},{key:'b',records:[u('b',50,'delta')],parentKey:'a'}]); assert.equal(x.availability,'partial'); assert.equal(x.input,undefined);
});
test('message metrics deduplicate messages and tools and keep role/error counts explicit',()=>{
 const m={id:'a',role:'assistant' as const,text:'hi',tools:[{id:'t',name:'read',status:'error' as const}]};
 const x=summarizeMessages([m,m,{id:'u',role:'user',text:'x'},{id:'tool',role:'tool',text:'failed',tools:m.tools}]);
 assert.deepEqual(x.byRole,{user:1,assistant:1,tool:1}); assert.equal(x.tools,1); assert.equal(x.errors,1);
});
test('history is bounded, separated by session/scope, preserves gaps and peaks aggregate samples',()=>{
 const h=new SampleHistory({windowMs:900000,maxPoints:3,gapMs:3000});
 h.add('a','self',{at:0,cpuPercent:0,memoryBytes:'100'}); h.add('b','self',{at:1,cpuPercent:99,memoryBytes:'999'});
 h.add('a','self',{at:2000,cpuPercent:50,memoryBytes:'200'});h.add('a','self',{at:8000,memoryBytes:'150'});
 const x=h.view('a','self',8000); assert.equal(x.peakMemoryBytes,'200'); assert.equal(x.points.some(x=>x.gap),true); assert.equal(x.cpu.at(-1),undefined);
 assert.equal(h.view('a','subtree',8000).points.length,0);
 assert.equal(h.view('a','self',1000000).points.length,0);
});
test('model switches preserve an increasing session cumulative counter including return to a prior model',()=>{const x=reduceUsage([u('a',100,'cumulative',{model:'a'}),u('b',120,'cumulative',{model:'b',output:20}),u('c',150,'cumulative',{model:'a',output:30})]);assert.equal(x.input,150);assert.equal(x.output,30);assert.equal(x.total,180);assert.equal(x.epochs,1);});
test('missing input in a represented request keeps coverage partial instead of a complete-looking subtotal',()=>{const x=reduceUsage([u('a',100,'delta'),{id:'b',kind:'delta',output:10,cacheSemantics:'subset'}]);assert.equal(x.input,100);assert.equal(x.availability,'partial');assert.equal(x.total,undefined);});
test('inclusive parent is removed from ambiguous child semantics and known self-only parent sums safely',()=>{const x=reduceUsageScope([{key:'a',records:[u('a',100,'delta',{includesChildren:false})]},{key:'b',parentKey:'a',records:[u('b',50,'delta')]}]);assert.equal(x.input,150);assert.equal(x.availability,'known');});
test('usage deduplication keeps final stream position and does not merge request IDs across explicit epochs',()=>{
 assert.equal(reduceUsage([u('x',50),u('y',100),u('x',120)]).input,120);
 assert.equal(reduceUsage([u('x',20,'delta',{requestId:'r',epoch:'1'}),u('y',30,'delta',{requestId:'r',epoch:'2'})]).input,50);
});
test('unknown cache semantics leave input billing unavailable instead of risking double charging',()=>{const x=reduceUsage([u('a',100,'delta',{model:'m',cacheRead:20,cacheSemantics:'unknown'})],{rates:{m:{currency:'EUR',input:2,output:4,cacheRead:1}}});assert.equal(x.cost?.availability,'partial');assert.ok(Math.abs(x.cost!.amount-0.00006)<1e-12);});
test('scope reports missing session evidence and conflicting inclusive counters as partial',()=>{
 const missing=reduceUsageScope([{key:'a',records:[]},{key:'b',parentKey:'a',records:[u('b',50,'delta')]}]);assert.equal(missing.availability,'partial');assert.equal(missing.input,50);
 const mixed=reduceUsageScope([{key:'a',records:[u('a1',100,'delta',{includesChildren:false}),u('a2',100,'delta',{includesChildren:true})]},{key:'b',parentKey:'a',records:[u('b',50,'delta')]}]);assert.equal(mixed.availability,'partial');assert.equal(mixed.total,undefined);
});

test('Codex cumulative thread totals stay independent of model and ambiguous cumulative pricing is unavailable',()=>{
 const records=[u('a',100,'cumulative',{sessionId:'thread',epoch:'thread-counter',model:'a',output:10}),u('b',120,'cumulative',{sessionId:'thread',epoch:'thread-counter',model:'b',output:20})];
 const x=reduceUsage(records,{rates:{a:{currency:'EUR',input:1,output:2},b:{currency:'EUR',input:3,output:4}}});assert.equal(x.input,120);assert.equal(x.output,20);assert.equal(x.total,140);assert.equal(x.epochs,1);assert.equal(x.cost,undefined);assert.equal(x.model,'b');
});
test('timing-only completion preserves token totals/coverage and reports duration without invented generation speed',()=>{
 const x=reduceUsage([u('tokens',100,'cumulative',{output:10,sessionId:'thread',turnId:'t',model:'a'}),{id:'complete',kind:'delta',sessionId:'thread',turnId:'t',turnMs:2000}]);
 assert.equal(x.input,100);assert.equal(x.output,10);assert.equal(x.total,110);assert.equal(x.availability,'known');assert.deepEqual(x.coverage,{usable:1,total:1});assert.equal(x.model,'a');assert.equal(x.turnMs,2000);assert.equal(x.generationTokensPerSecond,undefined);assert.equal(x.turnTokensPerSecond,undefined);
});
test('duration-only record with the same request ID cannot replace real usage and explicit delta model prices remain attributable',()=>{
 const x=reduceUsage([u('a',100,'delta',{requestId:'r',model:'a',turnId:'t'}),{id:'complete',kind:'delta',requestId:'r',turnId:'t',turnMs:2000}],{rates:{a:{currency:'EUR',input:1,output:2}}});assert.equal(x.total,110);assert.equal(x.availability,'known');assert.ok(Math.abs(x.cost!.amount-0.00012)<1e-12);
});
test('a timing observation sharing an event ID never erases token usage or latest compatible context',()=>{
 const x=reduceUsage([u('same',100,'delta',{model:'a',contextUsed:200,contextLimit:1000}),{id:'same',kind:'delta',model:'a',turnMs:2000}]);assert.equal(x.total,110);assert.equal(x.contextPercent,20);assert.equal(x.turnMs,2000);
});
test('ambiguous cumulative pricing retains only independently reported model deltas as a partial cost',()=>{
 const x=reduceUsage([u('a-delta',30,'delta',{model:'a',requestId:'a'}),u('a-total',100,'cumulative',{model:'a'}),u('b-delta',20,'delta',{model:'b',requestId:'b'}),u('b-total',120,'cumulative',{model:'b',output:20})],{rates:{a:{currency:'EUR',input:1,output:2},b:{currency:'EUR',input:3,output:4}}});assert.equal(x.input,120);assert.equal(x.output,20);assert.equal(x.total,140);assert.equal(x.cost?.availability,'partial');assert.ok(Math.abs(x.cost!.amount-0.00015)<1e-12);
});
test('last-turn cumulative usage subtracts only a compatible prior explicit turn and never lifetime counts',()=>{
 const records=[u('previous',100,'cumulative',{sessionId:'s',epoch:'e',turnId:'first',output:10,cacheRead:30,reasoning:2}),u('current1',120,'cumulative',{sessionId:'s',epoch:'e',turnId:'second',output:15,cacheRead:35,reasoning:3,model:'new'}),u('current2',130,'cumulative',{sessionId:'s',epoch:'e',turnId:'second',output:20,cacheRead:40,reasoning:4,model:'new'})];
 const turn=reduceUsage(records).turnUsage;assert.ok(turn);assert.equal(turn.turnId,'second');assert.equal(turn.input,30);assert.equal(turn.output,10);assert.equal(turn.cacheRead,10);assert.equal(turn.reasoning,2);assert.equal(turn.total,40);assert.equal(turn.availability,'known');assert.equal(turn.source,'cumulative-difference');
 const first=reduceUsage([records[0]!]).turnUsage;assert.equal(first?.input,undefined);assert.equal(first?.total,undefined);assert.equal(first?.availability,'unavailable');
});
test('current turn without evidence stays unavailable instead of borrowing the last turn',()=>{
 const x=reduceUsage([u('last',30,'delta',{turnId:'done'})],{activeTurnId:'working'}).turnUsage;assert.equal(x?.turnId,'working');assert.equal(x?.availability,'unavailable');assert.equal(x?.input,undefined);
 assert.equal(reduceUsage([u('untagged',100)]).turnUsage,undefined);
});
test('explicit turn deltas deduplicate request streaming and keep timing-only completion separate',()=>{
 const records=[u('r1a',10,'delta',{turnId:'a',requestId:'r',cacheRead:4}),u('r1b',20,'delta',{turnId:'a',requestId:'r',cacheRead:8}),u('r2',5,'delta',{turnId:'a',requestId:'next',cacheRead:2}),{id:'complete',kind:'delta' as const,turnId:'a',turnMs:2000}];
 const turn=reduceUsage(records).turnUsage;assert.equal(turn?.input,25);assert.equal(turn?.output,20);assert.equal(turn?.cacheRead,10);assert.equal(turn?.total,45);assert.equal(turn?.availability,'known');assert.deepEqual(turn?.coverage,{usable:2,total:2});assert.equal(turn?.source,'delta');
});
test('represented turn deltas are superseded by its cumulative difference but later deltas remain',()=>{
 const records=[u('prior',100,'cumulative',{turnId:'a',epoch:'e'}),u('r',10,'delta',{turnId:'b',epoch:'e',requestId:'r',output:2}),u('snapshot',110,'cumulative',{turnId:'b',epoch:'e',output:12}),u('later',5,'delta',{turnId:'b',epoch:'e',requestId:'later',output:3})];
 const turn=reduceUsage(records).turnUsage;assert.equal(turn?.input,15);assert.equal(turn?.output,5);assert.equal(turn?.total,20);assert.equal(turn?.availability,'known');
});
test('turn reset, untagged intervening usage and cross-session baselines cannot invent differences',()=>{
 for(const records of [[u('p',100,'cumulative',{turnId:'a',epoch:'old'}),u('n',120,'cumulative',{turnId:'b',epoch:'new'})],[u('p',100,'cumulative',{turnId:'a'}),u('n',20,'cumulative',{turnId:'b'})],[u('p',100,'cumulative',{turnId:'a'}),u('unknown',110),u('n',120,'cumulative',{turnId:'b'})],[u('p',100,'cumulative',{turnId:'a',sessionId:'one'}),u('n',120,'cumulative',{turnId:'b',sessionId:'two'})]]){const turn=reduceUsage(records).turnUsage;assert.equal(turn?.availability,'unavailable');assert.equal(turn?.total,undefined);assert.equal(turn?.input,undefined);}
});
test('incomplete turn requests and independent deltas beside an ungrounded cumulative stay partial',()=>{
 const incomplete=reduceUsage([u('known',10,'delta',{turnId:'a'}),{id:'missing',kind:'delta',turnId:'a',output:3}]).turnUsage;assert.equal(incomplete?.input,10);assert.equal(incomplete?.output,13);assert.equal(incomplete?.total,undefined);assert.equal(incomplete?.availability,'partial');
 const partial=reduceUsage([u('known',10,'delta',{turnId:'a'}),u('lifetime',1000,'cumulative',{turnId:'a'})]).turnUsage;assert.equal(partial?.input,10);assert.equal(partial?.output,10);assert.equal(partial?.total,undefined);assert.equal(partial?.availability,'partial');
});
test('changed cumulative cache categories cannot establish compatible turn counters',()=>{
 const turn=reduceTurnUsage([u('previous',100,'cumulative',{turnId:'a',cacheRead:30,cacheSemantics:'subset'}),u('current',120,'cumulative',{turnId:'b',cacheRead:40,cacheSemantics:'separate'})]);assert.equal(turn?.input,undefined);assert.equal(turn?.cacheRead,undefined);assert.equal(turn?.total,undefined);assert.equal(turn?.availability,'unavailable');
});
test('explicit turn selection respects session identity and does not cross intervening uncounted requests',()=>{
 const records=[u('a',10,'delta',{sessionId:'one',turnId:'a'}),u('b',20,'delta',{sessionId:'one',turnId:'b'})];assert.equal(reduceTurnUsage(records,'a')?.input,10);assert.equal(reduceTurnUsage(records)?.input,20);
 const reused=[u('a',10,'delta',{sessionId:'one',turnId:'same'}),u('b',20,'delta',{sessionId:'two',turnId:'same'})];assert.equal(reduceTurnUsage(reused)?.input,20);assert.equal(reduceTurnUsage(reused,'same')?.availability,'unavailable');
 const uncounted=reduceTurnUsage([u('baseline',100,'cumulative',{turnId:'a'}),u('unrepresented',10,'delta',{turnId:'a',requestId:'next'}),u('current',130,'cumulative',{turnId:'b'})]);assert.equal(uncounted?.input,undefined);assert.equal(uncounted?.availability,'unavailable');
});
