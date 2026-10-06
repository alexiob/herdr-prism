import test from 'node:test';
import assert from 'node:assert/strict';
import * as security from '../src/config/safe-file.ts';
import {mkdtemp,mkdir,rm,symlink,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const api=security as unknown as {
 parseWindowsAcl:(value:string)=>any;
 assertWindowsAcl:(value:any,options?:{strict?:boolean;allowTokenOwner?:boolean})=>void;
 windowsAclCommands:(path:string,sid:string,directory:boolean,allowSids?:string[])=>string[][];
};
const user='S-1-5-21-100-200-300-1001',admin='S-1-5-32-544',system='S-1-5-18';
const snapshot=(patch={})=>({userSid:user,ownerSid:user,tokenOwnerSid:admin,reparse:false,allowSids:[user],nullDacl:false,protected:true,...patch});

test('atomic Windows replacement waits for a temporary reader lock while preserving the original',{skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-replace-lock-'));t.after(()=>rm(root,{recursive:true,force:true}));await security.restrict(root);
 const file=join(root,'result.json');await security.atomicWrite(file,'original');
 const script="$f=[IO.File]::Open($env:PRISM_LOCK_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null; $f.Dispose()";
 const locker=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:{...process.env,PRISM_LOCK_FILE:file},stdio:'pipe',windowsHide:true});t.after(()=>{if(locker.exitCode===null)locker.kill();});
 await once(locker.stdout,'data');assert.equal(await readFile(file,'utf8'),'original');let checks=0;
 await security.atomicWrite(file,'replacement',0o600,async()=>{checks++;if(checks===1)setTimeout(()=>locker.stdin.end('\n'),100);assert.equal(await readFile(file,'utf8'),'original');});
 assert.ok(checks>1,'authorization is rechecked after a blocked rename');assert.equal(await readFile(file,'utf8'),'replacement');security.assertWindowsAcl(await security.readWindowsAcl(file),{strict:true});
});

test('recursive private directory creation protects every new intermediate without adopting an existing parent',{skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-intermediate-acl-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const before=await security.readWindowsAcl(root);
 const state=join(root,'state'),servers=join(state,'servers'),leaf=join(servers,'endpoint');
 await security.privateDir(leaf);
 for(const directory of [state,servers,leaf])security.assertWindowsAcl(await security.readWindowsAcl(directory),{strict:true});
 assert.deepEqual(await security.readWindowsAcl(root),before);
});

