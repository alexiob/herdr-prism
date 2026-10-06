import {test}from'node:test';import assert from'node:assert/strict';
const native=await import('../src/native/publisher.ts').catch(()=>({}))as any;
test('native reference counts distinguish bounded history and unavailable source from a complete zero',async()=>{
 for(const [refCoverage,expected]of [['partial','r1+'],['retained','r1+'],['unavailable','r—'],['session','r1']]){
  let tokens:any;const publisher=new native.NativePublisher({call:async(method:string,params:any)=>{if(method==='pane.get')return{pane:{terminal_id:'t',tokens:{}}};if(method==='pane.report_metadata')tokens=params.tokens;return{};}});
  await publisher.publish([{key:'x',depth:0,children:[],evidence:{id:'x',provider:'pi',messages:[],tools:[],usage:[],goals:[]},attachment:{pane_id:'p',terminal_id:'t'},refs:[{id:'r',target:'/fixture/ref',messageId:'m',edited:false}],refCoverage}],1000);
  assert.ok(tokens.hat_counts.endsWith(expected),tokens.hat_counts);
 }
});
test('native publisher uses display-only bounded tokens, renews TTL and clears its owner safely',async()=>{
  assert.equal(typeof native.NativePublisher,'function','native publisher missing');
  const calls:any[]=[];const tokens:any={foreign:'safe'};const rpc={call:async(method:string,params:any)=>{calls.push({method,params});if(method==='pane.get')return{pane:{terminal_id:'t',tokens:{...tokens}}};if(method==='pane.report_metadata')for(const[key,value]of Object.entries(params.tokens))if(value===null)delete tokens[key];else tokens[key]=value;return {type:'agent_view',source:'plugin:iob.herdr-prism'};}};
  const publisher=new native.NativePublisher(rpc);
  const session:any={key:'codex:a',depth:1,children:[],evidence:{provider:'codex',id:'a',title:'Build\x1b[31m',messages:[],tools:[],goals:[],usage:[],availability:'known'},attachment:{pane_id:'w:p',terminal_id:'t',revision:1,tokens:{foreign:'safe'}},resource:{availability:'unavailable',processes:[],memoryLabel:'RSS sum'}};
  await publisher.publish([session],1000);await publisher.publish([session],1100);
  const reports=()=>calls.filter(c=>c.method==='pane.report_metadata');assert.equal(reports().length,1);assert.ok(Object.keys(reports()[0].params.tokens).length<=16);assert.equal(reports()[0].params.ttl_ms,15000);
  assert.ok(!reports()[0].params.tokens.hat_line.includes('\x1b'));assert.ok(reports()[0].params.tokens.hat_load.includes('—'));
  await publisher.publish([session],7000);assert.equal(reports().length,2);
  await publisher.installView();assert.equal(calls.at(-1).method,'agent.view.set');
  await publisher.clear([session]);assert.equal(calls.at(-1).method,'agent.view.clear');assert.equal(calls.at(-1).params.source,'plugin:iob.herdr-prism');
  assert.ok(!Object.keys(calls.at(-2).params.tokens).includes('foreign'));
});
test('native publication rejects a replaced terminal before writing display metadata',async()=>{
 const calls:string[]=[];const publisher=new native.NativePublisher({call:async(method:string)=>{calls.push(method);return{pane:{terminal_id:'new',tokens:{}}};}});
 await publisher.publish([{key:'old',children:[],depth:0,evidence:{id:'old',provider:'codex',messages:[],tools:[],goals:[],usage:[]},attachment:{pane_id:'p',terminal_id:'old'}}],1000);
 assert.deepEqual(calls,['pane.get']);assert.match(publisher.diagnostics.join(' '),/occupant/);await assert.rejects(publisher.installView(),/rank/);
});
test('native publisher refuses overflowing another reporter shared token budget',async()=>{
  assert.equal(typeof native.NativePublisher,'function','native publisher missing');let called=false;
  const publisher=new native.NativePublisher({call:async()=>{called=true;}});
  const session:any={key:'x',depth:0,children:[],evidence:{id:'x',provider:'pi',messages:[],tools:[],usage:[],goals:[]},attachment:{pane_id:'p',tokens:Object.fromEntries(Array.from({length:24},(_,i)=>['other'+i,'x']))}};
  await publisher.publish([session],1000);assert.equal(called,false);assert.ok(publisher.diagnostics[0].includes('budget'));
});
test('native ancestor summary counts grandchildren through transcript-only children',async()=>{
 const calls:any[]=[];const publisher=new native.NativePublisher({call:async(method:string,params:any)=>{calls.push({method,params});if(method==='pane.get')return{pane:{terminal_id:'t',tokens:{}}};return{};}});
 const root:any={key:'root',depth:0,children:['child'],evidence:{id:'root',provider:'codex',messages:[],tools:[],goals:[],usage:[],availability:'known'},attachment:{pane_id:'p',terminal_id:'t',tokens:{}}};
 const child:any={...root,key:'child',children:['grandchild'],attachment:undefined};const grandchild:any={...root,key:'grandchild',children:[],attachment:undefined};
 await publisher.publish([root],1000,[root,child,grandchild]);assert.match(calls.find(c=>c.method==='pane.report_metadata').params.tokens.hat_counts,/a2/);
});
test('compact native resources state readable agent counts and omit unreported goal',async()=>{
 let tokens:any;const publisher=new native.NativePublisher({call:async(method:string,params:any)=>{if(method==='pane.get')return{pane:{terminal_id:'t',tokens:{}}};if(method==='pane.report_metadata')tokens=params.tokens;return{};}});
 const root:any={key:'x',depth:0,children:['child'],evidence:{id:'x',provider:'pi',messages:[],tools:[],usage:[],goals:[]},attachment:{pane_id:'p',terminal_id:'t'},resource:{availability:'stale',processes:[],memoryBytes:'1048576',cpuPercent:12,memoryLabel:'RSS sum'}};
 await publisher.publish([root],1000,[root,{...root,key:'child',children:[],attachment:undefined}]);assert.equal(tokens.hat_goal,'');assert.match(tokens.hat_load,/1 agent/);assert.match(tokens.hat_fresh,/cached/);root.evidence.task='Review sampler';await publisher.publish([root],7000);assert.match(tokens.hat_goal,/Task: Review sampler/);
});
