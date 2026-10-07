import { createHash } from 'node:crypto';
import { lstat, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicWrite, privateDir, readOptional, restrict } from './safe-file.ts';
import { scanToml, put, replaceValues } from './toml.ts';
import {normalizeTabOrder} from './tab-order.ts';
import {normalizeNativeGrouping} from './native-grouping.ts';
import type {NativeGrouping} from './native-grouping.ts';
import type {Tab} from '../tui/types.ts';
import { shortcutDecision } from './shortcut.ts';
export { privateDir as ensurePrivateDir } from './safe-file.ts';
export interface Settings {ui?:{tabOrder?:Tab[];nativeGrouping?:NativeGrouping}; nativeMode:'overview'|'inspector-only'|'native';providerHomes:{codex?:string;claude?:string;pi?:string};todosEnabled:boolean;sampleIntervalMs:number;follow:boolean;ascii:boolean;monochrome:boolean;autostart?:boolean;theme?:'dark'|'light'|'mono';costRates?:Record<string,{input?:number;output?:number;cacheRead?:number;cacheWrite?:number;currency:string}>; }
const defaults:Settings={nativeMode:'overview',providerHomes:{},todosEnabled:true,sampleIntervalMs:2000,follow:true,ascii:false,monochrome:false,ui:{tabOrder:normalizeTabOrder(undefined),nativeGrouping:normalizeNativeGrouping(undefined)}};
export async function loadSettings(configDir:string):Promise<Settings>{const text=await readOptional(join(configDir,'settings.json'));if(!text)return {...defaults,providerHomes:{},ui:{tabOrder:normalizeTabOrder(undefined),nativeGrouping:normalizeNativeGrouping(undefined)}};const value:unknown=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Settings must be an object');const data=value as Record<string,unknown>;const result={...defaults,...data} as Settings;if(data.ui!==undefined&&(!data.ui||typeof data.ui!=='object'||Array.isArray(data.ui)))throw new Error('Invalid ui settings section');result.ui={...(data.ui as Settings['ui']??{}),tabOrder:normalizeTabOrder((data.ui as Settings['ui'])?.tabOrder),nativeGrouping:normalizeNativeGrouping((data.ui as Settings['ui'])?.nativeGrouping)};if(!['overview','inspector-only','native'].includes(result.nativeMode))throw new Error('Invalid nativeMode');for(const key of ['todosEnabled','follow','ascii','monochrome'] as const)if(typeof result[key]!=='boolean')throw new Error('Invalid setting '+key);if(result.theme!==undefined&&!['dark','light','mono'].includes(result.theme))throw new Error('Invalid theme');if(result.autostart!==undefined&&typeof result.autostart!=='boolean')throw new Error('Invalid autostart');if(!Number.isInteger(result.sampleIntervalMs)||result.sampleIntervalMs<250||result.sampleIntervalMs>60000)throw new Error('Invalid sampleIntervalMs');if(!result.providerHomes||typeof result.providerHomes!=='object'||Array.isArray(result.providerHomes))throw new Error('Invalid providerHomes');for(const [provider,path]of Object.entries(result.providerHomes))if(!['codex','claude','pi'].includes(provider)||typeof path!=='string'||path.includes('\0'))throw new Error('Invalid provider home');if(result.costRates){if(typeof result.costRates!=='object'||Array.isArray(result.costRates))throw new Error('Invalid costRates');for(const rates of Object.values(result.costRates)){if(!rates||typeof rates!=='object')throw new Error('Invalid costRates');if(typeof rates.currency!=='string'||!rates.currency.trim())throw new Error('Cost rate requires currency');for(const [key,rate]of Object.entries(rates))if(key!=='currency'&&(!['input','output','cacheRead','cacheWrite'].includes(key)||typeof rate!=='number'||!Number.isFinite(rate)||rate<0))throw new Error('Invalid cost rate');}}return result;}
export type NativeToken=string|{token:string;fg?:string;bold?:boolean;dim?:boolean;rules?:{equals:string;hide:boolean}[]};
export function nativeRows(theme:'dark'|'light'|'mono'='dark'):NativeToken[][]{
 const light=theme==='light',mono=theme==='mono';
 const style=(token:string,fg:string,bold=false,optional=false):NativeToken=>({token,...(!mono?{fg}:{}),bold,dim:false,...(optional?{rules:[{equals:'',hide:true}]}:{})});
 return [['state_icon',style('agent',light?'#202938':'#D6DFE8',true),style('tab',light?'#374151':'#B7C9DA')],
 [style('$hat_group',light?'#155E75':'#64D9E9',true,true)],
 [style('$hat_attention',light?'#854D0E':'#F2C66D',true,true)],
 [style('$hat_load',light?'#202938':'#D6DFE8')],
 ['machine',style('$hat_branch',light?'#5B317B':'#C6AFE2'),style('$hat_add',light?'#166534':'#61C28A',true,true),style('$hat_del',light?'#9F1239':'#F18B96',true,true),style('$hat_conflict',light?'#854D0E':'#F2C66D',true,true),style('$hat_harness',light?'#5D6875':'#92A0AF')]];
}
function inlineToml(value:unknown):string {if(Array.isArray(value))return '['+value.map(inlineToml).join(', ')+']';if(value&&typeof value==='object')return '{ '+Object.entries(value).map(([key,v])=>key+' = '+inlineToml(v)).join(', ')+' }';return JSON.stringify(value);}
function rowsToml(theme?:'dark'|'light'|'mono'){return '[\n'+nativeRows(theme).map(row=>'  '+inlineToml(row)).join(',\n')+'\n]';}
export interface ConfigureOptions { mode?:Settings['nativeMode'];ownNative?:boolean;keybindings?:Record<string,string>;pluginActionKey?:{key:string;command:string;description?:string};shortcutIfFree?:boolean;theme?:'dark'|'light'|'mono';beforeCommit?:()=>Promise<unknown>;migrateOwnedNative?:boolean;preserveNativeEdits?:boolean; }
export interface ConfigResult { changed:boolean;conflicts:string[];backupPath?:string;shortcut?:'configured'|'existing'|'conflict'; }
interface ManagedValue {path:string;original?:string;written:string;}
function removeEmptyOwnedTables(text:string,original:string,values:ManagedValue[],conflicts:string[]):string {
 const initial=new Set(scanToml(original).tables.map(t=>t.path));
 const created=new Set(values.filter(v=>v.original===undefined).map(v=>v.path.slice(0,v.path.lastIndexOf('.'))).filter(p=>!initial.has(p)));
 const doc=scanToml(text);return replaceValues(text,doc.tables.filter(t=>created.has(t.path)&&!conflicts.some(p=>p.startsWith(t.path+'.'))&&text.slice(t.end,t.bodyEnd).replace(/^[ \t]*#.*$/gm,'').trim()==='').map(t=>({start:t.start,end:t.end,text:''})));
}
interface Manifest {version:1;configPath:string;original:string;originalHash:string;writtenHash:string;backupPath:string;values:ManagedValue[];blocks?:string[];partial?:boolean;}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function withLock<T>(stateDir:string,operation:()=>Promise<T>){await privateDir(stateDir);const path=join(stateDir,'configuration.lock');let handle;try{handle=await open(path,'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('Another configuration operation is running; retry after it completes');throw error;}try{await restrict(path);return await operation();}finally{await handle.close();await unlink(path).catch(()=>{});}}
function manifestPath(stateDir:string){return join(stateDir,'configuration.json');}
async function readManifest(stateDir:string):Promise<Manifest|undefined>{const text=await readOptional(manifestPath(stateDir));if(!text)return;const data=JSON.parse(text) as Manifest;if(data.version!==1||typeof data.configPath!=='string'||typeof data.original!=='string'||typeof data.backupPath!=='string'||!Array.isArray(data.values)||data.values.some(x=>!x||typeof x.path!=='string'||typeof x.written!=='string'||(x.original!==undefined&&typeof x.original!=='string')))throw new Error('Invalid configuration ownership manifest');return data;}
async function writeConfig(path:string,before:string,after:string,hook?:()=>Promise<unknown>){let mode=0o600;try{mode=(await lstat(path)).mode&0o777;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await atomicWrite(path,after,mode,async()=>{await hook?.();if(hash(await readOptional(path))!==hash(before))throw new Error('Configuration changed concurrently; no replacement performed');});}
export async function configure(configPath:string,stateDir:string,options:ConfigureOptions={}):Promise<ConfigResult>{
 if(options.mode==='inspector-only'&&!options.pluginActionKey)return {changed:false,conflicts:[]};
 return withLock(stateDir,async()=>{
  const path=resolve(configPath),before=await readOptional(path),doc=scanToml(before),old=await readManifest(stateDir);
  if(old&&old.configPath!==path)throw new Error('State belongs to a different configuration path');
  if(options.migrateOwnedNative&&!old)return {changed:false,conflicts:[]};
  const conflicts:string[]=[];const desired=new Map<string,string>();
  if(options.mode!=='inspector-only'){
   desired.set('ui.sidebar.agents.rows',rowsToml(options.theme));
   desired.set('theme.custom.active_row_bg',JSON.stringify(options.theme==='light'?'#BDD0F5':'#203A47'));
   for(const entry of doc.entries)if(entry.path==='ui.sidebar.agents.rows_by_agent'||entry.path.startsWith('ui.sidebar.agents.rows_by_agent.'))desired.set(entry.path,entry.path==='ui.sidebar.agents.rows_by_agent'?'{}':rowsToml(options.theme));
  }
  for(const [key,action]of Object.entries(options.keybindings??{})){
   if(!/^[A-Za-z0-9_-]+$/.test(key)||typeof action!=='string'||action.includes('\0'))throw new Error('Invalid optional keybinding');
   desired.set('keys.'+key,JSON.stringify(action));
  }
  const values:ManagedValue[]=(old?.values??[]).filter(v=>!desired.has(v.path));let after=before;
  for(const [target,written]of desired){
   const current=doc.entries.find(e=>e.path===target)?.value,previous=old?.values.find(v=>v.path===target);
   const native=target.startsWith('ui.sidebar.agents.')||target==='theme.custom.active_row_bg';
   if(native&&(options.migrateOwnedNative&&(!previous||current!==previous.written)||options.preserveNativeEdits&&previous&&current!==previous.written)){if(previous){conflicts.push(target);values.push(previous);}continue;}
   if(current!==undefined&&current!==written&&(!previous||current!==previous.written)&&!options.ownNative)throw new Error('Native sidebar/keybinding has existing ownership; choose ownNative explicitly or inspector-only');
   if(previous&&current!==previous.written&&current!==written)throw new Error('Managed configuration was edited by the user; unconfigure before replacing '+target);
   values.push({path:target,...((previous?.original??current)!==undefined?{original:previous?previous.original:current}:{}),written});after=put(after,target,written);
  }
  const blocks=[...(old?.blocks??[])];let shortcut:ConfigResult['shortcut'];
  if(options.pluginActionKey){
   const binding=options.pluginActionKey;
   for(const field of [binding.key,binding.command,binding.description??'Prism'])if(typeof field!=='string'||field.includes('\0')||field.length>256)throw new Error('Invalid plugin action key');
   const previous=blocks[0];
   if(previous&&!after.includes(previous))throw new Error('Plugin command binding was edited by user');
   const decision=shortcutDecision(doc,binding.key,binding.command);
   if(decision==='conflict'){
    if(!options.shortcutIfFree)throw new Error('Plugin shortcut conflicts with existing keys.command configuration');
    shortcut='conflict';
   }else if(decision==='existing'&&!previous)shortcut='existing';
   else {
    const block='\n# iob.herdr-prism command begin\n[[keys.command]]\nkey = '+JSON.stringify(binding.key)+'\ntype = "plugin_action"\ncommand = '+JSON.stringify(binding.command)+'\ndescription = '+JSON.stringify(binding.description??'Prism')+'\n# iob.herdr-prism command end\n';
    if(previous){after=after.replace(previous,block);blocks[0]=block;}
    else {if(after.includes('# iob.herdr-prism command begin'))throw new Error('Foreign plugin command marker');after+=block;blocks.push(block);}
    shortcut='configured';scanToml(after);
   }
  }
  if(after===before)return {changed:false,conflicts,...(old?{backupPath:old.backupPath}:{}),...(shortcut?{shortcut}:{})};
  const backupPath=old?.backupPath??join(stateDir,'configuration-original.toml');if(!old)await atomicWrite(backupPath,before);
  const manifest:Manifest={version:1,configPath:path,original:old?.original??before,originalHash:old?.originalHash??hash(before),writtenHash:hash(after),backupPath,values,blocks,partial:old?.partial===true||!!old&&hash(before)!==old.writtenHash||conflicts.length>0};
  await atomicWrite(manifestPath(stateDir),JSON.stringify(manifest,null,2)+'\n');
  try{await writeConfig(path,before,after,options.beforeCommit);}catch(error){if(old)await atomicWrite(manifestPath(stateDir),JSON.stringify(old,null,2)+'\n');else await unlink(manifestPath(stateDir)).catch(()=>{});throw error;}
  return {changed:true,conflicts,backupPath,...(shortcut?{shortcut}:{})};
 });
}
export async function unconfigure(configPath:string,stateDir:string):Promise<ConfigResult>{return withLock(stateDir,async()=>{const managed=await readManifest(stateDir);if(!managed)return {changed:false,conflicts:[]};const path=resolve(configPath);if(path!==managed.configPath)throw new Error('State belongs to a different configuration path');const before=await readOptional(path);let after=before;const conflicts:string[]=[];if(!managed.partial&&hash(before)===managed.writtenHash)after=managed.original;else{const doc=scanToml(before);const edits:Array<{start:number;end:number;text:string}>=[];for(const value of managed.values){const entry=doc.entries.find(e=>e.path===value.path);if(!entry){if(value.original!==undefined)conflicts.push(value.path);continue;}if(entry.value!==value.written){conflicts.push(value.path);continue;}if(value.original!==undefined)edits.push({start:entry.valueStart,end:entry.valueEnd,text:value.original});else edits.push({start:entry.start,end:entry.end,text:''});}after=replaceValues(before,edits);for(const block of managed.blocks??[]){const at=after.indexOf(block);if(at>=0)after=after.slice(0,at)+after.slice(at+block.length);else conflicts.push('keys.command.plugin_action');}after=removeEmptyOwnedTables(after,managed.original,managed.values,conflicts);scanToml(after);}if(after!==before)await writeConfig(path,before,after);if(!conflicts.length)await unlink(manifestPath(stateDir));else{const remaining={...managed,values:managed.values.filter(v=>conflicts.includes(v.path)),blocks:conflicts.includes('keys.command.plugin_action')?managed.blocks:[]};await atomicWrite(manifestPath(stateDir),JSON.stringify(remaining,null,2)+'\n');}return {changed:after!==before,conflicts,backupPath:managed.backupPath};});}

/** Upgrade only native values proven to still be ours; retain original backups. */
export function migrateNativeLayout(configPath:string,stateDir:string,theme?:Settings['theme']):Promise<ConfigResult>{return configure(configPath,stateDir,{migrateOwnedNative:true,theme});}
