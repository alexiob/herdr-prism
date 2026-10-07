import { EventEmitter } from 'node:events';
import { InputDecoder } from './input.ts';
import type { InputEvent } from './input.ts';
import type { RenderedScreen } from './types.ts';
import {styleSpans} from './theme.ts';
export class TerminalUi extends EventEmitter {
    private decoder = new InputDecoder();
    private frame?: RenderedScreen;
    private escapeTimer?: NodeJS.Timeout;
    private closed = false;
    private interactive: boolean;
    private mono: boolean;
    private pending?: () => RenderedScreen;
    private paintTimer?: NodeJS.Timeout;
    private lastPaint = 0;
    private inputUntil = 0;
    private visible = true;
    private input: NodeJS.ReadStream;
    private output: NodeJS.WriteStream;
    constructor(options: {
        monochrome?: boolean;
        input?: NodeJS.ReadStream;
        output?: NodeJS.WriteStream;
    } = {}) { super(); this.input=options.input??process.stdin;this.output=options.output??process.stdout;this.mono = options.monochrome === true; this.interactive = this.input.isTTY && this.output.isTTY; }
    setMonochrome(value: boolean) { this.mono = value; this.frame = undefined; }
    setVisible(visible:boolean) {if(!this.interactive||this.visible===visible)return;this.visible=visible;if(!visible){clearTimeout(this.paintTimer);this.paintTimer=undefined;this.pending=undefined;}}
    get columns() { return this.output.columns || 80; }
    get rows() { return this.output.rows || 24; }
    start() { if (this.closed || !this.interactive)
        return; this.frame=undefined;this.pending=undefined;clearTimeout(this.paintTimer);this.paintTimer=undefined;this.lastPaint=0;this.input.setRawMode(true); this.input.resume(); this.input.on('data', this.onData); this.output.on('resize', this.onResize); this.output.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[?2004h'); }
    private onResize = () => { this.frame = undefined; this.emit('resize'); };
    private dispatch = (event: InputEvent) => {this.inputUntil=Date.now()+200;this.emit('input', event);};
    private onData = (data: Buffer) => { clearTimeout(this.escapeTimer); for (const event of this.decoder.feed(data))
        this.dispatch(event); this.escapeTimer = setTimeout(() => { for (const event of this.decoder.flushEscape())
        this.dispatch(event); }, 40); };
    paint(frame: RenderedScreen,options:{immediate?:boolean}={}) {this.requestPaint(()=>frame,options);}
    /** Coalesce the expensive render, not just its output. Local input bypasses
     * background cadence and cancels any queued, older frame. */
    requestPaint(render:()=>RenderedScreen,{immediate=false}:{immediate?:boolean}={}) {
        if(this.closed||!this.visible)return;
        if(!this.interactive||!this.frame||immediate||Date.now()<this.inputUntil){clearTimeout(this.paintTimer);this.paintTimer=undefined;this.pending=undefined;this.flush(render());return;}
        this.pending=render;
        if(!this.paintTimer)this.paintTimer=setTimeout(()=>{this.paintTimer=undefined;const latest=this.pending;this.pending=undefined;if(latest&&!this.closed)this.flush(latest());},Math.max(0,100-(Date.now()-this.lastPaint)));
    }
    private flush(frame: RenderedScreen) {
        if (this.closed)
            return;
        this.lastPaint = Date.now();
        if (!this.interactive) {
            if (!this.frame)
                this.output.write(frame.lines.join('\n') + '\n');
            this.frame = frame;
            return;
        }
        let output = '';
        for (let i = 0; i < frame.lines.length; i++) {
            const selected = i === frame.selectedLine;
            const previous = this.frame?.lines[i];
            const wasSelected = i === this.frame?.selectedLine;
            if (previous === frame.lines[i] && selected === wasSelected && JSON.stringify(this.frame?.spans?.[i])===JSON.stringify(frame.spans?.[i]))
                continue;
            const line = frame.lines[i];
            const rendered=frame.spans?.[i]?styleSpans(frame.spans[i]!,{theme:this.mono?'mono':frame.theme??'dark',depth:/^(truecolor|24bit)$/.test(process.env.COLORTERM??'')?24:process.env.TERM?.includes('256color')?8:4}):line;
            output += `\x1b[${i + 1};1H\x1b[2K${rendered}\x1b[0m`;
        }
        if(output||!this.frame||this.frame.terminalCursor?.line!==frame.terminalCursor?.line||this.frame.terminalCursor?.column!==frame.terminalCursor?.column)
            output+=frame.terminalCursor?`\x1b[${frame.terminalCursor.line};${frame.terminalCursor.column}H\x1b[?25h`:'\x1b[?25l';
        if (output)
            this.output.write(output);
        this.frame = frame;
    }
    close() { if (this.closed)
        return; this.closed = true;this.pending=undefined; clearTimeout(this.paintTimer); clearTimeout(this.escapeTimer); this.input.off('data', this.onData); this.output.off('resize', this.onResize); if (this.interactive) {
        this.input.setRawMode(false);
        this.input.pause();
        // The pane owns this input stream. Finish pending Windows console reads
        // after restoring its mode, rather than leaving a paused TTY handle alive.
        if(process.platform==='win32')this.input.destroy();
        this.output.write('\x1b[?2004l\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l');
    } }
}
