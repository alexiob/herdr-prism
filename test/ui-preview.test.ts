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

test('memory, usage and Git details organize facts and highlight quantities, paths and Git changes',()=>{
  const fixtures=[['Overview','memory',['Memory','Sample scope'],'Current','620 MiB','quantity'],
    ['Overview','tokens',['Recorded tokens','Context','Turn','Rates and cost'],'Input','42,180 tokens','quantity'],
    ['Git','git-diff',['Checkout identity','Changes','Tracking','Snapshot'],'Added','+128 lines','positive']] as const;
  for(const [tab,id,headings,label,value,role]of fixtures)for(const width of [36,50,80,120]){
    const entry=api.renderPreview(tab,{width,height:40}).entries.find((e:any)=>e.id===id);
    const frame=api.renderPreview('Detail',{entry,width,height:50});
    for(const heading of headings)assert.ok(frame.lines.some((line:string)=>line.includes(heading)),`${id}: ${heading}`);
    const line=frame.spans.find((parts:any[])=>parts.some(p=>p.text.trim()===label));
    assert.ok(line?.some((p:any)=>p.role==='secondary'&&p.text.trim()===label));
    assert.ok(line?.some((p:any)=>p.role===role),`${id}: ${role}`);
    const labelAt=line.findIndex((p:any)=>p.text.trim()===label);
    const valueParts=line.slice(labelAt+1);
    assert.equal(valueParts.slice(0,valueParts.findIndex((p:any)=>p.role==='border')).map((p:any)=>p.text).join('').trim(),value);
    assert.ok(frame.lines.join('\n').includes(value),`${id}: ${value}`);
    for(const line of frame.lines)assert.ok(cellWidth(line)<=width,`${id}/${width}: ${line}`);
    assert.equal(frame.columns,width>=80?2:1);
  }
  const usage=api.renderPreview('Overview').entries.find((e:any)=>e.id==='tokens');
  const styled=api.renderPreview('Detail',{entry:usage,width:80,height:40}).spans.flat();
  assert.ok(styled.some((p:any)=>p.text.includes('unavailable')&&p.role==='warning'));
  assert.ok(styled.some((p:any)=>p.text.trim()==='tokens'&&p.role==='secondary'));
});

test('fact detail views keep explanation prose in help and preserve full narrative content',()=>{
  for(const [tab,id,explanation]of [['Overview','memory','Shared resident pages'],['Overview','cpu','one logical core'],['Git','git-diff','Git values belong']]){
    const entry=api.renderPreview(tab).entries.find((e:any)=>e.id===id);
    const detail=api.renderPreview('Detail',{entry,width:80,height:50}).lines.join('\n');
    assert.ok(!detail.includes(explanation));
  }
  const goal=api.renderPreview('Overview').entries.find((e:any)=>e.id==='goal');
  assert.ok(api.renderPreview('Detail',{entry:goal,width:80,height:40}).lines.join('\n').includes('reliable monitoring'));
});

test('preview bounds each Overview panel and retains hidden panel metadata in short terminals',()=>{
  for(const height of [10,12,34]){
    const frame=api.renderPreview('Overview',{width:50,height,selected:14});
    assert.ok(frame.sectionRegions,'Overview has no bounded panels');
    assert.equal(frame.sectionRegions.length,6);
    for(const region of frame.sectionRegions){
      assert.ok(region.line>=frame.bodyStart);
      assert.ok(region.line+region.height<=height-2,`${region.id} exceeds its viewport`);
    }
    assert.ok(frame.sectionRegions.find((region:any)=>region.id==='Account / limits').height>=3);
    assert.ok(frame.lines[frame.selectedLine].includes(frame.entries[14].display));
  }
});

test('wide preview reports one column when a short viewport shows only its active panel',()=>{
  const frame=api.renderPreview('Overview',{width:80,height:10});
  assert.equal(frame.columns,1);
  assert.equal(frame.sectionRegions.filter((region:any)=>region.height>0).length,1);
});

test('preview applies alternating whole-entry bands to ordinary lists',()=>{
  const frame=api.renderPreview('Git',{width:50,height:34});
  const surfaces=frame.positions.filter((position:any)=>position.entry<6).map((position:any)=>{
    const interior=frame.spans[position.line].filter((part:any)=>part.role!=='border');
    assert.ok(interior.every((part:any)=>part.surface===interior[0].surface));
    return interior[0].surface;
  });
  assert.deepEqual(surfaces,['messageEven','messageOdd','messageEven','messageOdd','messageEven','messageOdd']);
});

test('message preview selects its complete multiline entry with a single action arrow',()=>{
  const frame=api.renderPreview('Messages',{width:50,height:40,selected:1});
  const positions=frame.positions.filter((position:any)=>position.entry===1);
  assert.ok(positions.length>=2);
  const parts=positions.flatMap((position:any)=>frame.spans[position.line]);
  assert.equal(parts.map((part:any)=>part.text).join('').split('→').length-1,1);
  assert.ok(parts.filter((part:any)=>part.surface).every((part:any)=>part.selected));
});

test('Overview preview separates CPU and RSS chart entries with one blank line',()=>{
  const frame=api.renderPreview('Overview',{width:80,height:40});
  const cpu=frame.entries.findIndex((entry:any)=>entry.id==='cpu'),memory=frame.entries.findIndex((entry:any)=>entry.id==='memory');
  const cpuLine=frame.positions.find((position:any)=>position.entry===cpu).line;
  const memoryLine=frame.positions.find((position:any)=>position.entry===memory).line;
  assert.equal(memoryLine-cpuLine,2);
  assert.match(frame.lines[cpuLine+1].slice(0,39),/^│\s+│$/);
});

test('notes editor preview keeps the actual editor caret inside a short viewport',()=>{
  const frame=api.renderPreview('Notes editor',{width:36,height:12});
  assert.ok(frame.terminalCursor,'editor has no visible caret');
  assert.ok(frame.terminalCursor.line>frame.bodyStart);
  assert.ok(frame.terminalCursor.line<=frame.lines.length-2);
  assert.ok(frame.terminalCursor.column<=36);
  assert.ok(frame.lines.some((line:string)=>line.includes('saved draft')));
});

test('preview scrolls long help inside its bounded panel',()=>{
  const entry={id:'long-help',label:'Reading',help:Array.from({length:50},(_,i)=>`Help paragraph ${i+1}`).join('\n')};
  const first=api.renderPreview('Help',{width:50,height:12,entry});
  const scrolled=api.renderPreview('Help',{width:50,height:12,entry,scroll:20});
  assert.ok(scrolled.lines.some((line:string)=>line.includes('Help paragraph 21')));
  assert.ok(!scrolled.lines.some((line:string)=>line.includes('Help paragraph 1 ')));
  assert.ok(scrolled.sectionRegions,'Help has no bounded panel');
  assert.ok(scrolled.sectionRegions[0].scroll>first.sectionRegions[0].scroll);
});

test('Agents preview keeps worker names and scopes its useful tree without unrelated summaries',()=>{
 const frame=api.renderPreview('Agents',{width:60,height:34}),text=frame.lines.join('\n');for(const name of ['Monitor','Parser','Source','Linux tests'])assert.ok(text.includes(name),name);assert.equal(frame.sectionRegions?.length,1);assert.doesNotMatch(text,/Selected agent|cached · 8s/);
});
