import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {TerminalUi} from '../src/tui/terminal.ts';
class Tty extends EventEmitter {isTTY=true;columns=60;rows=20;text='';write(text:string){this.text+=text;return true;}setRawMode(){}resume(){}pause(){}destroy(){}}
const frame=(text='same',cursor?:{line:number;column:number})=>({lines:[text],selectedLine:-1,terminalCursor:cursor} as any);
function fixture(t:any){const input=new Tty(),output=new Tty(),ui=new TerminalUi({input,output} as any);t.after(()=>ui.close());return {input,output,ui};}
test('identical terminal frames produce no PTY output, including cursor visibility commands',async t=>{
 const {ui,output}=fixture(t);ui.paint(frame(),{immediate:true} as any);assert.match(output.text,/same/);output.text='';ui.paint(frame());await delay(120);assert.equal(output.text,'');
});
test('cursor-only updates preserve rendered rows and unchanged cursor emits nothing',async t=>{
 const {ui,output}=fixture(t);ui.paint(frame(),{immediate:true} as any);output.text='';ui.paint(frame('same',{line:1,column:3}),{immediate:true} as any);assert.match(output.text,/\x1b\[1;3H\x1b\[\?25h/);assert.ok(!output.text.includes('[2K'));output.text='';ui.paint(frame('same',{line:1,column:3}));await delay(120);assert.equal(output.text,'');
});
test('background invalidations coalesce rendering itself and retain only the latest state',async t=>{
 const {ui,output}=fixture(t);let rendered=0;ui.paint(frame(),{immediate:true} as any);output.text='';
 (ui as any).requestPaint(()=>{rendered++;return frame('old');});(ui as any).requestPaint(()=>{rendered++;return frame('latest');});await delay(120);assert.equal(rendered,1);assert.match(output.text,/latest/);assert.ok(!output.text.includes('old'));
});
test('input-priority rendering cancels a stale background frame instead of delaying or reverting typed text',async t=>{
 const {ui,output}=fixture(t);ui.paint(frame(),{immediate:true} as any);output.text='';let staleRenders=0;
 (ui as any).requestPaint(()=>{staleRenders++;return frame('stale');});(ui as any).requestPaint(()=>frame('typed'),{immediate:true});assert.match(output.text,/typed/);output.text='';await delay(120);assert.equal(staleRenders,0);assert.equal(output.text,'');
});

test('decoded local input paints synchronously without a background cadence delay',async t=>{
 const {ui,input,output}=fixture(t);ui.start();ui.requestPaint(()=>frame('initial'));assert.match(output.text,/initial/);output.text='';
 ui.requestPaint(()=>frame('queued'));ui.on('input',()=>ui.requestPaint(()=>frame('key echoed')));input.emit('data',Buffer.from('a'));
 assert.match(output.text,/key echoed/);output.text='';await delay(120);assert.equal(output.text,'');
});
test('hidden panels cancel pending rendering and produce no output until visibility resumes',async t=>{
 const {ui,output}=fixture(t);ui.requestPaint(()=>frame('initial'));output.text='';let renders=0;
 ui.requestPaint(()=>{renders++;return frame('queued');});(ui as any).setVisible(false);
 ui.requestPaint(()=>{renders++;return frame('hidden');});await delay(120);assert.equal(renders,0);assert.equal(output.text,'');
 (ui as any).setVisible(true);ui.requestPaint(()=>{renders++;return frame('resumed');});await delay(120);assert.equal(renders,1);assert.match(output.text,/resumed/);
});
