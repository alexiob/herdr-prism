import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat,symlink,readdir,chmod,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import net from 'node:net';
// @ts-ignore plain ESM lifecycle utility
import {prepareCodeReplacement,replacePreparedCode} from '../scripts/update-code.mjs';
// @ts-ignore plain ESM release checker
import {requiredFiles} from '../scripts/check-install.mjs';
async function fixture(t:any,kind='managed'){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'prism-update-code-')));t.after(()=>rm(directory,{recursive:true,force:true}));const root=join(directory,'installed'),release=join(directory,'reviewed');await mkdir(root);await mkdir(release);
 const files:Record<string,string>={};for(const file of requiredFiles){const text=file==='package.json'?JSON.stringify({name:'herdr-prism',version:'0.5.0',type:'module'}):file==='dist/herdr/protocol.json'?JSON.stringify({protocol:22,schemas:{request:{}}}):file==='herdr-plugin.toml'?'id = "iob.herdr-prism"\nversion = "0.5.0"\n[[panes]]\ncommand = ["node", "dist/entrypoints/inspector.js"]\n':'export const updated=true;\n';await mkdir(dirname(join(release,file)),{recursive:true});await writeFile(join(release,file),text);files[file]=createHash('sha256').update(text).digest('hex');}
 await writeFile(join(release,'release.json'),JSON.stringify({version:1,name:'herdr-prism',releaseVersion:'0.5.0',platforms:['linux-x64'],protocol:22}));files['release.json']=createHash('sha256').update(await readFile(join(release,'release.json'))).digest('hex');await writeFile(join(release,'checksums.json'),JSON.stringify({version:1,algorithm:'sha256',files}));await chmod(join(release,'scripts/live-install.mjs'),0o755);await writeFile(join(release,'unreviewed'),'must not install');
 await writeFile(join(root,'old-code'),'original');await writeFile(join(root,'herdr-plugin.toml'),'id = "iob.herdr-prism"\nversion = "0.4.0"\n');const receipt={version:1,pluginId:'iob.herdr-prism',token:randomUUID(),installRoot:root,sourceRoot:release,configDir:join(directory,'config'),stateDir:join(directory,'state'),phase:'active'};
 for(const name of ['config','state']){await mkdir(join(directory,name));await writeFile(join(directory,name,'private'),'preserve');}
 if(kind==='managed')await writeFile(join(root,'.hat-managed-install.json'),JSON.stringify(receipt));
 const info:any={plugin_id:'iob.herdr-prism',plugin_root:root,enabled:true,source:kind==='github'?{kind:'github',managed_path:root,owner:'alexiob',repo:'herdr-prism',requested_ref:'main',resolved_commit:'a'.repeat(40)}:{kind:'local'}};
 let registration=structuredClone(info),failLinks=0;const calls:any[]=[];const rpc={call:async(method:string,params:any)=>{calls.push({method,params:structuredClone(params)});if(method==='plugin.list')return {type:'plugin_list',plugins:[registration]};if(method==='plugin.link'){if(failLinks-- >0)throw Error('Registration refused');registration={...registration,plugin_root:params.path,enabled:params.enabled,source:params.source??{kind:'local'}};return {type:'plugin_linked',plugin:registration};}throw Error('Unexpected RPC');}};
 return {directory,root,release,receipt,info,rpc,calls,options:{release,info,rpc,platform:'linux',arch:'x64',revision:'b'.repeat(40)},fail(){failLinks=1;},registration:()=>registration};
}
test('prepared managed replacement copies reviewed code before changing installation, preserves ownership and executable mode',async t=>{
 const f=await fixture(t),transaction=await prepareCodeReplacement({...f.options,nodeBin:'/opt/prism node/bin/node'});assert.equal(await readFile(join(f.root,'old-code'),'utf8'),'original');assert.ok(!f.calls.some(c=>c.method==='plugin.link'));assert.equal(dirname(transaction.recovery.backup),dirname(f.root));const lock=await lstat(transaction.recovery.lock);assert.ok(lock.isFile());if(process.platform!=='win32')assert.equal(lock.mode&0o777,0o600);assert.ok((await lstat(transaction.recovery.prepared)).isDirectory());
 const handle=await transaction.replace();assert.equal(await readFile(join(f.root,'.hat-managed-install.json'),'utf8'),JSON.stringify(f.receipt));assert.equal(await readFile(join(f.root,'herdr-plugin.toml'),'utf8').then(x=>x.includes('/opt/prism node/bin/node')),true);const copied=await lstat(join(f.root,'scripts/live-install.mjs'));assert.ok(copied.isFile());assert.deepEqual(await readFile(join(f.root,'scripts/live-install.mjs')),await readFile(join(f.release,'scripts/live-install.mjs')));if(process.platform!=='win32')assert.equal(copied.mode&0o111,0o111);await assert.rejects(lstat(join(f.root,'unreviewed')));assert.equal(f.registration().plugin_root,f.root);assert.equal(f.registration().enabled,false);
 await handle.finish();for(const name of ['config','state'])assert.equal(await readFile(join(f.directory,name,'private'),'utf8'),'preserve');assert.ok(!(await readdir(f.directory)).some(name=>name.includes('.hat-update-')));
});
test('explicit rollback restores old code and original receipt at the same canonical root',async t=>{
 const f=await fixture(t),transaction=await prepareCodeReplacement(f.options);await transaction.replace();await transaction.rollback();assert.equal(await readFile(join(f.root,'old-code'),'utf8'),'original');assert.equal(await readFile(join(f.root,'.hat-managed-install.json'),'utf8'),JSON.stringify(f.receipt));await transaction.finish();
});
test('failed registration restores old code before propagating the failure',async t=>{
 const f=await fixture(t),transaction=await prepareCodeReplacement(f.options);f.fail();await assert.rejects(transaction.replace(),/Registration refused/);assert.equal(await readFile(join(f.root,'old-code'),'utf8'),'original');assert.equal(f.calls.filter(c=>c.method==='plugin.link').length,2);await transaction.finish();
});
test('GitHub updates retain repository and reviewed immutable revision, and rollback restores original source offline',async t=>{
 const f=await fixture(t,'github'),transaction=await prepareCodeReplacement(f.options);await transaction.replace();assert.equal(f.registration().source.kind,'github');assert.equal(f.registration().source.owner,'alexiob');assert.equal(f.registration().source.resolved_commit,'b'.repeat(40));assert.equal(f.registration().plugin_root,f.root);await transaction.rollback();assert.deepEqual(f.registration().source,f.info.source);assert.equal(await readFile(join(f.root,'old-code'),'utf8'),'original');await transaction.finish();
});
test('developer links and unpinned GitHub source are rejected before mutation',async t=>{
 const linked=await fixture(t,'local');await assert.rejects(prepareCodeReplacement(linked.options),/developer|linked|managed/i);assert.equal(await readFile(join(linked.root,'old-code'),'utf8'),'original');assert.equal(linked.calls.length,0);
 const github=await fixture(t,'github');await assert.rejects(prepareCodeReplacement({...github.options,revision:'main'}),/immutable|40|revision/i);assert.equal(github.calls.length,0);
});
test('tampered artifacts, symlink components and private state inside the code root prevent preparation',async t=>{
 const tampered=await fixture(t);await writeFile(join(tampered.release,'dist/entrypoints/action.js'),'tampered');await assert.rejects(prepareCodeReplacement(tampered.options),/checksum/i);assert.equal(tampered.calls.length,0);
 const linked=await fixture(t);await rm(join(linked.release,'dist'),{recursive:true});await symlink(join(linked.directory,'state'),join(linked.release,'dist'),'dir');await assert.rejects(prepareCodeReplacement(linked.options),/symlink|checksum|artifact/i);assert.equal(linked.calls.length,0);
 const nested=await fixture(t);await writeFile(join(nested.root,'.hat-managed-install.json'),JSON.stringify({...nested.receipt,stateDir:join(nested.root,'private-state')}));await assert.rejects(prepareCodeReplacement(nested.options),/state|overlap|inside/i);assert.equal(nested.calls.length,0);
});
test('cancel preserves installation and changed registration prevents prepared replacement',async t=>{
 const f=await fixture(t),transaction=await prepareCodeReplacement(f.options);await transaction.cancel();assert.equal(await readFile(join(f.root,'old-code'),'utf8'),'original');assert.ok(!(await readdir(f.directory)).some(name=>name.includes('.hat-update-')));
 const g=await fixture(t),prepared=await prepareCodeReplacement(g.options);g.registration().plugin_root=join(g.directory,'foreign');await assert.rejects(prepared.replace(),/registration.*changed|foreign/i);assert.equal(await readFile(join(g.root,'old-code'),'utf8'),'original');await prepared.cancel();
});
test('standalone updater discovers the selected server socket through a bounded fake CLI and preserves source over JSON RPC',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t,'github'),socketDir=await mkdtemp('/tmp/prism-code-rpc-'),endpoint=join(socketDir,'rpc.sock'),log=join(socketDir,'cli.json'),cli=join(socketDir,'fake-herdr.mjs');t.after(()=>rm(socketDir,{recursive:true,force:true}));
 await writeFile(cli,'import {writeFile} from "node:fs/promises";await writeFile(process.env.UPDATE_TEST_LOG,JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({socket:process.env.UPDATE_TEST_SOCKET}));');
 const server=net.createServer(socket=>{let buffer='';socket.on('data',async chunk=>{buffer+=chunk;const at=buffer.indexOf('\n');if(at<0)return;const request=JSON.parse(buffer.slice(0,at));buffer='';const result=await f.rpc.call(request.method,request.params);socket.end(JSON.stringify({id:request.id,result})+'\n');});});await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const transaction=await prepareCodeReplacement({...f.options,rpc:undefined,session:'isolated',herdrBin:process.execPath,herdrPrefix:[cli,'--session','isolated'],env:{UPDATE_TEST_LOG:log,UPDATE_TEST_SOCKET:endpoint,HERDR_SOCKET_PATH:join(socketDir,'foreign.sock')},timeoutMs:3000});
 assert.deepEqual(JSON.parse(await readFile(log,'utf8')),['--session','isolated','status','server','--json']);await transaction.replace();assert.equal(f.registration().source.resolved_commit,'b'.repeat(40));await transaction.rollback();await transaction.finish();
});
test('installed-code symlinks are rejected before replacement and preserve their private target',async t=>{
 const f=await fixture(t);await symlink(join(f.directory,'state','private'),join(f.root,'linked-private-file'));await assert.rejects(prepareCodeReplacement(f.options),/symlink/i);assert.equal(await readFile(join(f.directory,'state','private'),'utf8'),'preserve');assert.equal(await readFile(join(f.root,'old-code'),'utf8'),'original');assert.ok(!(await readdir(f.directory)).some(name=>name.includes('.hat-update-')));
});
test('runtime binding rejects unexpected non-Node commands instead of rewriting their executable',async t=>{
 const f=await fixture(t),manifest='id = "iob.herdr-prism"\nversion = "0.5.0"\n[[panes]]\ncommand = ["sh", "dist/entrypoints/inspector.js"]\n';await writeFile(join(f.release,'herdr-plugin.toml'),manifest);const index=JSON.parse(await readFile(join(f.release,'checksums.json'),'utf8'));index.files['herdr-plugin.toml']=createHash('sha256').update(manifest).digest('hex');await writeFile(join(f.release,'checksums.json'),JSON.stringify(index));
 await assert.rejects(prepareCodeReplacement({...f.options,nodeBin:'/opt/prism/bin/node'}),/unexpected|non-Node|Node command/i);assert.equal(await readFile(join(f.root,'old-code'),'utf8'),'original');assert.equal(f.calls.length,0);
});
