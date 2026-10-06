import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cellWidth} from '../src/tui/text.ts';

const api = await import('../src/tui/preview.ts').catch(()=>({})) as any;

test('all terminal designs keep selectable summaries, arrows and contextual help at every width',()=>{
  assert.equal(typeof api.renderPreview,'function');
  for(const width of [36,50,80,120])for(const view of api.previewViews){
    const frame=api.renderPreview(view,{width,height:34,selected:0});
    assert.equal(frame.lines.length,34);
    assert.ok(frame.lines.some((line:string)=>line.includes('DESIGN')));
    for(const line of frame.lines)assert.ok(cellWidth(line)<=width,`${view}/${width}: ${line}`);
    for(const entry of frame.entries){
      assert.ok(entry.help?.length,`${view}: ${entry.id} has no help`);
      if(entry.target||entry.detail)assert.ok(entry.display.endsWith('→'),`${view}: ${entry.id} has no arrow`);
      assert.ok(cellWidth(entry.display)<=width-4,`${view}: ${entry.display}`);
    }
    if(view!=='Notes editor')assert.ok(frame.footer.includes('? help'));
  }
});

test('Overview summaries navigate to their matching tab and help stays separate from content',()=>{
  assert.equal(typeof api.renderPreview,'function');
  const frame=api.renderPreview('Overview',{width:50,height:34});
  for(const [id,target]of [['processes','Processes'],['git','Git'],['todo','To-do'],['agents','Agents'],['messages','Messages'],['refs','Refs']]){
    assert.equal(frame.entries.find((entry:any)=>entry.id===id)?.target,target);
  }
  const goal=frame.entries.find((entry:any)=>entry.id==='goal');
  const help=api.renderPreview('Help',{width:50,height:34,entry:goal});
  const detail=api.renderPreview('Detail',{width:50,height:34,entry:goal});
  assert.ok(help.lines.join('\n').includes('Enter opens'));
  assert.ok(!detail.lines.join('\n').includes(goal.help));
  assert.ok(detail.lines.join('\n').includes('reliable monitoring'));
});

test('short terminals scroll the selected row into view and ASCII/mono output has no hidden escapes',()=>{
  assert.equal(typeof api.renderPreview,'function');
  const frame=api.renderPreview('Overview',{width:36,height:12,selected:12,ascii:true,theme:'mono'});
  assert.ok(frame.selectedLine>=frame.bodyStart&&frame.selectedLine<frame.lines.length-2);
  assert.ok(frame.lines[frame.selectedLine].includes('>'));
  const output=api.formatPreview(frame,{color:false});
  assert.ok(!output.includes('\x1b'));
  assert.ok(!output.includes('→'));
  for(const line of frame.lines)assert.ok(cellWidth(line)<=36);
});

test('wide Overview uses two regions while narrow Overview keeps one readable column',()=>{
  assert.equal(typeof api.renderPreview,'function');
  const narrow=api.renderPreview('Overview',{width:50,height:34});
  const wide=api.renderPreview('Overview',{width:80,height:34});
  assert.equal(narrow.columns,1);
  assert.equal(wide.columns,2);
  assert.ok(wide.lines.some((line:string)=>line.includes('Resources')&&line.includes('Work')));
});

test('every selected entry is fully displayed and Git colors distinguish additions and deletions',()=>{
  for(const width of [36,50,80,120])for(const view of api.previewViews){
    const initial=api.renderPreview(view,{width,height:12});
    for(let selected=0;selected<initial.entries.length;selected++){
      const frame=api.renderPreview(view,{width,height:12,selected});
      assert.ok(frame.lines[frame.selectedLine].includes(frame.entries[selected].display),`${view}/${width}/${selected}`);
    }
  }
  const frame=api.renderPreview('Git',{width:50,height:34});
  const spans=frame.spans.flat();
  assert.ok(spans.some((span:any)=>span.text==='+128'&&span.role==='positive'));
  assert.ok(spans.some((span:any)=>span.text==='-37'&&span.role==='negative'));
});

test('process, scope and ref details separate aligned labels from styled full values',()=>{
  const process=api.renderPreview('Processes',{width:50,height:34}).entries.find((entry:any)=>entry.id==='p1');
  const coverage=api.renderPreview('Processes',{width:50,height:34}).entries.find((entry:any)=>entry.id==='process-scope');
  const ref=api.renderPreview('Refs',{width:50,height:34}).entries.find((entry:any)=>entry.id==='ref-session');
  for(const width of [36,50,80,120])for(const [entry,headings,label,value] of [
    [process,['Identity','Resources','Ownership'],'PID','4102'],
    [coverage,['Selected scope','Readable samples','Aggregate readings'],'CPU','4/4 readable'],
    [ref,['Reference target','Recorded facts'],'Name','session.ts'],
  ] as any[]){
    const frame=api.renderPreview('Detail',{entry,width,height:40});
    for(const heading of headings)assert.ok(frame.lines.some((line:string)=>line.includes(heading)),`${entry.id}: ${heading}`);
    const line=frame.spans.find((line:any[])=>line.some(span=>span.text.trim()===label));
    assert.ok(line,`${entry.id}: ${label}`);
    assert.equal(line.find((span:any)=>span.text.trim()===label).role,'secondary');
    assert.ok(line.some((span:any)=>span.text.includes(value)&&span.role!=='secondary'),`${entry.id}: styled ${value}`);
    if(entry.id==='process-scope')assert.ok(line.some((span:any)=>span.text.trim()===value));
    for(const line of frame.lines)assert.ok(cellWidth(line)<=width);
  }
});
