"""Real Unix PTY interaction. Only the disposable --demo process is controlled."""
import errno
import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time

node, entry = sys.argv[1:3]
termination = '--termination' in sys.argv[3:]
master = slave = None
child = None
output = bytearray()
eof = False
start = time.monotonic()

def read_once(wait=0.05):
    global eof
    if master is None or eof:
        return
    if select.select([master], [], [], wait)[0]:
        try:
            data = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                eof = True
                return
            raise
        if not data:
            eof = True
        else:
            output.extend(data)
            if len(output) > 1024 * 1024:
                raise RuntimeError('PTY output exceeded bounded smoke capture')

def wait_for(predicate, label, timeout=3):
    deadline = min(start + 18, time.monotonic() + timeout)
    while time.monotonic() < deadline:
        if predicate():
            return
        read_once()
        if eof or child.poll() is not None:
            if predicate():
                return
            raise RuntimeError('interactive PTY ended before ' + label)
    raise RuntimeError('PTY timeout waiting for ' + label)

def quiet():
    deadline = time.monotonic() + 0.15
    while time.monotonic() < deadline:
        read_once(0.02)

def size(columns, rows):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
    # The child owns an isolated session. Notify only that process after updating the actual PTY.
    os.kill(child.pid, signal.SIGWINCH)

try:
    master, slave = pty.openpty()
    if not os.isatty(slave):
        raise RuntimeError('PTY slave is not an actual terminal')
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
    env = dict(os.environ)
    env['TERM'] = 'xterm-256color'
    child = subprocess.Popen([node, entry, '--demo', '--ascii', '--monochrome'], stdin=slave, stdout=slave, stderr=slave, close_fds=True, start_new_session=True, env=env)
    os.close(slave)
    slave = None
    wait_for(lambda: b'\x1b[?1049h' in output and b'[Overview]' in output, 'interactive alternate-screen Overview')
    quiet()
    at = len(output)
    os.write(master, b'\t')
    wait_for(lambda: b'[Agents]' in output[at:], 'Tab changing the active Agents view')
    quiet()
    at = len(output)
    os.write(master, b'\x1b[B')
    wait_for(lambda: len(output) > at, 'Down arrow changing selection')
    quiet()
    at = len(output)
    os.write(master, b'\x1b[A')
    wait_for(lambda: len(output) > at, 'Up arrow changing selection')
    quiet()
    at = len(output)
    size(26, 12)
    wait_for(lambda: b'[Agents]' in output[at:], '80x24 to 26x12 resize repaint')
    quiet()
    at = len(output)
    size(80, 24)
    wait_for(lambda: b'[Agents]' in output[at:], '26x12 to 80x24 resize repaint')
    quiet()
    if termination:
        at = len(output)
        os.write(master, b'\t')
        wait_for(lambda: b'[Processes]' in output[at:], 'Processes view')
        quiet()
        at = len(output)
        os.write(master, b'\x1b[BK')
        wait_for(lambda: b'Confirmation' in output[at:] and b'Cancel' in output[at:], 'K confirmation')
        quiet()
        at = len(output)
        os.write(master, b'\r')
        wait_for(lambda: b'Owned processes' in output[at:], 'default Cancel returning to list')
        quiet()
        at = len(output)
        os.write(master, b'\r')
        wait_for(lambda: b'Identity' in output[at:], 'complete process details')
        quiet()
        at = len(output)
        os.write(master, b'K')
        wait_for(lambda: b'Confirmation' in output[at:], 'K confirmation from details')
        quiet()
        at = len(output)
        os.write(master, b'y')
        wait_for(lambda: b'Demo: simulated termination' in output[at:] and b'no OS signal sent' in output[at:], 'explicit demo confirmation without OS signal')
        quiet()
    os.write(master, b'q')
    wait_for(lambda: b'\x1b[?1049l' in output, 'alternate-screen cleanup')
    code = child.wait(timeout=3)
    deadline = time.monotonic() + 2
    while not eof and time.monotonic() < deadline:
        read_once()
    if code != 0 or not eof:
        raise RuntimeError('PTY child did not exit cleanly and close every terminal descriptor')
    print(json.dumps({'ok': True, 'transport': 'PTY', 'keyboard': True, 'resize': True, 'terminationConfirmation': termination, 'exitCode': code, 'eof': eof, 'sizes': [[80, 24], [26, 12], [80, 24]], 'capturedBytes': len(output)}))
except Exception as error:
    print('PTY smoke unavailable or failed: ' + str(error) + (' childPid=' + str(child.pid) if child is not None else ''), file=sys.stderr)
    sys.exit(1)
finally:
    if child is not None and child.poll() is None:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=3)
    for fd in (slave, master):
        if fd is not None:
            os.close(fd)
