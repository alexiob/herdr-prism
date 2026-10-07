import test from 'node:test';
import assert from 'node:assert/strict';
import {demoData} from '../src/runtime/demo.ts';
import {createUiState,renderScreen,handleKey,handleRowClick,handleRowWheel,showDetail,addMessagePage} from '../src/tui/screen.ts';
import {styleSpans} from '../src/tui/theme.ts';
import {cellWidth} from '../src/tui/text.ts';
import {renderPreview} from '../src/tui/preview.ts';

function fixture(){
  const data=demoData(),session=data.sessions[0]!;
  session.evidence.messages=Array.from({length:12},(_,i)=>({id:`m${i}`,role:i%2?'assistant':'user',text:`Message ${i}\n日本語 😀 ${'complete body '.repeat(12)}\nLast line ${i}`,timestamp:i+1}));
  session.evidence.tools=Array.from({length:70},(_,i)=>({id:`t${i}`,name:'exec',status:'done',summary:`Output ${i}\nExact result ${i}`,editedPaths:[`/result/${i}.ts`]}));
  const state=createUiState();state.selectedKey=session.key;state.tab='Messages';state.followMessages=false;
  return {data,state};
}
test('Messages and Tool activity retain fixed independent viewports while navigating either section',()=>{
  for(const width of [26,36,80,120]){
    const {data,state}=fixture();let frame=renderScreen(data,state,width,20);
    const regions=(frame as any).sectionRegions;
    assert.equal(regions?.length,2,'both sections have their own viewport');
    const geometry=regions.map((r:any)=>[r.id,r.y,r.height]);
    handleKey(state,'right',data,frame);frame=renderScreen(data,state,width,20);
    const messages=(frame as any).sectionRegions[0];
    const retained=frame.lines.slice(messages.y-1,messages.y-1+messages.height);
    handleKey(state,'end',data,frame);frame=renderScreen(data,state,width,20);
    assert.equal(state.cursorId,'tool:t69');
    assert.deepEqual((frame as any).sectionRegions.map((r:any)=>[r.id,r.y,r.height]),geometry);
    assert.deepEqual(frame.lines.slice(messages.y-1,messages.y-1+messages.height),retained,'tool scrolling does not move message content or borders');
    assert.ok(frame.lines.some(line=>line.startsWith('┌ Retained messages')));
    assert.ok(frame.lines.some(line=>line.startsWith('┌ Tool activity')));
    const toolScroll=(frame as any).sectionRegions[1].scroll;
    handleKey(state,'left',data,frame);frame=renderScreen(data,state,width,20);
    handleKey(state,'end',data,frame);frame=renderScreen(data,state,width,20);
    assert.equal(frame.rows[state.cursor]?.section,'Retained messages');
    assert.equal((frame as any).sectionRegions[1].scroll,toolScroll,'message scrolling leaves tool viewport in place');
    handleKey(state,'right',data,frame);frame=renderScreen(data,state,width,20);assert.equal(state.cursorId,'tool:t69');
    for(const line of frame.lines)assert.ok(cellWidth(line)<=width);
  }
});
test('every entry remains selectable through local navigation, mouse targets, resize and full-content detail',()=>{
  const {data,state}=fixture();let frame=renderScreen(data,state,36,12);
  for(const section of ['Retained messages','Tool activity']){
    if(section==='Tool activity')handleKey(state,'right',data,frame);
    frame=renderScreen(data,state,36,12);handleKey(state,'home',data,frame);frame=renderScreen(data,state,36,12);
    const count=frame.rows.filter(row=>row.section===section).length;
    for(let i=0;i<count;i++){
      assert.equal(frame.rows[state.cursor]?.section,section);
      const region=frame.rowRegions?.find(r=>r.index===state.cursor);assert.ok(region,`${section}/${i}: selected row stays visible`);
      const action=handleRowClick(state,region.x,region.y,data,frame);assert.equal(action?.type,'message');
      const id=state.cursorId;frame=renderScreen(data,state,i%2?80:26,12);assert.equal(state.cursorId,id);
      assert.ok(frame.rowRegions?.some(r=>r.index===state.cursor));
      handleKey(state,'down',data,frame);frame=renderScreen(data,state,36,12);
    }
  }
  const action=handleKey(state,'enter',data,frame)!;assert.match(action.text!,/Exact result 69/);assert.match(action.text!,/\/result\/69.ts/);
  const before={cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll};showDetail(state,action.text!);frame=renderScreen(data,state,36,12);handleKey(state,'escape',data,frame);renderScreen(data,state,36,12);
  assert.deepEqual({cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll},before);
});
test('message blocks share alternating backgrounds and metadata styling while selection takes precedence',()=>{
  const {data,state}=fixture();const frame=renderScreen(data,state,80,34);
  for(const id of ['m0','m1']){
    const rows=frame.rows.filter(row=>row.action?.id===id),band=(rows[0] as any).messageBand;
    assert.equal(band,id==='m0'?0:1);
    assert.ok(rows.every(row=>(row as any).messageBand===band));
    assert.equal(rows[0]?.role,'identity');assert.equal(rows[1]?.role,'text');
  }
  for(const theme of ['dark','light'] as const){
    const outputs=[0,1].map(band=>styleSpans([{text:'Body',role:'text',surface:band?'messageOdd':'messageEven'}] as any,{theme}));
    const backgrounds=outputs.map(out=>/48;2;(\d+;\d+;\d+)/.exec(out)![1]);assert.notEqual(backgrounds[0],backgrounds[1]);
    const selected=styleSpans([{text:'Body',role:'text',surface:'messageOdd',selected:true}] as any,{theme});
    const normalSelected=styleSpans([{text:'Body',role:'text',selected:true}],{theme});assert.equal(selected,normalSelected);
    assert.ok(backgrounds.every(bg=>!selected.includes(`48;2;${bg}m`)));
  }
  const selectedLine=frame.spans![frame.selectedLine!]!;assert.ok(selectedLine.some(part=>part.selected&&part.text==='›'));
  const banded=frame.spans!.flat().filter(part=>(part as any).surface==='messageEven'||(part as any).surface==='messageOdd');assert.ok(banded.length);
});
test('reduced-color message bands keep an explicit selection background distinct from both bands',()=>{
  for(const theme of ['dark','light'] as const)for(const depth of [4,8] as const){
    const bands=(['messageEven','messageOdd'] as const).map(surface=>styleSpans([{text:'Body',role:'text',surface}],{theme,depth}));
    const selected=styleSpans([{text:'Body',role:'text',surface:'messageOdd',selected:true}],{theme,depth});
    const backgroundPattern=depth===8?/48;5;\d+/:/(?:;|\[)(?:4[0-7]|10[0-7])(?=;|m)/;
    const selectionBackground=backgroundPattern.exec(selected)?.[0];assert.ok(selectionBackground,'selection has a known background independent of terminal defaults');
    assert.ok(bands.every(output=>backgroundPattern.exec(output)?.[0]!==selectionBackground));
    assert.equal(selected,styleSpans([{text:'Body',role:'text',selected:true}],{theme,depth}),'row selection palette takes precedence over the message band');
  }
});
test('reduced-color message metadata and bodies have readable explicit foregrounds on both bands',()=>{
  const basicColors=[[0,0,0],[128,0,0],[0,128,0],[128,128,0],[0,0,128],[128,0,128],[0,128,128],[192,192,192],[128,128,128],[255,0,0],[0,255,0],[255,255,0],[0,0,255],[255,0,255],[0,255,255],[255,255,255]];
  const luminance=(values:number[])=>values.map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i]!,0);
  const indexed=(code:number)=>code>=232?Array(3).fill(8+(code-232)*10):[Math.floor((code-16)/36),Math.floor((code-16)/6)%6,(code-16)%6].map(level=>[0,95,135,175,215,255][level]!);
  for(const theme of ['dark','light'] as const)for(const depth of [4,8] as const)for(const surface of ['messageEven','messageOdd'] as const)for(const role of ['text','identity','secondary'] as const){
    const output=styleSpans([{text:'Readable',role,surface}],{theme,depth});let foreground:number[],background:number[];
    if(depth===8){foreground=indexed(Number(/38;5;(\d+)/.exec(output)![1]));background=indexed(Number(/48;5;(\d+)/.exec(output)![1]));}
    else{const codes=/\x1b\[([\d;]+)m/.exec(output)![1]!.split(';').map(Number),fg=codes.find(code=>code>=30&&code<=37||code>=90&&code<=97),bg=codes.find(code=>code>=40&&code<=47||code>=100&&code<=107);assert.ok(fg!==undefined&&bg!==undefined,'basic bands cannot rely on terminal default colors');foreground=basicColors[fg<90?fg-30:fg-90+8]!;background=basicColors[bg<100?bg-40:bg-100+8]!;}
    const fg=luminance(foreground),bg=luminance(background);assert.ok((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)>=4.5,`${theme}/${depth}/${surface}/${role}: readable contrast`);
  }
});
test('history paging, filters and new-message follow preserve the independent tool reader',()=>{
  const {data,state}=fixture();let frame=renderScreen(data,state,80,20);handleKey(state,'right',data,frame);frame=renderScreen(data,state,80,20);handleKey(state,'end',data,frame);frame=renderScreen(data,state,80,20);
  const id=state.cursorId;data.sessions[0]!.evidence.messages.push({id:'new',role:'assistant',text:'New message',timestamp:99});frame=renderScreen(data,state,80,20);assert.equal(state.cursorId,id);
  handleKey(state,'b',data,frame);addMessagePage(state,state.selectedKey!,[{id:'older',role:'user',text:'Old page',timestamp:0}]);frame=renderScreen(data,state,80,20);assert.ok(frame.rows.some(row=>row.id==='older'));
  state.filter='Message 1';state.cursorId='m1';frame=renderScreen(data,state,80,20);assert.ok(frame.rows.some(row=>row.id==='m1'));assert.ok(!frame.rows.some(row=>row.id==='m0'));
  assert.equal((frame as any).sectionRegions.length,2);
});
test('following new retained messages does not steal the selected tool row or its viewport',()=>{
  const {data,state}=fixture();state.followMessages=true;let frame=renderScreen(data,state,80,20);
  handleKey(state,'right',data,frame);frame=renderScreen(data,state,80,20);const id=state.cursorId;
  data.sessions[0]!.evidence.messages.push({id:'follow-new',role:'assistant',text:'New followed message',timestamp:99});frame=renderScreen(data,state,80,20);
  assert.equal(state.cursorId,id);assert.equal(frame.rows[state.cursor]?.section,'Tool activity');
  assert.ok(frame.lines.some(line=>line.includes('New followed message')));
});
test('mouse wheel scrolls the hovered section and ignores shared header and footer',()=>{
  const {data,state}=fixture();let frame=renderScreen(data,state,36,20);
  const messageRegion=frame.sectionRegions![0]!,toolRegion=frame.sectionRegions![1]!;
  handleRowWheel(state,10,toolRegion.y+1,3,frame);frame=renderScreen(data,state,36,20);assert.equal(state.cursorId,'tool:t3');
  const toolScroll=frame.sectionRegions![1]!.scroll;
  handleRowWheel(state,10,messageRegion.y+1,3,frame);frame=renderScreen(data,state,36,20);assert.equal(frame.rows[state.cursor]?.section,'Retained messages');assert.equal(frame.sectionRegions![1]!.scroll,toolScroll);
  const cursorId=state.cursorId;handleRowWheel(state,10,1,3,frame);handleRowWheel(state,10,frame.lines.length,3,frame);assert.equal(state.cursorId,cursorId);
});
test('Page Up in entry help scrolls the help instead of loading message history',()=>{
  const {data,state}=fixture();let frame=renderScreen(data,state,36,12);handleKey(state,'?',data,frame);frame=renderScreen(data,state,36,12);
  assert.equal(handleKey(state,'pageup',data,frame),undefined);assert.equal(state.help,true);
});
test('Messages preview shows both bounded panels with message bands and a visible selection',()=>{
  for(const width of [26,36,80,120])for(const height of [12,34]){
    const first=renderPreview('Messages',{width,height});assert.ok(first.lines.some(line=>line.startsWith('┌ Retained messages')));assert.ok(first.lines.some(line=>line.startsWith('┌ Tool activity')));
    assert.ok(first.spans.flat().some(part=>(part as any).surface==='messageEven'));
    for(let selected=0;selected<first.entries.length;selected++){
      const frame=renderPreview('Messages',{width,height,selected});assert.ok(frame.lines[frame.selectedLine!]?.includes(frame.entries[selected]!.display));
      for(const line of frame.lines)assert.ok(cellWidth(line)<=width);
    }
  }
});
