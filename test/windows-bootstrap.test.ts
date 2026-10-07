import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore dependency-free platform bootstrap
import {bootstrapWindows} from '../scripts/bootstrap-windows.mjs';

function fixture(){
 let plugins:any[]=[];const calls:any[]=[];
 return{calls,setPlugins:(value:any[])=>{plugins=value;},options:{platform:'win32',arch:'x64',root:'/reviewed-source',herdrBin:'C:\\Herdr\\herdr.exe',nodeBin:'C:\\Node Runtime\\node.exe',session:'work',revision:'a'.repeat(40),
  run:async(args:string[])=>{calls.push(args);if(args[0]==='--version')return 'herdr 0.9.3';if(args[0]==='status')return JSON.stringify({running:true,version:'0.9.3',protocol:22});if(args[0]==='plugin')return JSON.stringify({result:{type:'plugin_list',plugins}});throw Error('unexpected command');},
  stage:async(options:any)=>{assert.deepEqual(options.platforms,['win32-x64']);assert.equal(options.nodeBin,'C:\\Node Runtime\\node.exe');assert.equal(options.helperSource,'bin');},
 }};
}
test('Windows bootstrap installs a checked release with the verified absolute runtime',async()=>{
 const f=fixture();let installed=false;
 const result=await bootstrapWindows({...f.options,inspectorOnly:true,install:async(options:any)=>{installed=true;assert.equal(options.inspectorOnly,true);assert.equal(options.shortcut,true);assert.equal(options.session,'work');return{activated:true};}});
 assert.equal(installed,true);assert.equal(result.activated,true);
});
test('Windows bootstrap rerun uses the same preserving updater without overriding saved preferences',async()=>{
 const f=fixture();f.setPlugins([{plugin_id:'iob.herdr-prism',plugin_root:'C:\\Installed Prism'}]);let updated=false;
 const result=await bootstrapWindows({...f.options,inspectorOnly:true,install:async()=>{throw Error('must not reinstall');},update:async(options:any)=>{
  updated=true;assert.equal(options.root,'/reviewed-source');assert.equal(options.revision,'a'.repeat(40));assert.equal(options.info.plugin_root,'C:\\Installed Prism');assert.equal(options.inspectorOnly,undefined);assert.equal(options.shortcut,undefined);return{updated:true,version:'0.5.0'};
 }});
 assert.equal(updated,true);assert.equal(result.updated,true);
});
test('Windows bootstrap refuses unavailable or incompatible servers before staging or updating',async()=>{
 const f=fixture();const stage=async()=>{throw Error('must not stage');};
 await assert.rejects(bootstrapWindows({...f.options,stage,run:async()=>JSON.stringify({running:false})}),/Herdr.*version/);
 await assert.rejects(bootstrapWindows({...f.options,stage,run:async(args:string[])=>args[0]==='--version'?'herdr 0.9.3':JSON.stringify({running:false})}),/not running|Start Herdr/i);
 await assert.rejects(bootstrapWindows({...f.options,stage,session:'--bad'}),/session/i);
});
