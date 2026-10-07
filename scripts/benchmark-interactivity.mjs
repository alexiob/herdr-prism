import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm,open} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {checkInstall} from './check-install.mjs';

const exec=promisify(execFile),pluginId='iob.herdr-prism';
const sha=value=>createHash('sha256').update(value).digest('hex');
const transport=endpoint=>process.platform==='win32'&&!endpoint.startsWith('\\\\')?'\\\\.\\pipe\\'+endpoint:endpoint;
const quote=value=>process.platform==='win32'?"'"+value.replaceAll("'","''")+"'":"'"+value.replaceAll("'","'\\''")+"'";
export function distribution(values){const ordered=values.slice().sort((a,b)=>a-b);const at=p=>ordered[Math.max(0,Math.ceil(p*ordered.length)-1)]??null;return {count:ordered.length,min:ordered[0]??null,median:at(.5),p95:at(.95),p99:at(.99),max:ordered.at(-1)??null};}
async function until(label,probe,timeout=30000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{const found=await probe();if(found)return found;}catch(error){last=error;}await delay(50);}throw Error(label+' timed out'+(last?': '+last.message:''));}
export function rpcClient(endpoint){let sequence=0;return async(method,params={})=>new Promise((resolve,reject)=>{
 const socket=net.createConnection(transport(endpoint)),id='bench-'+(++sequence);let buffer='',settled=false;
 const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);};
 const timer=setTimeout(()=>finish(Error(method+' timed out')),10000);
 socket.once('connect',()=>socket.write(JSON.stringify({id,method,params})+'\n'));
 socket.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>16*1024*1024)return finish(Error('Benchmark RPC frame too large'));let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let envelope;try{envelope=JSON.parse(line);}catch(error){return finish(error);}if(envelope.id===id)finish(envelope.error?Error(envelope.error.message??envelope.error.code):undefined,envelope.result);}});
 socket.once('error',error=>finish(error));socket.once('end',()=>{if(!settled)finish(Error('RPC closed before response'));});
 });}
