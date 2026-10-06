import { StringDecoder } from 'node:string_decoder';
const keys = { '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left', '\x1b[H': 'home', '\x1b[F': 'end', '\x1b[1~': 'home', '\x1b[4~': 'end', '\x1b[5~': 'pageup', '\x1b[6~': 'pagedown', '\x1b[Z': 'shift+tab' };
export class InputDecoder {
    buffer = '';
    utf8 = new StringDecoder('utf8');
    feed(input) {
        this.buffer += typeof input === 'string' ? input : this.utf8.write(input);
        const events = [];
        while (this.buffer) {
            if (this.buffer[0] === '\x1b') {
                const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.buffer);
                if (mouse) {
                    events.push({ type: 'mouse', button: Number(mouse[1]), x: Number(mouse[2]), y: Number(mouse[3]), release: mouse[4] === 'm' });
                    this.buffer = this.buffer.slice(mouse[0].length);
                    continue;
                }
                const sequence = Object.keys(keys).find(k => this.buffer.startsWith(k));
                if (sequence) {
                    events.push({ type: 'key', key: keys[sequence] });
                    this.buffer = this.buffer.slice(sequence.length);
                    continue;
                }
                if (Object.keys(keys).some(k => k.startsWith(this.buffer)) || /^\x1b\[<[\d;]*$/.test(this.buffer))
                    break;
                const unknown = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(this.buffer);
                if (unknown) {
                    this.buffer = this.buffer.slice(unknown[0].length);
                    continue;
                }
                if (this.buffer.length === 1)
                    break;
                this.buffer = this.buffer.slice(1);
                events.push({ type: 'key', key: 'escape' });
                continue;
            }
            const code = this.buffer.codePointAt(0);
            const character = String.fromCodePoint(code);
            this.buffer = this.buffer.slice(character.length);
            const translated = { '\r': 'enter', '\n': 'enter', '\t': 'tab', ' ': 'space', '\x7f': 'backspace', '\x08': 'backspace', '\x03': 'ctrl+c' };
            if (translated[character])
                events.push({ type: 'key', key: translated[character] });
            else if (code >= 32)
                events.push({ type: 'key', key: character });
        }
        return events;
    }
    flushEscape() { if (this.buffer === '\x1b') {
        this.buffer = '';
        return [{ type: 'key', key: 'escape' }];
    } if (this.buffer.length > 128)
        this.buffer = ''; return []; }
}
