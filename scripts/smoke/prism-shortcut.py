"""Real prefix+i key dispatch on this test's isolated Herdr client."""
import errno, fcntl, json, os, pty, select, signal, struct, subprocess, sys, termios, time
herdr, session = sys.argv[1:3]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))
def controlling_terminal():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    os.tcsetpgrp(0, os.getpgrp())
child = subprocess.Popen([herdr, '--session', session], stdin=slave, stdout=slave, stderr=slave, close_fds=True, preexec_fn=controlling_terminal)
os.close(slave)
output = bytearray()
def read(wait=0.1):
    if select.select([master], [], [], wait)[0]:
        try: chunk = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO: return
            raise
        output.extend(chunk)
        if len(output) > 2 * 1024 * 1024: del output[:-1024 * 1024]
try:
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline and not output: read()
    if not output: raise RuntimeError('Client did not render')
    # Let the isolated client finish its initial render before input.
    ready_at = time.monotonic() + 2
    while time.monotonic() < ready_at: read()
    canonical = bool(termios.tcgetattr(master)[3] & termios.ICANON)
    foreground = os.tcgetpgrp(master) == child.pid
    if canonical or not foreground: raise RuntimeError('Client input is not raw in its own foreground group')
    at = len(output)
    os.write(master, b'\x02'); time.sleep(0.2); os.write(master, b'i')
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        read()
        # Native client repaints can split a label into individual cursor writes.
        snapshot = json.loads(subprocess.check_output([herdr, '--session', session, 'api', 'snapshot'], timeout=5))['result']['snapshot']
        if len(snapshot['panes']) > 1:
            panel = snapshot['panes'][-1]['pane_id']
            screen = subprocess.check_output([herdr, '--session', session, 'pane', 'read', panel, '--source', 'visible', '--lines', '40'], timeout=5)
            if b'[Overview]' in screen or b'< Overview >' in screen: break
    else:
        sys.stderr.write('Controlled client capture: '+repr(bytes(output[:6000]))+'\n')
        sys.stderr.write('Controlled plugin logs: '+subprocess.check_output([herdr, '--session', session, 'plugin', 'log', 'list', '--plugin', 'iob.herdr-prism', '--limit', '5'], timeout=5).decode()+'\n')
        raise RuntimeError('Ctrl+B then i did not open actual Prism Overview')
    print(json.dumps({'ok': True, 'actualControllingPTY': True, 'rawInput': not canonical, 'ownForegroundGroup': foreground, 'prefix': 'ctrl+b', 'key': 'i', 'prismOpened': True, 'capturedBytes': len(output)}))
finally:
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        deadline = time.monotonic() + 5
        while child.poll() is None and time.monotonic() < deadline: read()
        if child.poll() is None: os.kill(child.pid, signal.SIGKILL)
        child.wait(timeout=5)
    os.close(master)
