import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProviderIndex } from '../src/providers/index.ts';
const runtime = await import('../src/runtime/collector.ts').catch(() => ({})) as any;
const settings = { nativeMode: 'inspector-only', providerHomes: {}, todosEnabled: true, sampleIntervalMs: 2000, follow: true, ascii: false, monochrome: true };
test('collector joins exact session lineage, content, telemetry and private checkbox state', async () => {
    assert.equal(typeof runtime.Collector, 'function', 'foreground collector missing');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'hat-collector-'));
    await mkdir(path.join(dir, 'codex', 'sessions'), { recursive: true });
    const write = async (id: string, parent?: string) => writeFile(path.join(dir, 'codex', 'sessions', id + '.jsonl'), [{ type: 'session_meta', payload: { id, cwd: dir, source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent } } } : 'cli' } }, { type: 'response_item', timestamp: '2026-10-06T10:00:00Z', payload: { type: 'message', id: 'm', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: 'See `plan.md`\nACTION: Review plan' }] } }].map(v => JSON.stringify(v) + '\n').join(''));
    await write('root');
    await write('child', 'root');
    await write('unrelated');
    const agent = { pane_id: 'w:p', terminal_id: 'term-a', workspace_id: 'w', tab_id: 'w:t', agent: 'codex', agent_status: 'working', agent_session: { source: 'herdr:codex', agent: 'codex', kind: 'id', value: 'root' }, cwd: dir, focused: true, revision: 1 };
    const snapshot: any = { version: '0.9.3', protocol: 22, agents: [agent], panes: [], tabs: [], workspaces: [], layouts: [], focused_pane_id: 'w:p' };
    const calls: any[] = [];
    const rpc = { call: async (method: string, params: any) => { calls.push({ method, params }); if (method === 'session.snapshot')
            return { snapshot }; if (method === 'pane.process_info')
            return { process_info: { foreground_processes: [{ pid: 42, name: 'codex' }] } }; if (method === 'agent.get')
            return { agent: structuredClone(agent) }; return {}; } };
    let counter = 0;
    const sampler = { sample: async () => ({ platform: 'darwin', bootId: 'boot', sampledAt: 1000 + counter * 1000, monotonicNs: String(BigInt(++counter) * 1000000000n), processes: [{ pid: 42, ppid: 1, startTime: '1', cpuNs: String(BigInt(counter) * 1000000000n), rssBytes: '104857600', name: 'codex' }] }), close: async () => { } };
    const index = new ProviderIndex({ codexHome: path.join(dir, 'codex'), claudeHome: path.join(dir, 'claude'), piHome: path.join(dir, 'pi') });
    const collector = new runtime.Collector({ paneOpen:true,rpc, settings, stateDir: path.join(dir, 'state'), index, sampler });
    try {
        await collector.init();
        await collector.refresh();
        await collector.sampleProcesses();
        await collector.sampleProcesses();
        assert.deepEqual(collector.data.sessions.map((s: any) => s.key), ['codex:root', 'codex:child']);
        const root = collector.data.sessions[0];
        assert.equal(root.resource.cpuPercent, 100);
        assert.equal(root.refs.length, 1);
        assert.equal(root.todos.length, 1);
        assert.equal(root.todoStatus, 'reported');
        await collector.toggleTodo(root.key, root.todos[0].id);
        assert.equal(collector.data.sessions[0].todos[0].checked, true);
        await collector.focus('codex:root');
        assert.equal(calls.at(-1).method, 'agent.focus');
        assert.deepEqual(calls.at(-1).params, { target: 'w:p' });
        agent.terminal_id = 'replacement';
        agent.agent_session.value = 'replacement';
        await assert.rejects(collector.focus('codex:root'), /changed|ended|replaced/);snapshot.agents=[];await collector.refresh();const historical=collector.data.sessions.find((s:any)=>s.key==='codex:root');assert.equal(historical.historical,true);assert.equal(historical.evidence.messages.length,1);assert.equal(historical.evidence.state,'historical');
    }
    finally {
        await collector.close();
        await rm(dir, { recursive: true, force: true });
    }
});
test('failed sampling stays stale through content refresh and scope changes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'hat-health-'));
    let fail = false, n = 0;
    const agent = { pane_id: 'p', terminal_id: 't', workspace_id: 'w', tab_id: 'tab', agent: 'codex', agent_status: 'working', agent_session: { kind: 'id', value: 'a' }, focused: false, revision: 1 };
    const rpc = { call: async (method: string) => method === 'session.snapshot' ? { snapshot: { agents: [agent], protocol: 22 } } : method === 'agent.get' ? { agent } : method === 'pane.process_info' ? { process_info: { foreground_processes: [{ pid: 42, name: 'codex' }] } } : {} };
    const evidence = { id: 'a', provider: 'codex', messages: [], tools: [], usage: [], goals: [], availability: 'known' };
    const index = { setActiveRefs() { }, setDetailedRefs(){}, refreshSnapshots: async () => [evidence], resolveSnapshotCached: () => evidence, readTodoState: async () => undefined, diagnostics: [], close() { } };
    const sampler = { sample: async () => { if (fail)
            throw new Error('sample denied'); return { platform: 'darwin', bootId: 'b', sampledAt: Date.now(), monotonicNs: String(BigInt(++n) * 1000000000n), processes: [{ pid: 42, startTime: '1', cpuNs: String(BigInt(n) * 1000000000n), rssBytes: '100', name: 'codex' }] }; }, close: async () => { } };
    let gitCalls = 0;
    const git = { get: async () => { gitCalls++; return {}; }, close() { } };
    const collector = new runtime.Collector({ paneOpen:true,rpc, index, sampler, git, settings: { ...settings, todosEnabled: false }, stateDir: dir });
    try {
        await collector.init();
        await collector.refresh();
        assert.equal(gitCalls, 0, 'unknown cwd must not inspect plugin checkout');
        await collector.sampleProcesses();
        await collector.sampleProcesses();
        assert.equal(collector.data.sessions[0].resource.cpuPercent, 100);
        collector.setVisibleSession('codex:a',false); await collector.refresh();
        assert.equal(collector.data.sessions[0].resource.availability,'stale');
        collector.setVisibleSession('codex:a',true); await collector.refresh();
        assert.equal(collector.data.sessions[0].resource.availability,'stale','reopen must not revive an old sample');
        await collector.sampleProcesses(); assert.equal(collector.data.sessions[0].resource.cpuPercent,undefined,'first resumed sample warms up');
        await collector.sampleProcesses(); assert.equal(collector.data.sessions[0].resource.cpuPercent,100);
        fail = true;
        await collector.sampleProcesses();
        await collector.refresh();
        collector.setScope(false);
        assert.equal(collector.data.sessions[0].resource.availability, 'stale');
        assert.match(collector.data.sessions[0].resource.reason, /sample denied/);
        fail = false;
        await collector.sampleProcesses();
        assert.equal(collector.data.sessions[0].resource.availability, 'known');
    }
    finally {
        await collector.close();
        await rm(dir, { recursive: true, force: true });
    }
});
test('harness matching does not interpret arbitrary command arguments as executables', () => {
    assert.equal(typeof runtime.matchesHarness, 'function');
    assert.equal(runtime.matchesHarness('codex', { name: 'cat', argv: ['cat', 'codex'] }), false);
    assert.equal(runtime.matchesHarness('codex', { name: 'codex' }), true);
    assert.equal(runtime.matchesHarness('claude', { name: 'node', argv: ['node', '/opt/node_modules/@anthropic-ai/claude-code/cli.js'] }), true);
    assert.equal(runtime.matchesHarness('pi', { name: 'node', argv: ['node', '/usr/local/bin/pi'] }), true);assert.equal(runtime.matchesHarness('pi',{argv:['node.exe','C:\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js']}),true);
    assert.equal(runtime.matchesHarness('codex', { name: 'codex-unrelated' }), false);
});
test('mirrored session panes keep every attachment and both verified roots without doubling transcript usage', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'hat-mirror-'));
    const evidence = { id: 'same', provider: 'codex', messages: [], tools: [], usage: [{ id: 'counter', kind: 'cumulative', input: 10, output: 2 }], goals: [], availability: 'known' };
    const agents = [1, 2].map(i => ({ pane_id: 'p' + i, terminal_id: 't' + i, workspace_id: 'w', tab_id: 'tab', agent: 'codex', agent_status: 'working', agent_session: { kind: 'id', value: 'same' }, focused: i === 1, revision: 1 }));
    let count = 0;
    const rpc = { call: async (method: string, params: any) => method === 'session.snapshot' ? { snapshot: { agents, protocol: 22 } } : method === 'agent.get' ? { agent: agents.find(a => a.pane_id === params.target) } : method === 'pane.process_info' ? { process_info: { foreground_processes: [{ pid: params.pane_id === 'p1' ? 41 : 42, name: 'codex' }] } } : {} };
    const index = { setActiveRefs() { }, setDetailedRefs(){}, refreshSnapshots: async () => [evidence], resolveSnapshotCached: () => evidence, readTodoState: async () => undefined, diagnostics: [], close() { } };
    const sampler = { sample: async () => ({ platform: 'darwin', bootId: 'b', sampledAt: Date.now(), monotonicNs: String(BigInt(++count) * 1000000000n), processes: [41, 42].map(pid => ({ pid, startTime: '1', cpuNs: String(BigInt(count) * 1000000000n), rssBytes: '100', name: 'codex' })) }), close: async () => { } };
    const collector = new runtime.Collector({ paneOpen:true,rpc, index, sampler, settings: { ...settings, todosEnabled: false }, stateDir: dir });
    try {
        await collector.init();
        await collector.refresh();
        await collector.sampleProcesses();
        await collector.sampleProcesses();
        const sessions = collector.data.sessions;
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].attachments.length, 2);
        assert.equal(sessions[0].attachment.pane_id, 'p1');
        assert.equal(sessions[0].resource.processes.length, 2);
        assert.equal(sessions[0].resource.cpuPercent, 200);
        assert.equal(sessions[0].usage.total, 12);
    }
    finally {
        await collector.close();
        await rm(dir, { recursive: true, force: true });
    }
});

