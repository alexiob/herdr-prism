"""Actual host Herdr --remote attachment. Control only this disposable client."""
import base64, errno, fcntl, json, os, pty, re, select, signal, struct, subprocess, sys, termios, time

configuration, control, report = sys.argv[1:4]
def terminate_owned_client(signum, frame):
    raise SystemExit(128 + signum)
signal.signal(signal.SIGTERM, terminate_owned_client)
signal.signal(signal.SIGINT, terminate_owned_client)
config = json.load(open(configuration))
environment = dict(os.environ)
for key in list(environment):
    if key.startswith('HERDR_'):
        del environment[key]
environment.update(config['env'])
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 45, 150, 0, 0))
def own_controlling_terminal():
    # A preopened PTY plus setsid alone is not a controlling terminal. Native
    # Herdr opens /dev/tty for raw input; attach only this fresh private slave.
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    os.tcsetpgrp(0, os.getpgrp())
child = subprocess.Popen(config['argv'], stdin=slave, stdout=slave, stderr=slave, close_fds=True, preexec_fn=own_controlling_terminal, env=environment, cwd=config['cwd'])
os.close(slave)
state = {'pid': child.pid, 'actualPTY': os.isatty(master), 'capturedBytes': 0, 'remoteFixtureSeen': False, 'prismSeen': False, 'remoteHostnameSeen': False, 'disconnectedAppendSeen': False, 'clipboardRemoteRef': False, 'osc52Seen': False, 'inputWrites': []}
output = bytearray()
try:
    while child.poll() is None:
        if select.select([master], [], [], 0.1)[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            output.extend(chunk)
            state['capturedBytes'] += len(chunk)
            if len(output) > 2 * 1024 * 1024:
                del output[:-1024 * 1024]
            for key, marker in [('remoteFixtureSeen', b'REMOTE_SYNTHETIC'), ('prismSeen', b'[Overview]'), ('remoteHostnameSeen', b'prism-remote-fixture'), ('disconnectedAppendSeen', b'APPEND DURING DISCONNECT')]:
                state[key] = state[key] or marker in output
            state['prismSeen'] = state['prismSeen'] or b'< Overview >' in output
            for match in re.finditer(rb'\x1b\]52;[^;]*;([A-Za-z0-9+/=]{1,1024})(?:\x07|\x1b\\)', output):
                state['osc52Seen'] = True
                state['clipboardRemoteRef'] = state['clipboardRemoteRef'] or base64.b64decode(match.group(1)) == b'/home/prism/fixture/checkout/remote.txt'
        if os.path.exists(control):
            request = json.load(open(control))
            if request.get('hostKey') == 'focus-right-tab':
                # Pinned Herdr0.9.3 default is prefix+l. Focus through this real
                # client before Tab; server API focus can differ from client focus.
                for event, data in [('prefix', b'\x02'), ('focus-right', b'l'), ('tab', b'\t')]:
                    written = os.write(master, data)
                    state['inputWrites'].append({'event': event, 'requested': len(data), 'written': written})
                    time.sleep(0.15)
                state['hostTabSent'] = True
                state['inputCanonical'] = bool(termios.tcgetattr(master)[3] & termios.ICANON)
                state['hostOwnForegroundGroup'] = os.tcgetpgrp(master) == child.pid
            if request.get('disconnect'):
                # Drop only this own host connection/process group. Remote daemon
                # and its work must survive; no remote PID is signaled.
                os.killpg(child.pid, signal.SIGTERM)
                state['transportDisconnected'] = True
                state['disconnectSignal'] = 'SIGTERM'
            os.unlink(control)
        temporary = report + '.tmp'
        with open(temporary, 'w') as stream:
            json.dump(state, stream)
        os.replace(temporary, report)
    state['exitCode'] = child.wait(timeout=5)
finally:
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)
    os.close(master)
    state['reaped'] = child.poll() is not None
    with open(report, 'w') as stream:
        json.dump(state, stream)
