import {test} from 'node:test';import assert from 'node:assert/strict';import os from 'node:os';import path from 'node:path';import {rm} from 'node:fs/promises';
import {freshPrivateDirectory} from './helpers/private-dir.ts';import {Collector} from '../src/runtime/collector.ts';
const reporter=await import('../src/runtime/claude-account.ts').catch(()=>({})) as any;
test('Claude reporter retains only session-bound quota fields and strips credentials/extra payload',()=>{
 assert.equal(typeof reporter.claudeAccountPayload,'function');const p=reporter.claudeAccountPayload({session_id:'s',api_key:'SECRET',cwd:'/private',rate_limits:{five_hour:{used_percentage:75.5,resets_at:1791385200,secret:'SECRET'},spend_limit:{used_percentage:50,used_usd:20,limit_usd:40,period:'monthly'},secret:'SECRET'}});
 assert.equal(p.sessionId,'s');assert.equal(p.rateLimits.five_hour.used_percentage,75.5);assert.ok(!JSON.stringify(p).includes('SECRET'));assert.ok(!JSON.stringify(p).includes('/private'));assert.deepEqual(reporter.claudeAccountPayload({session_id:'s'}),{sessionId:'s',rateLimits:null});
});
test('Claude account reports attach only to exact live sessions and never start hidden detail work',async t=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-claude-account-'));t.after(()=>rm(dir,{recursive:true,force:true}));const agent:any={pane_id:'p',terminal_id:'t',agent:'claude',agent_status:'idle',agent_session:{kind:'id',value:'s'}};let reads=0;
 const collector=new Collector({rpc:{call:async(method:string)=>method==='session.snapshot'?{snapshot:{protocol:22,agents:[agent]}}:{}} as any,index:{setActiveRefs(){},setDetailedRefs(){},resolveSnapshotCached(){},refreshSnapshots:async()=>{reads++;return[];},diagnostics:[],close(){}} as any,settings:{nativeMode:'inspector-only',providerHomes:{},todosEnabled:false,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:true},stateDir:dir,sampler:{sample:async()=>{reads++;throw Error('hidden');},close:async()=>{}}});t.after(()=>collector.close());await collector.init();await collector.refresh();
 const c=collector as any;assert.equal(typeof c.reportAccountLimits,'function');assert.deepEqual(c.reportAccountLimits({sessionId:'other',rateLimits:{five_hour:{used_percentage:75}}}),{accepted:false});assert.deepEqual(c.reportAccountLimits({sessionId:'s',rateLimits:{five_hour:{used_percentage:75}}}),{accepted:true});assert.equal(collector.data.sessions[0].evidence.accountLimits!.windows[0]!.usedPercent,75);await collector.refresh();assert.equal(collector.data.sessions[0].evidence.accountLimits!.windows[0]!.usedPercent,75);assert.equal(reads,0);
 assert.deepEqual(c.reportAccountLimits({sessionId:'s',rateLimits:null}),{accepted:true});assert.equal(collector.data.sessions[0].evidence.accountLimits,undefined);
});

import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {lstat} from 'node:fs/promises';
async function entry(args:string[],input:string){return new Promise<{stdout:string;stderr:string;code:number|null}>((resolve,reject)=>{const p=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../src/entrypoints/claude-account.ts',import.meta.url)),...args],{stdio:'pipe',env:{...process.env,HERDR_SOCKET_PATH:'fixture-server'}});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);p.on('error',reject);p.on('close',code=>resolve({stdout,stderr,code}));p.stdin.end(input);});}
test('reporter cannot recreate removed state and passthrough preserves invalid and oversized input',async t=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-account-uninstalled-'));t.after(()=>rm(dir,{recursive:true,force:true}));const missing=path.join(dir,'removed');
 for(const text of [JSON.stringify({session_id:'s',rate_limits:{five_hour:{used_percentage:1}}}),'not-json','x'.repeat(1024*1024+1)]){const result=await entry(['--state-dir',missing,'--passthrough'],text);assert.equal(result.code,0);assert.equal(result.stderr,'');assert.equal(result.stdout,text);}
 await assert.rejects(lstat(missing),{code:'ENOENT'});
});
test('generated status-line configuration preserves explicit state directory and socket',async()=>{
 const result=await entry(['--print-config','--state-dir','/fixture/state with space','--socket','/fixture/server.sock'],'');assert.equal(result.code,0);const config=JSON.parse(result.stdout);assert.match(config.statusLine.command,/--socket/);assert.match(config.statusLine.command,/server\.sock/);assert.match(config.statusLine.command,/state with space/);assert.equal(config.statusLine.type,'command');
});
import {StateStore,identityName} from '../src/state/store.ts';import {MailboxServer} from '../src/state/mailbox.ts';import {randomUUID} from 'node:crypto';
test('reporter submits normalized fields through an existing authenticated collector and respects deactivation',async t=>{
 const stateDir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-account-mailbox-'));t.after(()=>rm(stateDir,{recursive:true,force:true}));const endpoint='fixture-endpoint',token=randomUUID(),dir=path.join(stateDir,'servers',identityName(endpoint));const store=new StateStore(dir);await store.write('controller',{token,pid:process.pid,kind:'collector-service',endpoint});
 let payload:any;const server=new MailboxServer(dir,token,async(op,p)=>{assert.equal(op,'account-report');payload=p;return{accepted:true};});await server.start();t.after(()=>server.close());
 assert.equal(await reporter.submitClaudeAccount(stateDir,endpoint,{session_id:'s',api_key:'SECRET',rate_limits:{five_hour:{used_percentage:5,secret:'SECRET'}}}),true);assert.equal(payload.sessionId,'s');assert.equal(payload.rateLimits.five_hour.used_percentage,5);assert.ok(!JSON.stringify(payload).includes('SECRET'));
 await new StateStore(stateDir).write('lifecycle',{disabled:true});await assert.rejects(reporter.submitClaudeAccount(stateDir,endpoint,{session_id:'s',rate_limits:null}),/deactivated/);
});