test('heavy collection requires an open pane and follows only its selected session', async () => {
 const dir=await mkdtemp(path.join(os.tmpdir(),'hat-visible-'));
 const agents=['a','b'].map(id=>({pane_id:id,terminal_id:'t'+id,workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:id},focused:id==='a',revision:1}));
 const evidence=agents.map(a=>({id:a.pane_id,provider:'codex',cwd:'/fixture/'+a.pane_id,messages:[],tools:[],usage:[],goals:[],availability:'known'}));
 let detailed:any[]=[], sampleCalls=0;const processQueries:string[]=[],gitQueries:string[]=[];
 const index={setActiveRefs(){},setDetailedRefs(refs:any[]){detailed=refs;},refreshSnapshots:async()=>evidence,resolveSnapshotCached:(_p:string,r:any)=>evidence.find(e=>e.id===r.value),readTodoState:async()=>undefined,diagnostics:[],close(){}};
 const rpc={call:async(method:string,params:any)=>method==='session.snapshot'?{snapshot:{agents,protocol:22}}:method==='agent.get'?{agent:agents.find(a=>a.pane_id===params.target)}:method==='pane.process_info'?(processQueries.push(params.pane_id),{process_info:{foreground_processes:[{pid:params.pane_id==='a'?41:42,name:'codex'}]}}):{}};
 const sampler={sample:async()=>{sampleCalls++;return{platform:'fixture',bootId:'b',sampledAt:Date.now(),monotonicNs:String(BigInt(sampleCalls)*1000000000n),processes:[41,42].map(pid=>({pid,startTime:'1',cpuNs:'0',rssBytes:'100',name:'codex'}))};},close:async()=>{}};
 const git={get:async(cwd:string)=>{gitQueries.push(cwd);return{};},close(){}};
 const collector=new runtime.Collector({rpc,index,sampler,git,settings:{...settings,todosEnabled:false},stateDir:dir});
 try{
  await collector.init();await collector.refresh();await collector.sampleProcesses();assert.deepEqual(detailed,[]);assert.equal(sampleCalls,0);assert.deepEqual(gitQueries,[]);
  collector.setVisibleSession('codex:a',true);await collector.refresh();await collector.sampleProcesses();assert.deepEqual(detailed,[{provider:'codex',kind:'id',value:'a'}]);assert.deepEqual(processQueries,['a','b'],'nonselected root is a cached attribution exclusion');assert.deepEqual(gitQueries,['/fixture/a']);
  collector.setVisibleSession('codex:b',true);await collector.refresh();await collector.sampleProcesses();assert.deepEqual(detailed,[{provider:'codex',kind:'id',value:'b'}]);assert.deepEqual(processQueries,['a','b','b']);assert.deepEqual(gitQueries,['/fixture/a','/fixture/b']);
  collector.setVisibleSession('codex:b',false);await collector.refresh();await collector.sampleProcesses();assert.deepEqual(detailed,[]);assert.equal(sampleCalls,2);assert.deepEqual(gitQueries,['/fixture/a','/fixture/b']);
 }finally{await collector.close();await rm(dir,{recursive:true,force:true});}
});

