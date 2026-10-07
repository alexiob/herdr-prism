import {openPanel} from '../src/runtime/actions.ts';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, rm, mkdir, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { StateStore, identityName } from '../src/state/store.ts';
import { MailboxServer } from '../src/state/mailbox.ts';
import { deactivate, managedRequest, acknowledge, activate } from '../src/runtime/lifecycle.ts';
import { clearPublication } from '../src/native/publisher.ts';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
test('removal awaits actual collector cleanup, restores original config and guards other metadata', async () => {
    const dir = await freshPrivateDirectory(path.join(os.tmpdir(), 'hat-live-'));
    const stateDir = path.join(dir, 'state'), configDir = path.join(dir, 'config'), configPath = path.join(dir, 'config.toml'), endpoint = 'test-socket', serverStateDir = path.join(stateDir, 'servers', identityName(endpoint));
    const context = { stateDir, configDir, configPath, endpoint, serverStateDir };
    const { configure } = await import('../src/config/index.ts');
    const original = '# preserved\n[ui.sidebar.agents]\nrows = [["agent"]]\n';
    await writeFile(configPath, original);
    await configure(configPath, stateDir, { ownNative: true });
    const store = new StateStore(serverStateDir), lease = await store.acquire();
    await store.write('server', { endpoint });
    await store.write('controller', { pid: process.pid, token: lease.token, paneId: 'owned', terminalId: 'own-term' });
    await store.write('publication', [{ paneId: 'agent', terminalId: 'agent-term', hashes: { hat_load: sha('own'), hat_goal: sha('old') } }]);
    let closed = false;
    const server = new MailboxServer(serverStateDir, lease.token, async (op) => { if (op === 'shutdown') {
        setTimeout(() => void (async () => { await server.close(); await store.remove('controller'); await lease.release(); closed = true; })(), 60);
        return { stopping: true };
    } return { alive: true }; });
    await server.start();
    const calls: any[] = [];
    const rpc = { call: async (method: string, params: any): Promise<any> => { assert.equal(closed, true, 'RPC cleanup must follow completed collector shutdown'); calls.push({ method, params }); if(method==='session.snapshot')return{snapshot:{panes:[{pane_id:'owned',terminal_id:'own-term'}]}};if (method === 'pane.get')
            return { pane: { terminal_id: 'agent-term', tokens: { hat_load: 'own', hat_goal: 'user changed', foreign: 'safe' } } }; return {}; } };
    try {
        const result = await deactivate(context, rpc, { timeoutMs: 3000 });
        assert.equal(result.deactivated, true);
        assert.equal(closed, true);
        assert.equal(await readFile(configPath, 'utf8'), original);
        const report = calls.find(c => c.method === 'pane.report_metadata');
        assert.deepEqual(report.params.tokens, { hat_load: null });
        assert.deepEqual(calls.find(c => c.method === 'agent.view.clear').params, { source: 'plugin:iob.herdr-prism' });
    }
    finally {
        await server.close();
        await lease.release();
        await rm(dir, { recursive: true, force: true });
    }
});
test('ownership cleanup rejects a reused terminal and managed acknowledgement cannot accept another installation', async () => {
    const calls: any[] = [];
    await clearPublication({ call: async (m, p): Promise<any> => { calls.push([m, p]); return { pane: { terminal_id: 'replacement', tokens: { hat_load: 'same' } } }; } }, [{ paneId: 'old', terminalId: 'gone', hashes: { hat_load: sha('same') } }]);
    assert.equal(calls.length, 1);
    const root = await freshPrivateDirectory(path.join(os.tmpdir(), 'hat-receipt-'));
    try {
        const receipt = { version: 1, pluginId: 'iob.herdr-prism', token: '1234567890123456', installRoot: root };
        await writeFile(path.join(root, '.hat-managed-install.json'), JSON.stringify(receipt));
        const request = { ...receipt, requestId: 'a', operation: 'activate', mode: 'overview' };
        await writeFile(path.join(root, '.hat-lifecycle-request.json'), JSON.stringify(request));
        const accepted = await managedRequest(root, 'activate');
        assert.ok(accepted);
        await acknowledge(root, accepted!, { ok: true, result: { activated: true } });
        assert.equal(JSON.parse(await readFile(path.join(root, '.hat-lifecycle-result.json'), 'utf8')).requestId, 'a');
        assert.equal(await managedRequest(root, 'deactivate'), undefined);
        await writeFile(path.join(root, '.hat-lifecycle-request.json'), JSON.stringify({ ...request, token: 'foreign' }));
        await assert.rejects(managedRequest(root, 'activate'), /Invalid/);
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test('live activation waits for authenticated ready pane and marks only owned directories', async () => {
    const dir = await freshPrivateDirectory(path.join(os.tmpdir(), 'hat-active-'));
    const context = { stateDir: path.join(dir, 'state'), configDir: path.join(dir, 'config'), configPath: path.join(dir, 'config.toml'), endpoint: 'test', serverStateDir: path.join(dir, 'state', 'servers', identityName('test')) };
    const {privateDir}=await import('../src/config/safe-file.ts');await privateDir(context.stateDir);await privateDir(context.configDir);const savedEnv={HERDR_PLUGIN_ID:process.env.HERDR_PLUGIN_ID,HERDR_PLUGIN_CONFIG_DIR:process.env.HERDR_PLUGIN_CONFIG_DIR,HERDR_PLUGIN_STATE_DIR:process.env.HERDR_PLUGIN_STATE_DIR};process.env.HERDR_PLUGIN_ID='iob.herdr-prism';process.env.HERDR_PLUGIN_CONFIG_DIR=context.configDir;process.env.HERDR_PLUGIN_STATE_DIR=context.stateDir;
    const store = new StateStore(context.serverStateDir);
    let ready = true, frontendReady=false, timer:NodeJS.Timeout|undefined, server: MailboxServer | undefined;
    const root = path.join(dir, 'managed');
    await mkdir(root);
    const request: any = { version: 1, pluginId: 'iob.herdr-prism', token: '1234567890123456', requestId: 'x', operation: 'activate', mode: 'inspector-only' };
    const rpc = { call: async (method: string): Promise<any> => { if (method === 'session.snapshot')
            return { snapshot: { focused_pane_id: 'agent',panes:[{pane_id:'panel',terminal_id:'panel-term',tab_id:'tab'}] } }; if (method === 'plugin.pane.open') {
            await store.write('controller', { token: 'controller-token', pid: process.pid });
            server = new MailboxServer(context.serverStateDir, 'controller-token', async (op) => op === 'ping' ? { ready, stale: !ready } : { paneId: 'panel' });
            await server.start();
            await store.write('views',[{paneId:'panel',terminalId:'panel-term',targetTerminalId:'agent-term',tabId:'tab',open:true,pid:process.pid,ready:false}]);
            timer=setTimeout(()=>{frontendReady=true;void store.write('views',[{paneId:'panel',terminalId:'panel-term',targetTerminalId:'agent-term',tabId:'tab',open:true,pid:process.pid,ready:true}]);},150);
            return{plugin_pane:{plugin_id:'iob.herdr-prism',entrypoint:'inspector',pane:{pane_id:'panel',terminal_id:'panel-term'}}};
        } return {}; } };
    try {
        const result = await activate(context, rpc, { openView:()=>openPanel(rpc), mode: 'inspector-only', request, root, timeoutMs: 3000 });
        assert.equal(result.activated, true);
        assert.equal(ready, true);
        assert.equal(frontendReady,true,'a ready collector cannot stand in for an unpainted frontend');
        const owner = JSON.parse(await readFile(path.join(context.stateDir, '.hat-lifecycle-owner.json'), 'utf8'));
        assert.equal(owner.token, request.token);
        assert.equal(owner.installRoot, root);
        const settings = JSON.parse(await readFile(path.join(context.configDir, 'settings.json'), 'utf8'));
        assert.equal(settings.autostart, true);
        assert.equal(settings.nativeMode, 'inspector-only');
        assert.match(await readFile(context.configPath,'utf8'),/key = "prefix\+i"/,'activation restores the free default shortcut without an installer request');
    }
    finally {
        clearTimeout(timer);
        await server?.close();for(const[key,value]of Object.entries(savedEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
        await rm(dir, { recursive: true, force: true });
    }
});
test('all live endpoints reload only after restoration and delayed startup cannot recreate purged state',async()=>{
 const {acquireAdmission}=await import('../src/runtime/admission.ts');const {configure}=await import('../src/config/index.ts');const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'hat-multi-'));const context={stateDir:path.join(dir,'state'),configDir:path.join(dir,'config'),configPath:path.join(dir,'config.toml'),endpoint:'primary',serverStateDir:path.join(dir,'state','servers',identityName('primary'))};const original='[ui.sidebar.agents]\nrows = [["agent"]]\n';await writeFile(context.configPath,original);await configure(context.configPath,context.stateDir,{ownNative:true});await new StateStore(path.join(context.stateDir,'servers',identityName('secondary'))).write('server',{endpoint:'secondary'});const reloads:string[]=[];
 const client=(endpoint:string)=>({call:async(method:string):Promise<any>=>{if(method==='server.reload_config'){assert.equal(await readFile(context.configPath,'utf8'),original,'secondary clients must reload restored config');reloads.push(endpoint);}return{};},close(){}});
 try{await deactivate(context,client('primary'),{rpcFactory:client});assert.deepEqual(new Set(reloads),new Set(['primary','secondary']));await assert.rejects(acquireAdmission(context.stateDir),/deactivated/);await rm(context.stateDir,{recursive:true});await assert.rejects(acquireAdmission(context.stateDir),/ENOENT/);await assert.rejects(lstat(context.stateDir),/ENOENT/);}finally{await rm(dir,{recursive:true,force:true});}
});

test('reactivation closes every recorded old owned pane before opening replacement and removal closes replacement',async t=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'hat-restart-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const context={stateDir:path.join(dir,'state'),configDir:path.join(dir,'config'),configPath:path.join(dir,'config.toml'),endpoint:'restart',serverStateDir:path.join(dir,'state','servers',identityName('restart'))};
 const store=new StateStore(context.serverStateDir);const servers:MailboxServer[]=[];t.after(async()=>{for(const server of servers)await server.close();});
 const start=async(token:string,paneId:string,terminalId:string)=>{await store.write('controller',{token,pid:process.pid,paneId,terminalId});let server:MailboxServer;server=new MailboxServer(context.serverStateDir,token,async op=>{if(op==='shutdown'){setTimeout(()=>void(async()=>{await server.close();await store.remove('controller');})(),30);return{stopping:true};}return{ready:true,stale:false};});servers.push(server);await server.start();};
 await store.write('pane',{paneId:'persisted-old',terminalId:'persisted-term'});await start('old-token','controller-old','controller-term');
 const panes=[{pane_id:'agent',terminal_id:'agent-term',tab_id:'tab'},{pane_id:'persisted-old',terminal_id:'persisted-term',tab_id:'tab'},{pane_id:'controller-old',terminal_id:'controller-term',tab_id:'tab'},{pane_id:'foreign',terminal_id:'foreign-term',tab_id:'tab'}];const closed:string[]=[];
 const rpc={call:async(method:string,params:any={}):Promise<any>=>{if(method==='session.snapshot')return{snapshot:{focused_pane_id:'agent',panes}};if(method==='plugin.pane.close'){closed.push(params.pane_id);panes.splice(panes.findIndex(p=>p.pane_id===params.pane_id),1);}if(method==='plugin.pane.open'){assert.deepEqual(new Set(closed),new Set(['persisted-old','controller-old']),'all old owned panes close before marker is replaced');const pane={pane_id:'replacement',terminal_id:'replacement-term',tab_id:'tab'};panes.push(pane);await store.write('pane',{paneId:'replacement',terminalId:'replacement-term'});await store.write('views',[{paneId:pane.pane_id,terminalId:pane.terminal_id,tabId:pane.tab_id,targetTerminalId:'agent-term',pid:process.pid,open:true,ready:true}]);await start('new-token','replacement','replacement-term');return{plugin_pane:{plugin_id:'iob.herdr-prism',entrypoint:'inspector',pane}};}return{};}};
 await activate(context,rpc,{openView:()=>openPanel(rpc),mode:'inspector-only',timeoutMs:3000});await deactivate(context,rpc,{timeoutMs:3000});assert.deepEqual(new Set(closed),new Set(['persisted-old','controller-old','replacement']));assert.ok(panes.some(p=>p.pane_id==='foreign'));assert.ok(panes.some(p=>p.pane_id==='agent'));
});

test('failed inspector startup retains authoritative opened-pane identity for complete cleanup',async t=>{
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'hat-start-failure-'));t.after(()=>rm(dir,{recursive:true,force:true}));const context={stateDir:path.join(dir,'state'),configDir:path.join(dir,'config'),configPath:path.join(dir,'config.toml'),endpoint:'failed-start',serverStateDir:path.join(dir,'state','servers',identityName('failed-start'))};const store=new StateStore(context.serverStateDir);await store.init();const closed:string[]=[];const pane={pane_id:'never-started',terminal_id:'never-started-term'};
 await store.write('pane',{paneId:'reused',terminalId:'gone-term'});
 const rpc={call:async(method:string,params:any={}):Promise<any>=>{if(method==='session.snapshot')return{snapshot:{focused_pane_id:'agent',panes:[pane,{pane_id:'reused',terminal_id:'replacement-term'}]}};if(method==='plugin.pane.open')return{plugin_pane:{plugin_id:'iob.herdr-prism',entrypoint:'inspector',pane}};if(method==='plugin.pane.close')closed.push(params.pane_id);return{};}};
 await assert.rejects(activate(context,rpc,{openView:()=>openPanel(rpc),mode:'inspector-only',timeoutMs:150}),/did not become ready/);assert.deepEqual(await store.read('pane'),{paneId:pane.pane_id,terminalId:pane.terminal_id});await deactivate(context,rpc,{timeoutMs:150});assert.deepEqual(closed,['never-started']);
});


test('explicit shortcut opt-out survives ordinary reactivation until explicitly enabled',async t=>{
 const {shortcutPreference}=await import('../src/runtime/lifecycle.ts');const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-shortcut-pref-'));t.after(()=>rm(dir,{recursive:true,force:true}));const config=new StateStore(dir);
 assert.equal(await shortcutPreference(config),true);assert.equal(await shortcutPreference(config,false),false);assert.equal(await shortcutPreference(new StateStore(dir)),false);assert.equal(await shortcutPreference(config,true),true);assert.equal(await shortcutPreference(new StateStore(dir)),true);
});
