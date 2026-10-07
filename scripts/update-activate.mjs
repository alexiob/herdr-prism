import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
/** A finite recovery helper may use reviewed lifecycle improvements, but every
 * surviving collector and inspector must be spawned from the restored runtime. */
export async function activateRestoredPrism({runtimeRoot,lifecycleRoot,mode='overview',ownNative=false,timeoutMs=60000}={}){
 runtimeRoot=resolve(runtimeRoot);lifecycleRoot=resolve(lifecycleRoot);
 const load=(root,file)=>import(pathToFileURL(join(root,'dist',file)).href);
 const [service,collector,client,lifecycle]=await Promise.all([load(runtimeRoot,'runtime/service.js'),load(runtimeRoot,'runtime/collector-service.js'),load(runtimeRoot,'herdr/client.js'),load(lifecycleRoot,'runtime/lifecycle.js')]);
 const context=await service.serviceContext({}),rpc=new client.HerdrClient(context.endpoint,{timeoutMs});
 try{return await lifecycle.activate(context,rpc,{mode,ownNative,timeoutMs,restoreViewsOnly:true,openView:target=>collector.openTabPanel(context,target),ensureCollector:()=>collector.ensureCollectorService(context)});}finally{rpc.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const arg=process.argv[i];if(arg==='--own-native')options.ownNative=true;else if(['--runtime-root','--lifecycle-root','--mode','--timeout-ms'].includes(arg)&&process.argv[i+1]){const key={'--runtime-root':'runtimeRoot','--lifecycle-root':'lifecycleRoot','--mode':'mode','--timeout-ms':'timeoutMs'}[arg];options[key]=arg==='--timeout-ms'?Number(process.argv[++i]):process.argv[++i];}else throw Error('Invalid recovery activation option');}
 try{console.log(JSON.stringify(await activateRestoredPrism(options)));}catch{console.error('Restored Prism activation failed');process.exitCode=1;}
}