test('paused nested agent remains an exclusion boundary for selected parent Self+jobs',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'hat-exclusions-'));
 const agents=['parent','child'].map(id=>({pane_id:id,terminal_id:'t'+id,workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:id},focused:id==='parent',revision:1}));
 const evidence=agents.map(a=>({id:a.pane_id,parentId:a.pane_id==='child'?'parent':undefined,provider:'codex',messages:[],tools:[],usage:[{id:'usage',kind:'delta',input:10,output:1,includesChildren:false,contextUsed:a.pane_id==='parent'?100:900,contextLimit:1000,model:a.pane_id,timestamp:a.pane_id==='parent'?1:2,turnMs:a.pane_id==='parent'?1000:50}],goals:[],availability:'known'}));
 const index={setActiveRefs(){},setDetailedRefs(){},refreshSnapshots:async()=>evidence,resolveSnapshotCached:(_p:string,r:any)=>evidence.find(e=>e.id===r.value),diagnostics:[],close(){}};
 const rpc={call:async(method:string,params:any)=>method==='session.snapshot'?{snapshot:{agents,protocol:22}}:method==='agent.get'?{agent:agents.find(a=>a.pane_id===params.target)}:method==='pane.process_info'?{process_info:{foreground_processes:[{pid:params.pane_id==='parent'?41:42,name:'codex'}]}}:{}};
 let n=0;const sampler={sample:async()=>({platform:'fixture',bootId:'b',sampledAt:++n*1000,monotonicNs:String(BigInt(n)*1000000000n),processes:[{pid:41,ppid:1,startTime:'1',cpuNs:String(BigInt(n)*1000000000n),rssBytes:'100',name:'codex'},{pid:42,ppid:41,startTime:'2',cpuNs:String(BigInt(n)*1000000000n),rssBytes:'200',name:'codex'},{pid:43,ppid:42,startTime:'3',cpuNs:String(BigInt(n)*1000000000n),rssBytes:'300',name:'job'}]}),close:async()=>{}};
 const collector=new runtime.Collector({rpc,index,sampler,paneOpen:true,settings:{...settings,todosEnabled:false},stateDir:dir});
 try{await collector.init();await collector.refresh();await collector.sampleProcesses();await collector.sampleProcesses();const parent=collector.data.sessions.find((s:any)=>s.key==='codex:parent');assert.equal(parent.resource.memoryBytes,'100');assert.equal(parent.resource.cpuPercent,100);assert.deepEqual(parent.resource.processes.map((p:any)=>p.pid),[41]);collector.setScope(true);assert.equal(parent.resource.memoryBytes,'600');assert.equal(parent.usage.contextUsed,100);assert.equal(parent.usage.model,'parent');assert.equal(parent.usage.turnMs,1000);}finally{await collector.close();await rm(dir,{recursive:true,force:true});}
});

