import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
// @ts-ignore dependency-free bootstrap utility
import {bootstrapUnix,downloadHerdr} from '../scripts/bootstrap-unix.mjs';
const exec=promisify(execFile),unix={skip:process.platform==='win32'};
async function fixture(t:any){
 const directory=await mkdtemp(join(tmpdir(),'prism-bootstrap-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const control=join(directory,'control.json'),herdrBin=join(directory,"herdr '日本語'"),calls=join(directory,'calls.jsonl');
 await writeFile(control,JSON.stringify({running:true,version:'0.9.3',plugins:[]}));
 await writeFile(herdrBin,`#!${process.execPath}
import{readFileSync,appendFileSync}from'node:fs';
const args=process.argv.slice(2);appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
const c=JSON.parse(readFileSync(${JSON.stringify(control)},'utf8'));
if(args[0]==='--version'){console.log('herdr '+c.version);process.exit(0);}
if(args[0]==='--session')args.splice(0,2);
if(args[0]==='status'){console.log(JSON.stringify({running:c.running,version:c.version,protocol:22}));process.exit(0);}
if(args[0]==='plugin'&&args[1]==='list'){console.log(JSON.stringify({result:{type:'plugin_list',plugins:c.plugins}}));process.exit(0);}
if(args[0]==='api'){console.log(JSON.stringify({result:{snapshot:{panes:[]}}}));process.exit(0);}
if(args[0]==='workspace'){console.log(JSON.stringify({result:{}}));process.exit(0);}
throw Error('Unexpected fixture command '+args.join(' '));
`,{mode:0o755});await chmod(herdrBin,0o755);
 return{directory,control,herdrBin,calls,root:resolve('.'),dependencyDir:join(directory,'dependencies'),session:'named-fixture'};
}
test('Unix bootstrap stages absolute Node commands and activates only the selected session',unix,async t=>{
 const f=await fixture(t);let activated=false;
 const result=await bootstrapUnix({...f,install:async(options:any)=>{
  activated=true;assert.equal(options.session,'named-fixture');assert.equal(options.herdrBin,await realpath(f.herdrBin));
  assert.equal(options.shortcut,true);
  const manifest=await readFile(join(options.root,'herdr-plugin.toml'),'utf8');
  const commands=manifest.split('\n').filter(line=>/^command\s*=/.test(line));
  assert.ok(commands.length>10);assert.ok(commands.every(line=>JSON.parse(line.slice(line.indexOf('=')+1))[0]===process.execPath));
  assert.ok(await readFile(join(options.root,'checksums.json')));
  return{activated:true,managedDir:join(f.directory,'managed'),uninstallCommand:[process.execPath,'wrapper','uninstall']};
 }});
 assert.equal(activated,true);assert.equal(result.activated,true);assert.equal(result.startedServer,false);
 const commands=(await readFile(f.calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.ok(commands.slice(1).every(args=>args[0]==='--session'&&args[1]==='named-fixture'));
});
test('Unix bootstrap never replaces an existing plugin or starts an older running server',unix,async t=>{
 const f=await fixture(t);await writeFile(f.control,JSON.stringify({running:true,version:'0.9.3',plugins:[{plugin_id:'iob.herdr-prism',plugin_root:'/foreign'}]}));
 const result=await bootstrapUnix({...f,install:async()=>{throw Error('must not install');},start:async()=>{throw Error('must not start');}});
 assert.equal(result.alreadyInstalled,true);assert.equal(result.activated,undefined);
 await writeFile(f.control,JSON.stringify({running:true,version:'0.9.2',plugins:[]}));
 await assert.rejects(bootstrapUnix({...f,install:async()=>{throw Error('must not install');},download:async()=>{throw Error('must not download');}}),/running.*0.9.3|upgrade.*restart/i);
});
test('Unix bootstrap prepare-only leaves servers alone and no-start refuses unproven installation',unix,async t=>{
 const f=await fixture(t);await writeFile(f.control,JSON.stringify({running:false,version:'0.9.3',plugins:[]}));
 assert.equal((await bootstrapUnix({...f,prepareOnly:true,start:async()=>{throw Error('must not start');}})).prepared,true);
 await assert.rejects(bootstrapUnix({...f,noStart:true,install:async()=>{throw Error('must not install');}}),/not running/i);
 let started=0;
 const result=await bootstrapUnix({...f,start:async({session}:any)=>{assert.equal(session,f.session);started++;await writeFile(f.control,JSON.stringify({running:true,version:'0.9.3',plugins:[]}));},install:async()=>({activated:true})});
 assert.equal(started,1);assert.equal(result.startedServer,true);assert.equal(result.activated,true);
});
test('Unix bootstrap rejects a bad Herdr download and preserves an existing runtime',unix,async t=>{
 const f=await fixture(t),directory=join(f.directory,'download');
 await assert.rejects(downloadHerdr({directory,platform:'linux',arch:'arm64',download:async(_url:string,path:string)=>writeFile(path,'tampered')}),/checksum/i);
 await assert.rejects(lstat(directory),{code:'ENOENT'});
 await mkdir(directory);await writeFile(join(directory,'herdr'),'existing');
 await assert.rejects(downloadHerdr({directory,platform:'linux',arch:'arm64',download:async()=>{throw Error('must not download');}}),/existing.*checksum|refusing/i);
 assert.equal(await readFile(join(directory,'herdr'),'utf8'),'existing');
});
test('POSIX entry point works through a pipe with spaces in explicit executable/source paths',unix,async t=>{
 const f=await fixture(t),script=await readFile(resolve('install.sh'),'utf8');
 const child=exec('/bin/sh',['-s','--','--source-dir',f.root,'--herdr-bin',f.herdrBin,'--node-bin',process.execPath,'--prepare-only'],{env:{...process.env,XDG_DATA_HOME:join(f.directory,'data')},timeout:30000});
 child.child.stdin?.end(script);const result=await child;
 assert.match(result.stdout,/prerequisites ready/i);assert.doesNotMatch(await readFile(f.calls,'utf8'),/plugin|status/);
});

test('POSIX entry point resolves the requested ref once and downloads that immutable GitHub archive',unix,async t=>{
 const f=await fixture(t),mock=join(f.directory,'mock'),tree=join(f.directory,'herdr-prism-fixture'),archive=join(f.directory,'source.tar.gz'),urls=join(f.directory,'urls.jsonl');
 await mkdir(mock);await mkdir(join(tree,'scripts'),{recursive:true});
 await writeFile(join(tree,'scripts/bootstrap-unix.mjs'),'console.log(JSON.stringify({args:process.argv.slice(2),downloaded:true}));');
 await exec('tar',['-czf',archive,'-C',f.directory,'herdr-prism-fixture']);
 const sha='a'.repeat(40);
 await writeFile(join(mock,'curl'),`#!${process.execPath}
const{writeFileSync,copyFileSync,appendFileSync}=require('node:fs');const a=process.argv.slice(2),url=a.find(v=>v.startsWith('https://')),out=a[a.indexOf('-o')+1];appendFileSync(${JSON.stringify(urls)},url+'\\n');
if(url==='https://api.github.com/repos/alexiob/herdr-prism/commits/feature%2Ftest')writeFileSync(out,JSON.stringify({sha:${JSON.stringify(sha)}}));
else if(url===${JSON.stringify('https://codeload.github.com/alexiob/herdr-prism/tar.gz/'+sha)})copyFileSync(${JSON.stringify(archive)},out);
else throw Error('Unexpected download '+url);
`,{mode:0o755});
 const child=exec('/bin/sh',['-s','--','--ref','feature/test','--node-bin',process.execPath,'--prepare-only'],{env:{...process.env,PATH:mock+':'+process.env.PATH},timeout:30000});child.child.stdin?.end(await readFile('install.sh'));
 const result=await child;assert.match(result.stdout,/"downloaded":true/);assert.equal((await readFile(urls,'utf8')).trim().split('\n').length,2);assert.match(result.stdout,/"feature\/test"/);
});

test('POSIX entry point rejects a corrupt Node archive and cleans its exclusive lock',unix,async t=>{
 const f=await fixture(t),mock=join(f.directory,'mock'),data=join(f.directory,'data');await mkdir(mock);
 await writeFile(join(mock,'node'),'#!/bin/sh\nprintf "v18.0.0\\n"\n',{mode:0o755});
 await writeFile(join(mock,'curl'),`#!${process.execPath}
const fs=require('node:fs'),a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf('-o')+1],'tampered');
`,{mode:0o755});
 const child=exec('/bin/sh',['-s','--','--source-dir',f.root,'--prepare-only'],{env:{...process.env,PATH:mock+':'+process.env.PATH,XDG_DATA_HOME:data},timeout:30000});child.child.stdin?.end(await readFile('install.sh'));
 await assert.rejects(child,(error:any)=>/Node download checksum mismatch/.test(error.stderr));
 const runtime=join(data,'herdr-prism','dependencies',`node-v24.21.0-${process.platform}-${process.arch}`);
 await assert.rejects(lstat(runtime),{code:'ENOENT'});await assert.rejects(lstat(runtime+'.install-lock'),{code:'ENOENT'});
});
