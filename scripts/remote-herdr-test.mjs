import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {stageRelease} from './release.mjs';
import {herdrTestBin} from './herdr-test-bin.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),exec=promisify(execFile);
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function until(label,probe,ms=30000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const result=await probe();if(result)return result;}catch(error){last=error;}await delay(150);}throw Error(label+' timed out'+(last?': '+last.message:''));}

/** Real SSH attachment to a disposable Linux server. No user's remote machine,
 * SSH config, known_hosts, clipboard, provider commands or model accounts are used.
 */
export async function remoteHerdrTest({herdr='herdr',proof=path.join(root,'artifacts/remote-herdr-proof'),connection,release,remoteHerdr}={}){
 assert.notEqual(process.platform,'win32','Windows is explicitly deferred');
 proof=path.resolve(proof);await mkdir(proof,{recursive:true});
 const directory=await mkdtemp(path.join(tmpdir(),'prism-ssh-')),containerName='prism-remote-'+randomUUID().slice(0,8),image='localhost/herdr-prism-remote-acceptance';
 const podman=async args=>(await exec('podman',[...connection?['--connection',connection]:[],...args],{cwd:root,timeout:180000,maxBuffer:8*1024*1024})).stdout;
 const evidence={kind:'actual-isolated-SSH-Herdr-Prism',ok:false,host:{platform:process.platform,arch:process.arch,node:process.version},checks:{},limits:['Explicitly synthetic provider-shaped messages and process; no paid provider or compatibility claim.','Per-server execution and remote attachment are tested; no public Herdr0.9.3 client-visibility API certifies machine-background/disconnect heavy-work pause.','Loopback SSH into a disposable Linux container is not a WAN latency or arbitrary SSH setup certification.']};
 const save=()=>writeFile(path.join(proof,'remote.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 const stage=async(label,run)=>{console.log(JSON.stringify({stage:label,status:'running'}));const value=await run();evidence.checks[label]=value;await save();console.log(JSON.stringify({stage:label,status:'passed'}));return value;};
 let containerId,client;const clients=[];
 try{
  await stage('isolatedSSH',async()=>{
   const vmArch=(await podman(['info','--format','{{.Host.Arch}}'])).trim(),arch=['amd64','x86_64','x64'].includes(vmArch)?'x64':vmArch;assert.ok(['arm64','x64'].includes(arch),'Supported actual Linux server architecture');
   if(!remoteHerdr){const cached=path.join(root,arch==='arm64'?'artifacts/linux-final-arm64-proof/herdr-test-bin/herdr-linux-aarch64':'artifacts/linux-x64-proof-20261006/herdr-test-bin/herdr-linux-x86_64');try{await access(cached);remoteHerdr=cached;}catch{remoteHerdr=(await herdrTestBin({output:path.join(proof,'herdr-test-bin'),platform:'linux',arch})).binary;}}
   const digest=createHash('sha256').update(await readFile(remoteHerdr)).digest('hex');assert.equal(digest,arch==='arm64'?'4de7aa3e25678812e92960de64f7c2aaa1bca1f0f80a3c5e559837e231e1f5c0':'18a8dc65f1c2fa485884344356dea1cfd911c6f06cf46fa78e193f4087f4dba7');
   if(!release){release=path.join(proof,'release-'+Date.now());await stageRelease({root,output:release,platforms:['linux-'+arch]});}release=path.resolve(release);
   await exec('ssh-keygen',['-q','-t','ed25519','-N','','-C','prism-isolated-fixture','-f',path.join(directory,'identity')],{timeout:10000});
   await podman(['build','--file','containers/remote.Containerfile','--tag',image,'.']);
   containerId=(await podman(['run','--detach','--name',containerName,'--hostname','prism-remote-fixture','--publish','127.0.0.1::22','--mount',`type=bind,source=${directory}/identity.pub,target=/run/fixture-authorized-key,readonly`,'--mount',`type=bind,source=${remoteHerdr},target=/run/fixture-herdr,readonly`,'--mount',`type=bind,source=${release},target=/run/prism-release,readonly`,'--mount',`type=bind,source=${root}/scripts/remote,target=/run/remote,readonly`,image])).trim();assert.match(containerId,/^[a-f0-9]{64}$/);
   await podman(['exec',containerId,'install','-m','755','/run/fixture-herdr','/usr/local/bin/herdr']);await podman(['exec',containerId,'cp','-a','/run/prism-release','/home/prism/release']);await podman(['exec',containerId,'chown','-R','prism:prism','/home/prism/release']);
   const port=Number((await podman(['port',containerId,'22/tcp'])).trim().split(':').at(-1));assert.ok(port>0&&port<65536);
   const publicHostKey=await until('disposable SSH host key',async()=>{const key=(await podman(['exec',containerId,'cat','/etc/ssh/ssh_host_ed25519_key.pub'])).trim().split(' ');return key.length>=2&&key.slice(0,2).join(' ');});
   await writeFile(path.join(directory,'known_hosts'),`[127.0.0.1]:${port} ${publicHostKey}\n`,{mode:0o600});
   const config=`Host prism-remote-fixture\n HostName 127.0.0.1\n Port ${port}\n User prism\n IdentityFile ${directory}/identity\n IdentitiesOnly yes\n UserKnownHostsFile ${directory}/known_hosts\n GlobalKnownHostsFile /dev/null\n StrictHostKeyChecking yes\n BatchMode yes\n ConnectTimeout 5\n`;
   await writeFile(path.join(directory,'ssh_config'),config,{mode:0o600});await mkdir(path.join(directory,'bin'));await writeFile(path.join(directory,'bin','ssh'),'#!/bin/sh\nexec /usr/bin/ssh -F '+quote(path.join(directory,'ssh_config'))+' "$@"\n',{mode:0o700});
   return{actualSSH:true,pinnedHostKey:true,publicKeyOnlyAuthentication:true,hostSSHConfigurationUntouched:true,remotePlatform:'linux',remoteArch:arch,pinnedHerdrVersion:'0.9.3'};
  });
  const ssh=async(command,timeout=60000)=>(await exec('/usr/bin/ssh',['-F',path.join(directory,'ssh_config'),'prism-remote-fixture',command],{timeout,maxBuffer:4*1024*1024})).stdout;
  const remote=async phase=>JSON.parse((await ssh('node /run/remote/server-fixture.mjs '+quote(phase))).trim());
  await stage('remoteFixture',async()=>{await until('disposable SSH authentication',()=>ssh('printf remote-ready'));return remote('prepare');});
  await mkdir(path.join(directory,'local-config','herdr'),{recursive:true});await writeFile(path.join(directory,'local-config','herdr','config.toml'),'[remote]\nmanage_ssh_config = false\n',{mode:0o600});
  const attach=async label=>{
   const report=path.join(directory,label+'.json'),control=path.join(directory,label+'-control.json'),configuration=path.join(directory,label+'-config.json');
   const env={HOME:directory,XDG_CONFIG_HOME:path.join(directory,'local-config'),XDG_STATE_HOME:path.join(directory,'local-state'),XDG_DATA_HOME:path.join(directory,'local-data'),HERDR_CONFIG_PATH:path.join(directory,'local-config','herdr','config.toml'),PATH:path.join(directory,'bin')+':'+process.env.PATH,TERM:'xterm-256color',VSCODE_IPC_HOOK_CLI:'prism-isolated-fixture'};
   await writeFile(configuration,JSON.stringify({argv:[herdr,'--remote','prism-remote-fixture','--session','remote-prism'],env,cwd:directory}),{mode:0o600});
   const processHandle=spawn('python3',['-B',path.join(root,'scripts/remote/client-pty.py'),configuration,control,report],{stdio:['ignore','pipe','pipe']});let errorText='';processHandle.stderr.on('data',b=>{errorText=(errorText+b.toString()).slice(-2000);});const value={processHandle,report,control,error:()=>errorText};clients.push(value);client=value;
   await until('actual host Herdr remote attachment',async()=>{if(processHandle.exitCode!==null)throw Error('Remote PTY client exited: '+errorText);const state=JSON.parse(await readFile(report,'utf8'));return state.remoteFixtureSeen&&state;});return value;
  };
  const clientState=async value=>JSON.parse(await readFile(value.report,'utf8'));
  const disconnect=async value=>{await writeFile(value.control,JSON.stringify({disconnect:true}));const state=await until('own host SSH transport disconnects and reaps',async()=>{const s=await clientState(value);return s.reaped&&s;},15000);assert.ok(state.exitCode===-15||state.exitCode===0);assert.equal(state.transportDisconnected,true);assert.equal(state.disconnectSignal,'SIGTERM');return state;};
  await stage('actualRemoteAttachment',async()=>{const value=await attach('first-client');return await clientState(value);});
  await stage('remoteActivation',()=>remote('install'));
  await stage('remoteDashboard',async()=>{await until('actual remote Prism UI reaches host PTY',async()=>{const s=await clientState(client);return s.prismSeen&&s.remoteHostnameSeen&&s;});const result=await until('remote procfs transcript Git proof',()=>remote('inspect'));assert.equal(result.screenContainsServerHostname,true);assert.equal(result.hostname,'prism-remote-fixture');assert.equal(result.nativeLast,true);await assert.rejects(access('/home/prism/fixture/checkout/remote.txt'),e=>e.code==='ENOENT');return result;});
  const before=evidence.checks.remoteDashboard;
  await stage('hostPTYNavigation',async()=>{await remote('focus-dashboard');await delay(250);await writeFile(client.control,JSON.stringify({hostKey:'focus-right-tab'}));try{const result=await until('actual host Tab reaches remote Prism Agents',()=>remote('verify-host-tab'),10000);const state=await clientState(client);assert.equal(state.hostTabSent,true);assert.ok(state.inputWrites.every(input=>input.requested===input.written));return{...result,inputWrites:state.inputWrites,inputCanonical:state.inputCanonical,hostOwnForegroundGroup:state.hostOwnForegroundGroup};}catch(error){evidence.hostInputEvidence=await clientState(client);throw error;}});
  await stage('clipboardForwarding',async()=>{evidence.checks.copyRequest=await remote('copy');await save();await until('remote copy OSC52 reaches host PTY',async()=>{const s=await clientState(client);return s.clipboardRemoteRef&&s;});return{remoteRefCopiedViaOSC52:true,hostNativeClipboardUntouched:true,actualHostPTYCapturedSequence:true};});
  await stage('disconnectPreservesRemoteWork',async()=>{const state=await disconnect(client);await remote('append');await delay(1300);const after=await remote('inspect');assert.equal(after.controllerPid,before.controllerPid);assert.equal(after.controllerTerminalId,before.controllerTerminalId);assert.equal(after.fixturePid,before.fixturePid);assert.equal(after.serverId,before.serverId);assert.ok(after.fixtureTicks>before.fixtureTicks);assert.ok(after.messageIds.includes('remote-disconnected'));return{hostTransportDropped:true,disconnectSignal:state.disconnectSignal,hostClientReaped:true,remoteDashboardProcessPreserved:true,syntheticAgentProcessPreserved:true,heartbeatAdvanced:true,remoteAppendPresent:true,serverIdentityPreserved:true};});
  await stage('reconnect',async()=>{await attach('second-client');await until('reconnected remote Prism visible',async()=>{const s=await clientState(client);return s.prismSeen&&s.remoteHostnameSeen&&s;});const after=await remote('inspect');assert.equal(after.controllerPid,before.controllerPid);assert.equal(after.serverId,before.serverId);await disconnect(client);return{actualSSHReconnect:true,sameRemoteController:true,sameServerIdentity:true,remoteTranscriptRetained:true,ownHostClientReaped:true};});
  await stage('remoteUninstall',()=>remote('uninstall'));evidence.ok=true;
 }catch(error){evidence.error=error.stack??String(error);throw error;}
 finally{
  for(const value of clients)if(value.processHandle.exitCode===null&&value.processHandle.signalCode===null){value.processHandle.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(resolve,6000);value.processHandle.once('exit',()=>{clearTimeout(timer);resolve();});});}
  for(const value of clients){
   if(value.processHandle.exitCode===null&&value.processHandle.signalCode===null){evidence.ok=false;evidence.clientCleanupError='Owned PTY supervisor did not exit after termination';}
   try{const state=JSON.parse(await readFile(value.report,'utf8'));if(!state.reaped){evidence.ok=false;evidence.clientCleanupError='Owned Herdr remote client was not reaped';}if(Number.isInteger(state.pid)&&state.pid>0){try{process.kill(state.pid,0);evidence.ok=false;evidence.clientCleanupError='Owned Herdr remote client remains live';}catch(error){if(error.code!=='ESRCH')throw error;}}}catch(error){evidence.ok=false;evidence.clientCleanupError=error.code??'Invalid owned client cleanup report';}
  }
  if(containerId){try{await podman(['rm','--force',containerId]);evidence.disposableContainerRemoved=true;}catch(error){evidence.ok=false;evidence.containerCleanupError=String(error);}}
  await rm(directory,{recursive:true,force:true});evidence.isolatedHostSSHFilesRemoved=true;await save();
 }
 if(!evidence.ok)throw Error('Remote acceptance or owned cleanup did not complete');
 return evidence;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i].slice(2);if(!['herdr','proof','connection','release','remoteHerdr'].includes(key)||!process.argv[i+1])throw Error('Use --proof DIR [--herdr BIN --connection NAME --release ROOT --remoteHerdr BIN]');options[key]=process.argv[++i];}
 try{console.log(JSON.stringify(await remoteHerdrTest(options),null,2));}catch(error){console.error(error.stack??String(error));process.exitCode=1;}
}