test('closing during Todo hydration prevents starting later Git work and hidden inventory reads',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'hat-gate-race-'));
 let release!:()=>void,entered!:()=>void;const blocked=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);let scans=0,gitCalls=0;
 const evidence={id:'a',provider:'codex',cwd:dir,messages:[],tools:[],usage:[],goals:[],availability:'known'};
 const agent={pane_id:'a',terminal_id:'ta',workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:'a'},focused:true,revision:1};
 const index={setActiveRefs(){},setDetailedRefs(){},refreshSnapshots:async()=>{scans++;return[evidence];},resolveSnapshotCached:()=>evidence,readTodoState:async()=>{entered();await blocked;return undefined;},diagnostics:[],close(){}};
 const rpc={call:async()=>({snapshot:{agents:[agent],protocol:22}})};
 const git={get:async()=>{gitCalls++;return{};},close(){}};
 const sampler={sample:async()=>{throw Error('should not sample');},close:async()=>{}};
 const collector=new runtime.Collector({rpc,index,git,sampler,paneOpen:true,settings,stateDir:dir});
 try{await collector.init();const refresh=collector.refresh();await started;collector.setVisibleSession('codex:a',false);release();await refresh;assert.equal(gitCalls,0);await collector.refresh();assert.equal(scans,1,'hidden refresh must only reconcile lightweight Herdr inventory');}finally{release();await collector.close();await rm(dir,{recursive:true,force:true});}
});

