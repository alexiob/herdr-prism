import { spawn } from 'node:child_process';
/** One readonly interpreter amortizes PowerShell startup. Paths are JSON data,
 * never script text. Requests are serialized and bounded; stdin EOF terminates
 * the interpreter when its owning Node process exits. No ACL result is cached. */
export function windowsInspector(inspection, options = {}) {
    const timeoutMs = options.timeoutMs ?? 15000, maxPending = options.maxPending ?? 64;
    let queued = 0;
    let child, buffer = '', ready = false, idle;
    let pending;
    let queue = Promise.resolve();
    // Read the redirected pipe explicitly. Console encoding setters can interact
    // with an attached ConPTY; this worker must never consume the pane's input.
    const script = "$ErrorActionPreference='Stop'; $encoding=[Text.UTF8Encoding]::new($false); $reader=[IO.StreamReader]::new([Console]::OpenStandardInput(),$encoding); $writer=[IO.StreamWriter]::new([Console]::OpenStandardOutput(),$encoding); $writer.AutoFlush=$true; $writer.WriteLine('PRISM_ACL_READY'); while($null -ne ($line=$reader.ReadLine())) { $writer.WriteLine('PRISM_ACL_RECEIVED'); try { $env:HAT_PRIVATE_PATH=ConvertFrom-Json -InputObject $line; $result=& { " + inspection + " }; $writer.WriteLine([string]$result) } catch { $writer.WriteLine([string]([pscustomobject]@{inspectionError=$_.Exception.Message} | ConvertTo-Json -Compress)) } }";
    const send = () => { if (ready && pending && !pending.sent) {
        pending.sent = true;
        child.stdin.write(JSON.stringify(pending.path) + '\n');
    } };
    const stop = () => { clearTimeout(idle); const old = child; child = undefined; buffer = ''; ready = false; old?.stdin.end(); };
    const fail = (error) => { const task = pending; pending = undefined; if (task) {
        clearTimeout(task.timer);
        task.reject(error);
    } const old = child; stop(); old?.kill(); };
    const inspect = async (path, remaining) => new Promise((resolve, reject) => {
        clearTimeout(idle);
        if (!child) {
            const worker = options.spawnWorker?.(script) ?? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe' });
            child = worker;
            worker.stdout.setEncoding('utf8');
            worker.stderr.resume();
            worker.on('error', error => { if (child === worker)
                fail(error); });
            worker.stdin.on('error', error => { if (child === worker)
                fail(error); });
            worker.on('exit', () => { if (child === worker)
                fail(new Error('Windows ACL inspector exited')); });
            worker.stdout.on('data', (chunk) => {
                if (child !== worker)
                    return;
                buffer += chunk;
                if (buffer.length > 65536) {
                    fail(new Error('Windows ACL inspection exceeds limit'));
                    return;
                }
                while (buffer.includes('\n')) {
                    const end = buffer.indexOf('\n');
                    const value = buffer.slice(0, end).trim();
                    buffer = buffer.slice(end + 1);
                    if (value === 'PRISM_ACL_READY') {
                        if (ready) {
                            fail(new Error('Duplicate Windows ACL worker readiness'));
                            return;
                        }
                        ready = true;
                        send();
                        continue;
                    }
                    const task = pending;
                    if (!ready || !task?.sent) {
                        fail(new Error('Unsolicited Windows ACL inspection'));
                        return;
                    }
                    if (value === 'PRISM_ACL_RECEIVED') {
                        if (task.received) {
                            fail(new Error('Duplicate Windows ACL request receipt'));
                            return;
                        }
                        task.received = true;
                        continue;
                    }
                    pending = undefined;
                    clearTimeout(task.timer);
                    task.resolve(value);
                    // Idle subprocesses must not keep a finite command alive. Pending requests
                    // retain their normal pipe handles; close the interpreter after a short idle.
                    worker.unref();
                    for (const stream of [worker.stdin, worker.stdout, worker.stderr])
                        stream.unref?.();
                    idle = setTimeout(stop, 1000);
                    idle.unref();
                }
            });
        }
        child.ref();
        for (const stream of [child.stdin, child.stdout, child.stderr])
            stream.ref?.();
        pending = { path, sent: false, received: false, resolve, reject, timer: setTimeout(() => fail(new Error('Windows ACL inspection timed out ' + (!ready ? 'awaiting worker readiness' : pending?.received ? 'during ACL inspection' : 'awaiting request receipt'))), remaining) };
        send();
    });
    return path => {
        if (queued >= maxPending)
            return Promise.reject(new Error('Windows ACL inspection queue limit exceeded'));
        queued++;
        const deadline = Date.now() + timeoutMs;
        const result = queue.then(() => { const remaining = deadline - Date.now(); if (remaining <= 0)
            throw new Error('Windows ACL inspection timed out in queue'); return inspect(path, remaining); }).finally(() => { queued--; });
        queue = result.catch(() => { });
        return result;
    };
}