function proxyCounters(){return {connections:0,requestBytes:0,responseBytes:0,methods:{},events:0};}
function counterDelta(after,before){return {connections:after.connections-before.connections,requestBytes:after.requestBytes-before.requestBytes,responseBytes:after.responseBytes-before.responseBytes,events:after.events-before.events,methods:Object.fromEntries(Object.entries(after.methods).map(([key,value])=>[key,value-(before.methods[key]??0)]).filter(([,n])=>n))};}
export async function createProxy(endpoint,target){
 const counters=proxyCounters(),sockets=new Set();
 const server=net.createServer(incoming=>{const outgoing=net.createConnection(transport(target));counters.connections++;sockets.add(incoming);sockets.add(outgoing);let request='',response='';
  incoming.on('data',chunk=>{counters.requestBytes+=chunk.length;request+=chunk.toString();let end;while((end=request.indexOf('\n'))>=0){const line=request.slice(0,end);request=request.slice(end+1);try{const method=JSON.parse(line).method;if(method)counters.methods[method]=(counters.methods[method]??0)+1;}catch{}}});
  outgoing.on('data',chunk=>{counters.responseBytes+=chunk.length;response+=chunk.toString();let end;while((end=response.indexOf('\n'))>=0){const line=response.slice(0,end);response=response.slice(end+1);try{if(JSON.parse(line).event)counters.events++;}catch{}}});
  const close=()=>{incoming.destroy();outgoing.destroy();sockets.delete(incoming);sockets.delete(outgoing);};incoming.on('error',close);outgoing.on('error',close);incoming.on('close',()=>{sockets.delete(incoming);outgoing.destroy();});outgoing.on('close',()=>sockets.delete(outgoing));incoming.pipe(outgoing);outgoing.pipe(incoming);
 });await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(transport(endpoint),resolve);});
 return {counters,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
function descendants(batch,rootPids){const byPid=new Map(batch.processes.map(p=>[p.pid,p]));const selected=new Map();for(const pid of rootPids){const process=byPid.get(pid);if(process)selected.set(pid,process);}let changed=true;while(changed){changed=false;for(const process of batch.processes)if(!selected.has(process.pid)&&selected.has(process.ppid)&&BigInt(selected.get(process.ppid).startTime)<=BigInt(process.startTime)){selected.set(process.pid,process);changed=true;}}return [...selected.values()];}
function identity(batch,p){return batch.bootId+':'+p.pid+':'+p.startTime;}
export function summarizeResources(batches,roots){
 const groups=['herdr','prism','syntheticAgents'],points=Object.fromEntries(groups.map(name=>[name,[]])),totals=Object.fromEntries(groups.map(name=>[name,0n]));
 let unmatched=0;
 for(let index=0;index<batches.length;index++){
  const batch=batches[index],previous=batches[index-1];const all=descendants(batch,[roots.server]);const prism=descendants(batch,roots.prism),synthetic=descendants(batch,roots.synthetic);const exclude=new Set([...prism,...synthetic].map(p=>p.pid));
  const grouped={herdr:all.filter(p=>!exclude.has(p.pid)),prism,syntheticAgents:synthetic};
  for(const name of groups){let cpuNs=0n,matched=0;const before=new Map(previous?.processes.map(p=>[identity(previous,p),p])??[]);for(const process of grouped[name]){const old=before.get(identity(batch,process));if(old&&BigInt(process.cpuNs)>=BigInt(old.cpuNs)){cpuNs+=BigInt(process.cpuNs)-BigInt(old.cpuNs);matched++;}else if(previous)unmatched++;}
   const elapsed=previous?BigInt(batch.monotonicNs)-BigInt(previous.monotonicNs):0n;
   totals[name]+=cpuNs;points[name].push({at:batch.sampledAt,cpuPercent:elapsed>0n?Number(cpuNs)*100/Number(elapsed):null,rssBytes:grouped[name].reduce((sum,p)=>sum+Number(BigInt(p.rssBytes)),0),processes:grouped[name].length,matchedBirthIdentities:matched});
  }
 }
 const elapsed=batches.length>1?BigInt(batches.at(-1).monotonicNs)-BigInt(batches[0].monotonicNs):0n;
 return {groups:Object.fromEntries(groups.map(name=>[name,{cpuPercent:distribution(points[name].map(p=>p.cpuPercent).filter(v=>v!==null)),averageCpuPercent:elapsed>0n?Number(totals[name])*100/Number(elapsed):null,cpuNs:totals[name].toString(),rssBytes:distribution(points[name].map(p=>p.rssBytes)),points:points[name]}])),unmatchedIntervals:unmatched,coverage:'Only exact boot/PID/birth matches contribute CPU deltas. Processes exiting between samples and inaccessible processes are unmeasured; memory is a resident sum, not unique pages.'};
}
async function systemContext(){let contextSwitches;try{const file=await readFile('/proc/stat','utf8');contextSwitches=Number(/^ctxt (\d+)$/m.exec(file)?.[1]);}catch{}return {loadavg:os.loadavg(),freeMemoryBytes:os.freemem(),totalMemoryBytes:os.totalmem(),contextSwitches:contextSwitches??null};}

const attachedClientPython=String.raw`import codecs, fcntl, json, math, os, pty, re, select, signal, struct, subprocess, sys, termios, time, resource
binary, session, output_path, count, duration = sys.argv[1:]
count, duration = int(count), float(duration)
columns, rows = 960, 50
grid = [[' '] * columns for _ in range(rows)]
x = y = saved_x = saved_y = 0
buffer = ''
decoder = codecs.getincrementaldecoder('utf-8')('replace')
captured = 0
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
def child_setup():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    os.tcsetpgrp(0, os.getpgrp())
child = subprocess.Popen([binary, '--session', session], stdin=slave, stdout=slave, stderr=slave, env=os.environ.copy(), close_fds=True, preexec_fn=child_setup)
os.close(slave)
def decode(data):
    global buffer, x, y, saved_x, saved_y, grid, captured
    captured += len(data)
    buffer += decoder.decode(data)
    while buffer:
        char = buffer[0]
        if char == '\x1b':
            if len(buffer) < 2: return
            if buffer.startswith('\x1b['):
                match = re.match(r'^\x1b\[([0-?]*)([ -/]*)([@-~])', buffer)
                if not match: return
                raw, final = match.group(1), match.group(3)
                buffer = buffer[len(match.group(0)):]
                values = [int(value) if value.isdigit() else 0 for value in raw.lstrip('?=>').split(';')]
                n = values[0] or 1
                if final in ('H', 'f'): y, x = max(0, min(rows-1, n-1)), max(0, min(columns-1, (values[1] if len(values)>1 and values[1] else 1)-1))
                elif final == 'A': y = max(0, y-n)
                elif final == 'B': y = min(rows-1, y+n)
                elif final == 'C': x = min(columns-1, x+n)
                elif final == 'D': x = max(0, x-n)
                elif final == 'G': x = max(0, min(columns-1, n-1))
                elif final == 'd': y = max(0, min(rows-1, n-1))
                elif final == 'E': y, x = min(rows-1, y+n), 0
                elif final == 'F': y, x = max(0, y-n), 0
                elif final == 'J':
                    if values[0] in (2, 3): grid = [[' '] * columns for _ in range(rows)]
                    elif values[0] == 0:
                        grid[y][x:] = [' '] * (columns-x)
                        for row in range(y+1, rows): grid[row] = [' '] * columns
                elif final == 'K':
                    if values[0] == 2: grid[y] = [' '] * columns
                    elif values[0] == 1: grid[y][:x+1] = [' '] * (x+1)
                    else: grid[y][x:] = [' '] * (columns-x)
                elif final == 's': saved_x, saved_y = x, y
                elif final == 'u' and not raw: x, y = saved_x, saved_y
                elif final == 'n' and values[0] == 6: os.write(master, ('\x1b[%d;%dR' % (y+1, x+1)).encode())
                continue
            if buffer.startswith('\x1b]'):
                end = re.search(r'\x07|\x1b\\', buffer)
                if not end: return
                buffer = buffer[end.end():]
                continue
            if buffer[1] == '7': saved_x, saved_y = x, y
            elif buffer[1] == '8': x, y = saved_x, saved_y
            buffer = buffer[2:]
            continue
        buffer = buffer[1:]
        if char == '\r': x = 0
        elif char == '\n':
            y += 1
            if y >= rows: grid.pop(0); grid.append([' '] * columns); y = rows-1
        elif char == '\b': x = max(0, x-1)
        elif char == '\t': x = min(columns-1, (x//8+1)*8)
        elif ord(char) >= 32:
            if x >= columns: x = 0; y = min(rows-1, y+1)
            grid[y][x] = char
            x += 1
def pump(timeout):
    if child.poll() is not None: raise RuntimeError('Owned attached Herdr client exited')
    ready, _, _ = select.select([master], [], [], timeout)
    if ready:
        data = os.read(master, 1024*1024)
        if not data: raise RuntimeError('Owned client PTY closed')
        decode(data)
def seen(marker): return any(marker in ''.join(row) for row in grid)
def percentile(values, p): return sorted(values)[max(0, math.ceil(len(values)*p)-1)] if values else None
result = {'method': 'actual attached Herdr TUI PTY keyboard write to reconstructed terminal-grid echo', 'ok': False, 'samples': count, 'columns': columns, 'rows': rows, 'clientPid': child.pid, 'fixtureOnly': True}
latencies = []
try:
    deadline = time.perf_counter()+15
    while not seen('BENCH_READY_PID:'):
        if time.perf_counter() > deadline: raise RuntimeError('Attached grid did not show the focused synthetic echo terminal')
        pump(.05)
    warmup = time.perf_counter()+1
    while time.perf_counter() < warmup: pump(.02)
    result['rawForegroundClient'] = not bool(termios.tcgetattr(master)[3] & termios.ICANON) and os.tcgetpgrp(master) == child.pid
    if not result['rawForegroundClient']: raise RuntimeError('Owned attached client is not raw in its own foreground group')
    start = time.perf_counter()
    initial_bytes = captured
    for n in range(count):
        planned = start+n*duration/count
        while time.perf_counter() < planned: pump(max(0, min(.01, planned-time.perf_counter())))
        marker = 'KEY:%04d:Q' % n
        at = time.perf_counter()
        os.write(master, b'x')
        deadline = at+3
        while not seen('BENCH_ECHO:'+marker):
            if time.perf_counter() > deadline: raise RuntimeError('Synthetic key echo was not reconstructed for sample %d' % n)
            pump(.005)
        latencies.append((time.perf_counter()-at)*1000)
    result.update({'ok': True, 'elapsedMs': (time.perf_counter()-start)*1000, 'keyToGridEchoMs': {'count': len(latencies), 'min': min(latencies), 'median': percentile(latencies,.5), 'p95': percentile(latencies,.95), 'p99': percentile(latencies,.99), 'max': max(latencies)}, 'samplesMs': latencies, 'clientOutputBytes': captured-initial_bytes, 'totalClientOutputBytes': captured, 'driverCpuSeconds': resource.getrusage(resource.RUSAGE_SELF).ru_utime+resource.getrusage(resource.RUSAGE_SELF).ru_stime})
except Exception as error:
    result['error'] = str(error)
finally:
    with open(output_path, 'w') as output: json.dump(result, output, indent=2)
    if child.poll() is None: os.killpg(child.pid, signal.SIGTERM)
    deadline = time.perf_counter()+5
    while child.poll() is None and time.perf_counter() < deadline:
        if select.select([master], [], [], .05)[0]:
            try: os.read(master, 1024*1024)
            except OSError: pass
    if child.poll() is None: os.killpg(child.pid, signal.SIGKILL)
    os.close(master)
    try: child.wait(timeout=5)
    except subprocess.TimeoutExpired: result['cleanupError'] = 'Owned client did not exit after PTY close and termination'
    result['clientReaped'] = child.poll() is not None
    with open(output_path, 'w') as output: json.dump(result, output, indent=2)
if not result['ok']: sys.exit(1)
`;

export async function benchmarkInteractivity({release,herdr=process.env.HERDR_BIN_PATH??'herdr',proof='artifacts/interactivity-proof',panels=[0,1,4,8],samples=100,duration=8,clientOnly=false}={}){
 assert(release,'--release is required');assert(Number.isSafeInteger(samples)&&samples>=10&&samples<=10000,'--samples must be 10–10000');assert(Number.isFinite(duration)&&duration>=2&&duration<=600,'--duration must be 2–600 seconds');assert(panels.length&&panels.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=8),'--panels is a comma-separated list from 0 through 8');
 release=path.resolve(release);proof=path.resolve(proof);if(herdr.includes('/')||herdr.includes('\\'))herdr=path.resolve(herdr);
 const integrity=await checkInstall({root:release});assert(integrity.ok,integrity.errors.join('; '));
 const result={kind:'isolated-real-herdr-interactivity',ok:false,release,releaseChecksum:sha(await readFile(path.join(release,'checksums.json'))),platform:process.platform,arch:process.arch,node:process.version,cpuModel:os.cpus()[0]?.model,logicalCpus:os.cpus().length,options:{panels,samples,durationSeconds:duration,clientOnly,nativeAgents:8,messagesPerAgent:200,messageCharacters:200,terminal:{columns:960,rows:50}},limitations:['Headless API send-to-observed-echo is an input/backpressure proxy, not attached-client key-to-pixel latency.','Prism RPC/byte counts use a transparent fixture-only proxy; the same proxy is retained in both builds. Native benchmark probes bypass it and mailbox traffic is not counted.','CPU is summed from exact process birth identities at one-second intervals; short-lived processes can be missed. Benchmark driver and its sampler are excluded.','Idle API phases still include paced read-only snapshot probes.','Eight same-tab panels use a synthetic 960-column terminal; this isolates panel count but does not model a typical physical display.','Attached-client phases measure local Unix PTY/grid echo, not physical pixel presentation or WAN latency.','No model inference, network service, user data or user Herdr namespace is involved.'],cases:[]};
 if(clientOnly&&process.platform==='win32')throw Error('--client-only requires Unix PTY support; Windows ConPTY is a separate measurement');
 await mkdir(proof,{recursive:true});const save=()=>writeFile(path.join(proof,'interactivity.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 const load=file=>import(pathToFileURL(path.join(release,file)).href);
 const {createSampler}=await load('dist/process/sampler.js'),{StateStore,identityName}=await load('dist/state/store.js'),{stageRelease}=await load('scripts/release.mjs'),{MailboxClient}=await load('dist/state/mailbox.js');
 for(const count of panels){
  const directory=await mkdtemp(path.join(process.platform==='win32'?os.tmpdir():'/tmp','pb-')),session='bench-'+randomUUID().slice(0,8),configHome=path.join(directory,'c'),configPath=path.join(configHome,'herdr','config.toml'),endpoint=path.join(configHome,'herdr','sessions',session,'herdr.sock'),proxyEndpoint=path.join(directory,'proxy.sock');
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('HERDR_'))delete env[key];Object.assign(env,{XDG_CONFIG_HOME:configHome,XDG_STATE_HOME:path.join(directory,'s'),XDG_DATA_HOME:path.join(directory,'d'),HERDR_CONFIG_PATH:configPath,HERDR_SOCKET_PATH:endpoint,TERM:'xterm-256color'});if(process.platform==='win32'){env.APPDATA=configHome;env.LOCALAPPDATA=path.join(directory,'local');}else env.SHELL='/bin/sh';
  const providerHomes=Object.fromEntries(['codex','claude','pi'].map(name=>[name,path.join(directory,name)]));for(const value of Object.values(providerHomes))await mkdir(value,{recursive:true});Object.assign(env,{CODEX_HOME:providerHomes.codex,CLAUDE_CONFIG_DIR:providerHomes.claude,PI_CODING_AGENT_DIR:providerHomes.pi});
  await mkdir(path.dirname(configPath),{recursive:true});await writeFile(configPath,'onboarding = false\n[server]\nheadless_cols = 960\nheadless_rows = 50\n',{mode:0o600});const configDir=path.join(configHome,'herdr','plugins','config',pluginId);await mkdir(configDir,{recursive:true});await writeFile(path.join(configDir,'settings.json'),JSON.stringify({providerHomes,nativeMode:'inspector-only',sampleIntervalMs:2000,todosEnabled:true}));
  const log=await open(path.join(proof,`panels-${count}-server.log`),'w',0o600);const server=spawn(herdr,['--session',session,'server'],{env,cwd:directory,windowsHide:true,stdio:['ignore',log.fd,log.fd]});let startupError;server.on('error',error=>startupError=error);
  const rpc=rpcClient(endpoint),snapshot=async()=>(await rpc('session.snapshot')).snapshot;
  const cli=async args=>{const response=await exec(herdr,['--session',session,...args],{env,cwd:directory,timeout:30000,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});return response.stdout.trim()?JSON.parse(response.stdout).result:{};};
  let proxy,sampler,installed,installOptions,liveUninstall,success=false;const fixturePids=[server.pid];
  console.log(JSON.stringify({panels:count,stage:'setup',status:'running'}));
  try{
   await until('owned server startup',async()=>{if(startupError)throw startupError;if(server.exitCode!==null)throw Error('Owned server exited');return snapshot();});
   proxy=await createProxy(proxyEndpoint,endpoint);
   const workspace=await cli(['workspace','create','--cwd',directory,'--label','Synthetic benchmark','--focus']);const natives=[workspace.root_pane];
   for(let level=0;level<3;level++){const current=[...natives];for(const pane of current){const split=await rpc('pane.split',{target_pane_id:pane.pane_id,direction:'right',ratio:.5,cwd:directory,focus:false});natives.push(split.pane);}}
   assert.equal(natives.length,8);const ownedPanes=new Set(natives.map(p=>p.pane_id));
   const echoFile=path.join(directory,'fixtures','pi');await mkdir(path.dirname(echoFile),{recursive:true});const echoCode="process.title='pi';if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdout.write('BENCH_READY_PID:'+process.pid+'\\n');let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\\n'))>=0){const text=buffer.slice(0,end);buffer=buffer.slice(end+1);process.stdout.write('BENCH_ECHO:'+text+'\\n');}});process.stdin.resume();setInterval(()=>{},1000);\n";const clientEchoCode="process.title='pi';if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdout.write('BENCH_READY_PID:'+process.pid+'\\r\\n');let sequence=0;process.stdin.on('data',chunk=>{for(const character of chunk.toString())if(character==='x')process.stdout.write('BENCH_ECHO:KEY:'+String(sequence++).padStart(4,'0')+':Q\\r\\n');});process.stdin.on('end',()=>process.exit(0));process.stdin.resume();setInterval(()=>{},1000);\n";await writeFile(echoFile,clientOnly?clientEchoCode:echoCode);
   const records=path.join(providerHomes.pi,'sessions','synthetic');await mkdir(records,{recursive:true});const synthetic=[];
   for(const [index,pane]of natives.entries()){
    const id='benchmark-agent-'+index,file=path.join(records,id+'.jsonl'),now=new Date().toISOString();const rows=[{type:'session',version:3,id,cwd:directory,timestamp:now},{type:'session_info',id:'name',name:'Synthetic agent '+index}];for(let n=0;n<200;n++)rows.push({type:'message',id:'message-'+n,timestamp:now,message:{role:n%2?'assistant':'user',content:[{type:'text',text:('SYNTHETIC '+n+' ').padEnd(200,'x')}],stopReason:'stop'}});await writeFile(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    await cli(['pane','run',pane.pane_id,(process.platform==='win32'?'& ':'exec ')+quote(process.execPath)+' '+quote(echoFile)+' --session '+quote(file)]);
    const pid=await until('synthetic echo ready',async()=>{const response=await rpc('pane.read',{pane_id:pane.pane_id,source:'recent',lines:8});const match=/BENCH_READY_PID:(\d+)/.exec(JSON.stringify(response));return match&&Number(match[1]);});synthetic.push(pid);fixturePids.push(pid);
    await rpc('pane.report_agent',{pane_id:pane.pane_id,source:'herdr:pi',agent:'pi',state:'working',agent_session_path:file,seq:100});await rpc('pane.report_agent_session',{pane_id:pane.pane_id,source:'herdr:pi',agent:'pi',agent_session_path:file,seq:101,session_start_source:'startup'});
   }
   let store;
   if(count){
    const staged=path.join(directory,'release');await stageRelease({root:release,output:staged,platforms:[process.platform+'-'+process.arch],helperSource:'bin',nodeBin:process.execPath});
    // Fixture-only wrapper changes only the transport destination; all actual
    // runtime modules remain the supplied release's checksummed bytes.
    const wrapper='dist/benchmark-proxy-entry.js';await writeFile(path.join(staged,wrapper),"import path from 'node:path';import{pathToFileURL}from'node:url';process.env.HERDR_SOCKET_PATH="+JSON.stringify(proxyEndpoint)+";const target=process.argv.splice(2,1)[0];process.argv[1]=path.resolve(process.env.HERDR_PLUGIN_ROOT??process.cwd(),target);await import(pathToFileURL(process.argv[1]).href);\n");
    const manifestPath=path.join(staged,'herdr-plugin.toml');const manifest=(await readFile(manifestPath,'utf8')).replace(/command = \[("[^"]+"), ("dist\/entrypoints\/[^"\n]+")/g,'command = [$1, "'+wrapper+'", $2');await writeFile(manifestPath,manifest);const index=JSON.parse(await readFile(path.join(staged,'checksums.json'),'utf8'));index.files[wrapper]=sha(await readFile(path.join(staged,wrapper)));index.files['herdr-plugin.toml']=sha(manifest);await writeFile(path.join(staged,'checksums.json'),JSON.stringify(index,null,2)+'\n');
    const lifecycle=await import(pathToFileURL(path.join(staged,'scripts/live-install.mjs')).href);liveUninstall=lifecycle.liveUninstall;installOptions={root:staged,managedDir:path.join(directory,'managed'),herdrBin:herdr,session,env,inspectorOnly:true,shortcut:false,timeoutMs:30000};await rpc('pane.focus',{pane_id:natives[0].pane_id});installed=await lifecycle.liveInstall(installOptions);store=new StateStore(path.join(installed.stateDir,'servers',identityName(proxyEndpoint)));
    const action=async()=>{const invoked=(await cli(['plugin','action','invoke','open','--plugin',pluginId])).log;await until('open action',async()=>{const row=(await cli(['plugin','log','list','--plugin',pluginId,'--limit','256'])).logs.find(row=>row.log_id===invoked.log_id);if(row?.status==='failed')throw Error(row.stderr??row.error??'Open failed');return row?.status==='succeeded';});};
    for(let n=1;n<count;n++){await rpc('pane.focus',{pane_id:natives[n].pane_id});await action();}
    await until('all views ready',async()=>{const views=await store.read('views');return views?.filter(view=>view.open&&view.ready).length===count&&views;});
    const views=await store.read('views');for(const view of views.filter(v=>v.open)){ownedPanes.add(view.paneId);await rpc('pane.send_text',{pane_id:view.paneId,text:'\t\t\t\t\t\t\t'});}
   }
   const controller=count?await store.read('controller'):undefined,views=count?await store.read('views'):[];const roots={server:server.pid,prism:[controller?.pid,...views.map(view=>view.pid)].filter(Number.isSafeInteger),synthetic};fixturePids.push(...roots.prism);
   sampler=createSampler();await delay(3000);
   if(count){const mailbox=new MailboxClient(store.dir,controller.token,10000);const checked=await until('synthetic Messages body and selection in every visible panel',async()=>{const open=(await store.read('views')??[]).filter(view=>view.open);if(open.length!==count)return false;const checks=[];for(const view of open){const response=await rpc('pane.read',{pane_id:view.paneId,source:'visible',lines:60}),text=JSON.stringify(response);if(!text.includes('SYNTHETIC')||!text.includes('Retained messages'))return false;const selected=await mailbox.request('view.inspect',{terminalId:view.terminalId}),index=natives.findIndex(native=>native.terminal_id===view.targetTerminalId),key='pi:benchmark-agent-'+index;if(selected.key!==key||selected.boundSessionKey!==key||!selected.actualVisible||!selected.reportedVisible)return false;const reply=await mailbox.request('view.poll',{terminalId:view.terminalId,key,visible:true,subtree:false,expanded:false}),session=reply.data?.sessions.find(session=>session.key===key);if(session?.evidence.messages.length!==200)return false;checks.push({selectedKey:key,messageCount:200,bodyMarker:true,retainedMessagesHeader:true});}return checks;});result.fixtureAssertions??={};result.fixtureAssertions['panels-'+count]={hydratedVisibleMessagePanels:count,checks:checked,nativeAgents:8,validation:'Pre-measurement readback and same-selection authenticated poll; all fields remain the existing visible Messages state.'};await save();}
   const phase=async(visibility,activity)=>{
    console.log(JSON.stringify({panels:count,visibility,activity,status:'running'}));
    const before=structuredClone(proxy.counters),systemBefore=await systemContext(),start=performance.now(),snapshots=[],echo=[],send=[],polls=[],batches=[];let sampleError,stopSampling=false;const sampling=(async()=>{try{while(!stopSampling){batches.push(await sampler.sample());await delay(1000);}}catch(error){sampleError=error;}})();
    const snapshotWork=(async()=>{for(let n=0;n<samples;n++){await delay(Math.max(0,start+n*duration*1000/samples-performance.now()));const at=performance.now();await snapshot();snapshots.push(performance.now()-at);}})();
    if(activity==='echo')for(let n=0;n<samples;n++){
     await delay(Math.max(0,start+n*duration*1000/samples-performance.now()));const pane=natives[0];assert(ownedPanes.has(pane.pane_id),'input must target an owned fixture pane');const marker='marker-'+n+'-'+randomUUID().slice(0,8),at=performance.now();await rpc('pane.send_text',{pane_id:pane.pane_id,text:marker+'\n'});send.push(performance.now()-at);let reads=0;await until('synthetic echo',async()=>{reads++;const response=await rpc('pane.read',{pane_id:pane.pane_id,source:'recent',lines:8});return JSON.stringify(response).includes('BENCH_ECHO:'+marker);},10000);echo.push(performance.now()-at);polls.push(reads);
    }
    await snapshotWork;await delay(Math.max(0,duration*1000-(performance.now()-start)));stopSampling=true;await sampling;batches.push(await sampler.sample());if(sampleError)throw sampleError;
    const elapsed=performance.now()-start,row={panels:count,visibility,activity,elapsedMs:elapsed,snapshotRoundtripMs:distribution(snapshots),apiSendAcknowledgementMs:distribution(send),apiSendToObservedEchoMs:distribution(echo),echoReadRequests:polls.reduce((sum,n)=>sum+n,0),proxy:counterDelta(proxy.counters,before),resources:summarizeResources(batches,roots),systemBefore,systemAfter:await systemContext(),liveViews:count,allPanelsSameTab:true};result.cases.push(row);await save();console.log(JSON.stringify({panels:count,visibility,activity,status:'passed',echoP95Ms:row.apiSendToObservedEchoMs.p95,snapshotP95Ms:row.snapshotRoundtripMs.p95,prismCpuMedian:row.resources.groups.prism.cpuPercent.median,prismRssMedian:row.resources.groups.prism.rssBytes.median,rpc:row.proxy.methods}));
   };
   const clientPhase=async visibility=>{
    console.log(JSON.stringify({panels:count,visibility,activity:'attached-keyboard',status:'running'}));const helper=path.join(directory,'client-pty.py'),output=path.join(proof,`panels-${count}-${visibility}-client.json`);await writeFile(helper,attachedClientPython);const before=structuredClone(proxy.counters),context=await systemContext();let error;
    try{await exec('python3',['-B',helper,herdr,session,output,String(samples),String(duration)],{env,cwd:directory,encoding:'utf8',timeout:Math.max(60000,samples*3500),maxBuffer:1024*1024});}catch(caught){error=caught;}
    let report;try{report=JSON.parse(await readFile(output,'utf8'));}catch{throw error??Error('Attached client proof missing');}result.cases.push({panels:count,visibility,activity:'attached-keyboard',client:report,proxy:counterDelta(proxy.counters,before),systemBefore:context,systemAfter:await systemContext(),allPanelsSameTab:true});await save();if(error||!report.ok||!report.clientReaped)throw Error(report.error??error?.message??'Client did not complete/reap');console.log(JSON.stringify({panels:count,visibility,activity:'attached-keyboard',status:'passed',keyP95Ms:report.keyToGridEchoMs.p95,keyP99Ms:report.keyToGridEchoMs.p99,bytes:report.clientOutputBytes}));
   };
   await rpc('pane.focus',{pane_id:natives[0].pane_id});if(clientOnly)await clientPhase('visible');else{await phase('visible','idle');await phase('visible','echo');}
   if(count){const hidden=await cli(['tab','create','--workspace',workspace.workspace.workspace_id,'--cwd',directory,'--label','Hidden-panel benchmark','--focus']);if(clientOnly){const hiddenEcho=path.join(directory,'fixtures','echo');await writeFile(hiddenEcho,clientEchoCode.replace("process.title='pi'","process.title='bench-echo'"));await cli(['pane','run',hidden.root_pane.pane_id,'exec '+quote(process.execPath)+' '+quote(hiddenEcho)]);const pid=await until('hidden fixture echo ready',async()=>{const response=await rpc('pane.read',{pane_id:hidden.root_pane.pane_id,source:'recent',lines:8});const match=/BENCH_READY_PID:(\d+)/.exec(JSON.stringify(response));return match&&Number(match[1]);});fixturePids.push(pid);assert(!(await snapshot()).agents.some(agent=>agent.terminal_id===hidden.root_pane.terminal_id),'hidden echo target must be an ordinary fixture, not a detected agent');}await delay(3000);if(clientOnly)await clientPhase('hidden');else{await phase('hidden','idle');await phase('hidden','echo');}}
   success=true;
  }catch(error){result.error=error.stack;await save();throw error;}
  finally{
   await sampler?.close().catch(()=>{});if(installOptions)try{const managedDir=installed?.managedDir??installOptions.managedDir;let receipt;try{receipt=await readFile(path.join(managedDir,'.hat-managed-install.json'));}catch(error){if(error.code!=='ENOENT')throw error;}if(receipt)await liveUninstall({...installOptions,managedDir});}catch(error){result.cleanupErrors??=[];result.cleanupErrors.push(error.message);await save();}
   try{if(server.exitCode===null)await cli(['server','stop']);}catch{if(server.exitCode===null)server.kill();}if(server.exitCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill();resolve();},5000);server.once('exit',()=>{clearTimeout(timer);resolve();});});await proxy?.close();await log.close();try{await until('owned process cleanup',()=>fixturePids.every(pid=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}}),10000);}catch(error){result.cleanupErrors??=[];result.cleanupErrors.push(error.message);await save();}if(success&&!result.cleanupErrors)await rm(directory,{recursive:true,force:true});
  }
 }
 result.ok=!result.cleanupErrors;await save();return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let n=2;n<process.argv.length;n++){const key=process.argv[n];if(key==='--help'){console.log('node scripts/benchmark-interactivity.mjs --release DIR [--herdr PATH] [--proof DIR] [--panels 0,1,4,8] [--samples 100] [--duration 8] [--client-only]\nPrivate synthetic Herdr servers only. Headless API echo is a responsiveness proxy. --client-only uses an actual attached Herdr TUI and reconstructed Unix PTY grid (requires python3), in a separate proof directory.');process.exit(0);}if(key==='--client-only'){options.clientOnly=true;continue;}assert(['--release','--herdr','--proof','--panels','--samples','--duration'].includes(key)&&process.argv[n+1],'Unknown or incomplete option '+key);const value=process.argv[++n];options[key.slice(2)]=key==='--panels'?value.split(',').map(Number):['--samples','--duration'].includes(key)?Number(value):value;}
 benchmarkInteractivity(options).then(result=>{console.log(JSON.stringify({ok:result.ok,cases:result.cases.length,proof:options.proof??'artifacts/interactivity-proof'}));if(!result.ok)process.exitCode=1;}).catch(error=>{console.error(error.stack);process.exitCode=1;});
}