test('reopening recovers a complete ACTION list outside the hot message window',async()=>{
 const fs=await import('node:fs/promises');const dir=await mkdtemp(path.join(os.tmpdir(),'hat-resume-todo-'));
 const file=path.join(dir,'codex','sessions','a.jsonl');await mkdir(path.dirname(file),{recursive:true});
 const message=(id:string,text:string)=>JSON.stringify({type:'response_item',payload:{type:'message',id,role:'assistant',channel:'final',content:[{type:'output_text',text}]}})+'\n';
 await writeFile(file,JSON.stringify({type:'session_meta',payload:{id:'a',source:'cli'}})+'\n'+message('old','ACTION: Old task'));
 const agent={pane_id:'a',terminal_id:'ta',workspace_id:'w',tab_id:'tab',agent:'codex',agent_status:'working',agent_session:{kind:'id',value:'a'},focused:true,revision:1};
 const rpc={call:async()=>({snapshot:{agents:[agent],protocol:22}})};
 const index=new ProviderIndex({codexHome:path.join(dir,'codex'),claudeHome:path.join(dir,'no-claude'),piHome:path.join(dir,'no-pi')});
 const collector=new runtime.Collector({rpc,index,paneOpen:true,settings,stateDir:path.join(dir,'state')});
 try{await collector.init();await collector.refresh();assert.equal(collector.data.sessions[0].todos[0].text,'Old task');collector.setVisibleSession('codex:a',false);await collector.refresh();await fs.appendFile(file,message('new','ACTION: New task')+Array.from({length:201},(_,i)=>message('after-'+i,'No action here')).join(''));collector.setVisibleSession('codex:a',true);await collector.refresh();assert.equal(collector.data.sessions[0].todos[0].text,'New task');assert.equal(collector.data.sessions[0].todoSourceMessageId,'new');await fs.appendFile(file,message('burst','ACTION: Burst task')+Array.from({length:201},(_,i)=>message('burst-after-'+i,'No action here')).join(''));await collector.refresh();assert.equal(collector.data.sessions[0].todos[0].text,'Burst task','overflow while selected must recover complete ACTION state');}finally{await collector.close();await rm(dir,{recursive:true,force:true});}
});
