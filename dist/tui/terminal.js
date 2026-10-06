import { EventEmitter } from 'node:events';
import { InputDecoder } from "./input.js";
export class TerminalUi extends EventEmitter {
    decoder = new InputDecoder();
    frame;
    escapeTimer;
    closed = false;
    interactive;
    mono;
    pending;
    paintTimer;
    lastPaint = 0;
    constructor(options = {}) { super(); this.mono = options.monochrome === true; this.interactive = process.stdin.isTTY && process.stdout.isTTY; }
    setMonochrome(value) { this.mono = value; this.frame = undefined; }
    get columns() { return process.stdout.columns || 80; }
    get rows() { return process.stdout.rows || 24; }
    start() {
        if (this.closed || !this.interactive)
            return;
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', this.onData);
        process.stdout.on('resize', this.onResize);
        process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h');
    }
    onResize = () => { this.frame = undefined; this.emit('resize'); };
    dispatch = (event) => this.emit('input', event);
    onData = (data) => {
        clearTimeout(this.escapeTimer);
        for (const event of this.decoder.feed(data))
            this.dispatch(event);
        this.escapeTimer = setTimeout(() => {
            for (const event of this.decoder.flushEscape())
                this.dispatch(event);
        }, 40);
    };
    paint(frame) {
        if (this.closed)
            return;
        if (this.interactive && Date.now() - this.lastPaint < 100) {
            this.pending = frame;
            if (!this.paintTimer)
                this.paintTimer = setTimeout(() => {
                    this.paintTimer = undefined;
                    const pending = this.pending;
                    this.pending = undefined;
                    if (pending)
                        this.flush(pending);
                }, Math.max(1, 100 - (Date.now() - this.lastPaint)));
            return;
        }
        this.flush(frame);
    }
    flush(frame) {
        if (this.closed)
            return;
        this.lastPaint = Date.now();
        if (!this.interactive) {
            if (!this.frame)
                process.stdout.write(frame.lines.join('\n') + '\n');
            this.frame = frame;
            return;
        }
        let output = '';
        for (let i = 0; i < frame.lines.length; i++) {
            const selected = i === frame.selectedLine;
            const previous = this.frame?.lines[i];
            const wasSelected = i === this.frame?.selectedLine;
            if (previous === frame.lines[i] && selected === wasSelected)
                continue;
            const line = frame.lines[i];
            const style = selected ? '\x1b[7m' : this.mono ? '' : i < 3 ? '\x1b[1;36m' : line.includes('conflicts') ? '\x1b[33m' : '';
            output += `\x1b[${i + 1};1H\x1b[2K${style}${line}\x1b[0m`;
        }
        if (output)
            process.stdout.write(output);
        this.frame = frame;
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        clearTimeout(this.paintTimer);
        clearTimeout(this.escapeTimer);
        process.stdin.off('data', this.onData);
        process.stdout.off('resize', this.onResize);
        if (this.interactive) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            // The pane owns this input stream. Finish pending Windows console reads
            // after restoring its mode, rather than leaving a paused TTY handle alive.
            if (process.platform === 'win32')
                process.stdin.destroy();
            process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l');
        }
    }
}
