"""Actual PTY frame timing; controlled RPC source is explicitly separate from Herdr."""
import errno, fcntl, json, os, pty, select, signal, struct, subprocess, sys, termios, time
node, worker, config, report_path = sys.argv[1:5]
master = slave = control_read = control_write = status_read = status_write = None
child = None
captured = 0
tail = b''
statuses = b''
events = []
keys = []
pending_events = {}
pending_key = None
phase = None
tab = 0
tabs = ['Overview','Agents','Processes','Messages','Refs','To-do']
sequence = 0
eof = False
finished = False
draining = False
drain_deadline = None
next_event = next_key = 0
def close_fd(fd):
    if fd is not None:
        try: os.close(fd)
        except OSError: pass
def percentile(values):
    if not values: return None
    ordered=sorted(values)
    return ordered[min(len(ordered)-1, __import__('math').ceil(len(ordered)*0.95)-1)]
def abort(signum, frame):
    raise RuntimeError('Profile coordinator cancelled')
signal.signal(signal.SIGTERM, abort)
signal.signal(signal.SIGINT, abort)
try:
    options=json.load(open(config))
    master,slave=pty.openpty()
    if not os.isatty(slave): raise RuntimeError('Actual terminal unavailable')
    fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,80,0,0))
    control_read,control_write=os.pipe()
    status_read,status_write=os.pipe()
    node_args=[node]
    if options.get('cpuProf'):
        node_args.extend(['--cpu-prof','--cpu-prof-name=collector.cpuprofile','--cpu-prof-dir='+options['output']])
    child=subprocess.Popen(node_args+[worker,config,str(control_read),str(status_write)],stdin=slave,stdout=slave,stderr=slave,pass_fds=(control_read,status_write),close_fds=True,start_new_session=True)
    close_fd(slave);slave=None
    close_fd(control_read);control_read=None
    close_fd(status_write);status_write=None
    deadline=time.monotonic()+max(30,options['seconds']*2+30)
    while time.monotonic()<deadline:
        now=time.monotonic()
        if phase=='active':
            if now>=next_event:
                sequence+=1
                marker='evt%06d'%sequence
                pending_events[marker.encode()]=now
                os.write(control_write,(json.dumps({'type':'event','marker':marker})+'\n').encode())
                next_event=now+0.5
            if now>=next_key and pending_key is None:
                tab=(tab+1)%len(tabs)
                pending_key=(('['+tabs[tab]+']').encode(),now)
                os.write(master,b'\t')
                next_key=now+0.3
        watched=[status_read]+([] if eof else [master])
        for fd in select.select(watched,[],[],0.01)[0]:
            if fd==master:
                try: data=os.read(master,65536)
                except OSError as error:
                    if error.errno!=errno.EIO: raise
                    data=b''
                if not data:eof=True
                else:
                    captured+=len(data)
                    if captured>32*1024*1024:raise RuntimeError('Bounded terminal capture exceeded')
                    fresh=tail+data
                    at=time.monotonic()
                    for marker,started in list(pending_events.items()):
                        if marker in fresh: events.append((at-started)*1000);del pending_events[marker]
                    if pending_key and pending_key[0] in fresh:
                        keys.append((at-pending_key[1])*1000);pending_key=None
                    # Only retain cross-read fragments; old frames cannot acknowledge new keys.
                    tail=data[-32:]
            else:
                data=os.read(status_read,65536)
                statuses+=data
                while b'\n' in statuses:
                    line,statuses=statuses.split(b'\n',1)
                    status=json.loads(line)
                    if 'error' in status:raise RuntimeError(status['error'])
                    if 'phase' in status:
                        phase=status['phase'];next_event=time.monotonic()+0.15;next_key=time.monotonic()+0.35
                    if status.get('measurementComplete'):
                        phase=None;draining=True;drain_deadline=time.monotonic()+3
                    if status.get('finished'):
                        finished=True;close_fd(control_write);control_write=None
        if draining and not pending_events and pending_key is None:
            os.write(control_write,b'{"type":"drained"}\n');draining=False
        if draining and time.monotonic()>drain_deadline:raise RuntimeError('Acknowledgement drain timeout: pendingEvents=%d pendingKeys=%d'%(len(pending_events),int(pending_key is not None)))
        if any(now-started>3 for started in pending_events.values()):raise RuntimeError('Event did not reach an actual terminal frame; pendingEvents=%d'%len(pending_events))
        if pending_key and now-pending_key[1]>3:raise RuntimeError('Keyboard did not produce an actual terminal frame; pendingKeys=1')
        if child.poll() is not None and eof:break
    if child.poll() is None:raise RuntimeError('Profile worker deadline exceeded')
    if child.returncode!=0 or not finished or not eof:raise RuntimeError('Profile worker did not close cleanly')
    if not keys or not events or pending_key or pending_events:raise RuntimeError('Incomplete latency observations: events=%d keys=%d pendingEvents=%d pendingKeys=%d'%(len(events),len(keys),len(pending_events),int(pending_key is not None)))
    result={'ok':True,'transport':'actual Unix PTY','rpc':'controlled in-process RPC; actual Herdr transport not measured','eventCount':len(events),'eventP95Ms':percentile(events),'eventMaxMs':max(events),'keyboardCount':len(keys),'keyboardP95Ms':percentile(keys),'keyboardMaxMs':max(keys),'capturedBytes':captured,'eof':eof,'exitCode':child.returncode}
    with open(report_path,'w') as output:json.dump(result,output,indent=2);output.write('\n')
except Exception as error:
    print('Host profile failed: '+str(error),file=sys.stderr)
    sys.exit(1)
finally:
    if child is not None and child.poll() is None:
        os.killpg(child.pid,signal.SIGTERM)
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=3)
    for fd in (master,slave,control_read,control_write,status_read,status_write):close_fd(fd)
