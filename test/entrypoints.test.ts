import {freshPrivateDirectory} from './helpers/private-dir.ts';
import{test}from'node:test';import assert from'node:assert/strict';
const action=await import('../src/runtime/actions.ts').catch(()=>({}))as any;
test('right-panel open uses manifest entrypoint and preserves native focus',async()=>{
 assert.equal(typeof action.openPanel,'function','panel action missing');const calls:any[]=[];const rpc={call:async(method:string,params:any)=>{calls.push({method,params});if(method==='session.snapshot')return{snapshot:{focused_pane_id:'w:p',agents:[{pane_id:'w:p'}]}};if(method==='plugin.pane.open')return{plugin_pane:{pane:{pane_id:'w:panel'}}};return{};}};
 await action.openPanel(rpc,{targetPaneId:'w:p'});assert.deepEqual(calls.at(-1),{method:'plugin.pane.open',params:{plugin_id:'iob.herdr-prism',entrypoint:'inspector',placement:'split',direction:'right',target_pane_id:'w:p',focus:false,...(process.platform==='win32'?{env:action.windowsPaneEnvironment()}: {})}});
});
test('CLI arguments retain path spelling and refuse missing option values',()=>{
 assert.equal(typeof action.parseArguments,'function','action parser missing');const args=action.parseArguments(['configure','--config-path','C:\\Users\\A B\\herdr.toml','--own-native']);assert.equal(args.command,'configure');assert.equal(args.options['config-path'],'C:\\Users\\A B\\herdr.toml');assert.equal(args.options['own-native'],true);assert.throws(()=>action.parseArguments(['configure','--config-path']),/value/);
});

test('inspector validation failures do not leak a collector lease',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');const {main}=await import('../src/entrypoints/inspector.ts');const {identityName}=await import('../src/state/store.ts');
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'hat-start-fail-'));try{const config=path.join(dir,'config'),state=path.join(dir,'state');await assert.rejects(main(['--config-dir',config,'--state-dir',state,'--socket=']),/HERDR_SOCKET_PATH/);const serverDir=path.join(state,'servers',identityName('no-server'));await assert.rejects(fs.lstat(path.join(serverDir,'collector.lock')),/ENOENT/);const corruptDir=path.join(state,'servers',identityName('unused'));await (await import('../src/config/safe-file.ts')).privateDir(corruptDir);await fs.writeFile(path.join(corruptDir,'preferences.json'),'bad');await assert.rejects(main(['--config-dir',config,'--state-dir',state,'--socket','unused']),/JSON/);await assert.rejects(fs.lstat(path.join(corruptDir,'collector.lock')),/ENOENT/);}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('open action awaits the shared view request and propagates failure without creating a duplicate',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {main}=await import('../src/entrypoints/action.ts'),{HerdrClient}=await import('../src/herdr/client.ts'),{MailboxClient}=await import('../src/state/mailbox.ts'),{StateStore,identityName}=await import('../src/state/store.ts');
 const originalCall=HerdrClient.prototype.call,originalClose=HerdrClient.prototype.close,originalRequest=MailboxClient.prototype.request;
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'prism-open-action-'));let closed=false,fail=false,requests=0;
 try{
  await new StateStore(path.join(dir,'state','servers',identityName('fixture'))).write('controller',{token:'fixture',pid:process.pid,kind:'collector-service'});
  HerdrClient.prototype.close=function(){closed=true;};
  (HerdrClient.prototype as any).call=async(method:string)=>{assert.equal(method,'session.snapshot');return{snapshot:{focused_pane_id:'claude'}};};
  (MailboxClient.prototype as any).request=async(op:string,p:any)=>{
   if(op==='ping')return{kind:'collector-service',ready:true,stale:false};
   assert.equal(op,'open-view');assert.equal(p.targetPaneId,'claude');requests++;await new Promise(r=>setTimeout(r,30));assert.equal(closed,false);if(fail)throw Error('fixture view denied');return{opened:true};
  };
  const args=['open','--config-dir',path.join(dir,'config'),'--state-dir',path.join(dir,'state'),'--socket','fixture'];
  assert.deepEqual(await main(args),{opened:true});assert.equal(closed,true);
  closed=false;fail=true;await assert.rejects(main(args),/fixture view denied/);assert.equal(requests,2);assert.equal(closed,true);
 }finally{HerdrClient.prototype.call=originalCall;HerdrClient.prototype.close=originalClose;MailboxClient.prototype.request=originalRequest;await fs.rm(dir,{recursive:true,force:true});}
});