test('Windows ACL parser validates SID fields, arrays and null-DACL status rather than extracting a SID from arbitrary text',()=>{
 assert.equal(typeof api.parseWindowsAcl,'function');
 assert.deepEqual(api.parseWindowsAcl('\ufeff'+JSON.stringify(snapshot())),snapshot());
 for(const value of [JSON.stringify(snapshot({ownerSid:'S-1-5-18; Remove-Item'})),JSON.stringify(snapshot({allowSids:user})),JSON.stringify(snapshot({reparse:'false'})),JSON.stringify(snapshot({nullDacl:undefined})),JSON.stringify(snapshot({protected:undefined})),JSON.stringify(snapshot({protected:'true'})),JSON.stringify({userSid:user}),'{"userSid":"no SID"}'])assert.throws(()=>api.parseWindowsAcl(value),/ACL|SID/);
});
test('strict private ACL rejects inheritance even when every current allow ACE belongs to the user',()=>{
 assert.throws(()=>api.assertWindowsAcl(snapshot({protected:false}),{strict:true}),/inheritance|protected/i);
 api.assertWindowsAcl(snapshot({protected:true}),{strict:true});
});
test('Only explicit fresh-artifact authorization permits the creator token default owner; post-write verification still requires user SID ownership',()=>{
 assert.equal(typeof api.assertWindowsAcl,'function');
 const elevated=snapshot({ownerSid:admin,allowSids:[user,admin,system]});
 api.assertWindowsAcl(elevated,{allowTokenOwner:true});
 assert.throws(()=>api.assertWindowsAcl(elevated),/owner/i);
 assert.throws(()=>api.assertWindowsAcl(elevated,{strict:true,allowTokenOwner:true}),/owner|Foreign/i);
 assert.throws(()=>api.assertWindowsAcl(snapshot({ownerSid:system}),{allowTokenOwner:true}),/owner/i);
 assert.throws(()=>api.assertWindowsAcl(snapshot({reparse:true}),{allowTokenOwner:true}),/Reparse/i);
 api.assertWindowsAcl(snapshot(),{strict:true});
 assert.throws(()=>api.assertWindowsAcl(snapshot({allowSids:[user,system]}),{strict:true}),/Foreign allow/i);
 assert.throws(()=>api.assertWindowsAcl(snapshot({nullDacl:true}),{strict:true}),/null DACL/i);
});
test('icacls owner and DACL modes use separate literal argv with numeric SID prefixes for directories and files',()=>{
 assert.equal(typeof api.windowsAclCommands,'function');
 const directory='C:\\own temp\\$(literal) & unchanged';
 assert.deepEqual(api.windowsAclCommands(directory,user,true),[[directory,'/setowner','*'+user],[directory,'/inheritance:r','/grant:r','*'+user+':(OI)(CI)F']]);
 const unc='\\\\host\\share\\own private\\file';
 assert.deepEqual(api.windowsAclCommands(unc,user,false),[[unc,'/setowner','*'+user],[unc,'/inheritance:r','/grant:r','*'+user+':F']]);
 assert.throws(()=>api.windowsAclCommands(directory,user+' /T',true),/SID/);
});
test('fresh-artifact ACL plan removes every foreign grant SID after securing user access, excluding and deduplicating the user SID',()=>{
 const directory='C:\\own private\\$(literal) & unchanged';
 assert.deepEqual(api.windowsAclCommands(directory,user,true,[admin,user,system,admin,user]),[[directory,'/setowner','*'+user],[directory,'/inheritance:r','/grant:r','*'+user+':(OI)(CI)F'],[directory,'/remove:g','*'+admin,'*'+system]]);
 assert.throws(()=>api.windowsAclCommands(directory,user,true,[system+' /T']),/SID/);
});
test('strict foreign grant refusal identifies the residual SID without changing policy',()=>{
 assert.throws(()=>api.assertWindowsAcl(snapshot({allowSids:[user,system]}),{strict:true}),error=>error instanceof Error&&error.message.includes('Foreign allow ACL')&&error.message.includes(system));
});
test('actual Windows private directory has user SID owner, protected ACL and rejects a deliberately foreign grant without changing it',{skip:process.platform!=='win32'?'Requires actual Windows ACL APIs':false},async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-acl-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const privatePath=join(root,'private child $(literal) & spaces');
 await security.privateDir(privatePath);
 const first=await security.readWindowsAcl(privatePath);assert.equal(first.ownerSid,first.userSid);assert.deepEqual([...new Set(first.allowSids)],[first.userSid]);assert.equal(first.reparse,false);assert.equal(first.nullDacl,false);assert.equal(first.protected,true);
 await security.restrict(privatePath,false);
 const foreignPath=join(root,'own unsafe fixture');await mkdir(foreignPath);await security.restrict(foreignPath,true);
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 await promisify(execFile)('icacls.exe',[foreignPath,'/grant','*S-1-5-18:F'],{windowsHide:true,timeout:5000});
 const before=await security.readWindowsAcl(foreignPath);await assert.rejects(security.privateDir(foreignPath),/Foreign allow ACL/);
 assert.deepEqual(await security.readWindowsAcl(foreignPath),before,'Existing foreign grants must be preserved on refusal');
});
test('actual Windows ordinary Herdr activation secures only exact trusted namespaces without a managed receipt',{skip:process.platform!=='win32'?'Requires actual Windows ACL APIs':false},async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-herdr-acl-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'config'),state=join(root,'state'),unrelated=join(root,'unrelated');for(const dir of [config,state,unrelated])await mkdir(dir);
 const names=['HERDR_PLUGIN_ID','HERDR_PLUGIN_CONFIG_DIR','HERDR_PLUGIN_STATE_DIR'];const old=names.map(name=>process.env[name]);t.after(()=>names.forEach((name,i)=>{if(old[i]===undefined)delete process.env[name];else process.env[name]=old[i];}));
 process.env.HERDR_PLUGIN_ID='iob.herdr-prism';process.env.HERDR_PLUGIN_CONFIG_DIR=config;process.env.HERDR_PLUGIN_STATE_DIR=state;
 const beforeConfig=await security.readWindowsAcl(config),beforeUnrelated=await security.readWindowsAcl(unrelated),beforeRoot=await security.readWindowsAcl(root);
 await assert.rejects(security.securePluginNamespace(config,unrelated),/mismatched Herdr plugin namespace/);
 assert.deepEqual(await security.readWindowsAcl(config),beforeConfig,'Both namespace paths must validate before the first mutation');
 await security.securePluginNamespace(config,state);
 for(const dir of [config,state]){const acl=await security.readWindowsAcl(dir);assert.equal(acl.ownerSid,acl.userSid);assert.deepEqual([...new Set(acl.allowSids)],[acl.userSid]);assert.equal(acl.protected,true);}
 assert.deepEqual(await security.readWindowsAcl(unrelated),beforeUnrelated);assert.deepEqual(await security.readWindowsAcl(root),beforeRoot,'Parent ACL must never change');
});
test('actual Windows junction in trusted namespace spelling is refused when caller supplies the real target, before either ACL changes',{skip:process.platform!=='win32'?'Requires actual Windows ACL APIs':false},async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-junction-acl-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'config'),state=join(root,'state'),link=join(root,'state-junction');await mkdir(config);await mkdir(state);await symlink(state,link,'junction');
 const names=['HERDR_PLUGIN_ID','HERDR_PLUGIN_CONFIG_DIR','HERDR_PLUGIN_STATE_DIR'];const old=names.map(name=>process.env[name]);t.after(()=>names.forEach((name,i)=>{if(old[i]===undefined)delete process.env[name];else process.env[name]=old[i];}));
 process.env.HERDR_PLUGIN_ID='iob.herdr-prism';process.env.HERDR_PLUGIN_CONFIG_DIR=config;process.env.HERDR_PLUGIN_STATE_DIR=link;
 const beforeConfig=await security.readWindowsAcl(config),beforeState=await security.readWindowsAcl(state);
 await assert.rejects(security.securePluginNamespace(config,state),/symlink|reparse/i);
 assert.deepEqual(await security.readWindowsAcl(config),beforeConfig);assert.deepEqual(await security.readWindowsAcl(state),beforeState);
});
test('actual Windows explicit foreign allow grants survive inheritance removal but fresh-path authorization removes them',{skip:process.platform!=='win32'?'Requires actual Windows ACL APIs':false},async t=>{
 const root=await mkdtemp(join(tmpdir(),'prism-explicit-acl-'));t.after(()=>rm(root,{recursive:true,force:true}));const fresh=join(root,'owned fresh directory');await mkdir(fresh);
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);
 const original=await security.readWindowsAcl(fresh);security.assertWindowsAcl(original,{allowTokenOwner:true});
 await run('icacls.exe',[fresh,'/grant','*S-1-1-0:F'],{windowsHide:true,timeout:5000});
 // The old owner + inheritance/grant steps alone leave this explicit grant.
 for(const args of security.windowsAclCommands(fresh,original.userSid,true))await run('icacls.exe',args,{windowsHide:true,timeout:5000});
 const residual=await security.readWindowsAcl(fresh);assert.equal(residual.protected,true);assert.ok(residual.allowSids.includes('S-1-1-0'));await assert.rejects(security.restrict(fresh,false),/Foreign allow ACL/);
 assert.deepEqual(await security.readWindowsAcl(fresh),residual,'Generic existing admission must remain immutable');
 await security.restrict(fresh,true);const restricted=await security.readWindowsAcl(fresh);assert.equal(restricted.ownerSid,restricted.userSid);assert.equal(restricted.protected,true);assert.deepEqual([...new Set(restricted.allowSids)],[restricted.userSid]);
});
