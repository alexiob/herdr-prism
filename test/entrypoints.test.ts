import {freshPrivateDirectory} from './helpers/private-dir.ts';
import{test}from'node:test';import assert from'node:assert/strict';
const action=await import('../src/runtime/actions.ts').catch(()=>({}))as any;
test('right-panel open uses manifest entrypoint and preserves native focus',async()=>{
 assert.equal(typeof action.openPanel,'function','panel action missing');const calls:any[]=[];const rpc={call:async(method:string,params:any)=>{calls.push({method,params});if(method==='session.snapshot')return{snapshot:{focused_pane_id:'w:p',agents:[{pane_id:'w:p'}]}};if(method==='plugin.pane.open')return{plugin_pane:{pane:{pane_id:'w:panel'}}};return{};}};
 await action.openPanel(rpc,{targetPaneId:'w:p'});assert.deepEqual(calls.at(-1),{method:'plugin.pane.open',params:{plugin_id:'iob.herdr-prism',entrypoint:'inspector',placement:'split',direction:'right',target_pane_id:'w:p',focus:false}});
});
test('CLI arguments retain path spelling and refuse missing option values',()=>{
 assert.equal(typeof action.parseArguments,'function','action parser missing');const args=action.parseArguments(['configure','--config-path','C:\\Users\\A B\\herdr.toml','--own-native']);assert.equal(args.command,'configure');assert.equal(args.options['config-path'],'C:\\Users\\A B\\herdr.toml');assert.equal(args.options['own-native'],true);assert.throws(()=>action.parseArguments(['configure','--config-path']),/value/);
});
test('inspector validation failures do not leak a collector lease',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');const {main}=await import('../src/entrypoints/inspector.ts');const {identityName}=await import('../src/state/store.ts');
 const dir=await freshPrivateDirectory(path.join(os.tmpdir(),'hat-start-fail-'));try{const config=path.join(dir,'config'),state=path.join(dir,'state');await assert.rejects(main(['--config-dir',config,'--state-dir',state,'--socket=']),/HERDR_SOCKET_PATH/);const serverDir=path.join(state,'servers',identityName('no-server'));await assert.rejects(fs.lstat(path.join(serverDir,'collector.lock')),/ENOENT/);const corruptDir=path.join(state,'servers',identityName('unused'));await (await import('../src/config/safe-file.ts')).privateDir(corruptDir);await fs.writeFile(path.join(corruptDir,'preferences.json'),'bad');await assert.rejects(main(['--config-dir',config,'--state-dir',state,'--socket','unused']),/JSON/);await assert.rejects(fs.lstat(path.join(corruptDir,'collector.lock')),/ENOENT/);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
