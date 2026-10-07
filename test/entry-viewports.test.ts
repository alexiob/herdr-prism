import test from 'node:test';
import assert from 'node:assert/strict';
import {demoData} from '../src/runtime/demo.ts';
import {createUiState,renderScreen,handleKey,handleRowClick,handleRowWheel,showDetail} from '../src/tui/screen.ts';
import {cellWidth} from '../src/tui/text.ts';

test('message preview lines share one selection and one navigation arrow',()=>{
 const data=demoData(),state=createUiState();state.tab='Messages';state.selectedKey=data.sessions[0]!.key;state.followMessages=false;
 data.sessions[0]!.evidence.messages=[{id:'a',role:'user',text:'First body\nSecond body\nThird body',timestamp:1},{id:'b',role:'assistant',text:'Next body',timestamp:2}];data.sessions[0]!.evidence.tools=[];
 let frame=renderScreen(data,state,60,24);assert.equal(frame.rows.filter(row=>row.action?.id==='a').length,1,'one logical message entry');
 const lines=frame.rowRegions!.filter(region=>region.index===state.cursor);assert.ok(lines.length>=3);assert.equal(lines.flatMap(region=>frame.spans![region.y-1]!).filter(span=>span.role==='accent'&&span.text.trim()==='→').length,1);
 assert.ok(lines.every(region=>frame.spans![region.y-1]!.some(span=>span.selected)));
 assert.equal(handleRowClick(state,lines[1]!.x,lines[1]!.y,data,frame),undefined,'body clicks select rather than navigate');assert.equal(state.cursorId,'a');
 handleKey(state,'down',data,frame);frame=renderScreen(data,state,60,24);assert.equal(state.cursorId,'b');
});

test('every runtime list uses alternating entry bands',()=>{
 for(const tab of ['Overview','Agents','Processes','Refs','To-do','Git','Messages'] as const){
  const data=demoData(),state=createUiState();state.selectedKey=data.sessions[0]!.key;state.tab=tab;state.followMessages=false;
  const frame=renderScreen(data,state,120,60);
  assert.ok(frame.sectionRegions?.length,tab+' exposes contained readers');
  for(const panel of frame.sectionRegions??[]){
   const entries=panel.indices.map(index=>frame.rows[index]!).filter(row=>row.selectable!==false);
   if(entries.length<2)continue;
   assert.notEqual(entries[0]!.messageBand,undefined,tab+' uses row bands');assert.notEqual(entries[0]!.messageBand,entries[1]!.messageBand,tab+' alternates logical entries');
  }
 }
});

test('all subpanels remain in bounds and independently scroll even at tiny dimensions',()=>{
 for(const width of [1,8,26,60,120])for(const height of [1,3,8,12,34]){
  const data=demoData(),state=createUiState();state.selectedKey=data.sessions[0]!.key;
  showDetail(state,'Long facts',{title:'Long facts',sections:Array.from({length:4},(_,i)=>({id:'part'+i,title:'Part '+i,column:i%2 as 0|1,text:Array.from({length:30},(_,line)=>`PART ${i} LINE ${line} ${'日本語 '.repeat(5)}`).join('\n')}))});
  let frame=renderScreen(data,state,width,height);assert.equal(frame.lines.length,height);assert.ok(frame.lines.every(line=>cellWidth(line)<=width));
  assert.equal(frame.sectionRegions?.length,4,'all sections remain reachable');
  for(const region of frame.sectionRegions!){assert.ok(region.x>=1&&region.y>=1);assert.ok(region.x+region.width-1<=width);assert.ok(region.height===0||region.y+region.height-1<=height);}
  for(const region of frame.rowRegions!)assert.ok(region.y>=1&&region.y<=height&&region.x>=1&&region.x<=width);
  handleKey(state,'right',data,frame);frame=renderScreen(data,state,width,height);assert.equal(frame.rows[state.cursor]!.section,'part1');
  const active=frame.sectionRegions!.find(region=>region.id==='part1')!;assert.ok(active.height>0);const before=active.scroll;
  handleRowWheel(state,active.x,active.y,3,frame);frame=renderScreen(data,state,width,height);assert.ok(frame.sectionRegions!.find(region=>region.id==='part1')!.scroll>before,'wheel scrolls contained text');
 }
});

test('CPU and memory charts occupy adjacent rows',()=>{
 const data=demoData(),state=createUiState();state.selectedKey=data.sessions[0]!.key;
 const frame=renderScreen(data,state,120,40),cpu=frame.rows.findIndex(row=>row.id==='cpu'),memory=frame.rows.findIndex(row=>row.id==='memory');
 const cpuLine=frame.rowRegions!.find(region=>region.index===cpu)!,memoryLine=frame.rowRegions!.find(region=>region.index===memory)!;
 assert.equal(memoryLine.y-cpuLine.y,1);
});

test('new detail readers start at their own beginning and closing nested details restores the prior viewport',()=>{
 const data=demoData(),state=createUiState();state.selectedKey=data.sessions[0]!.key;state.tab='Messages';
 showDetail(state,Array.from({length:50},(_,i)=>'FIRST '+i).join('\n'));let frame=renderScreen(data,state,60,16),region=frame.sectionRegions![0]!;
 handleRowWheel(state,region.x+2,region.y+1,20,frame);frame=renderScreen(data,state,60,16);const prior=frame.sectionRegions![0]!.scroll;assert.ok(prior>0);
 showDetail(state,Array.from({length:50},(_,i)=>'SECOND '+i).join('\n'));frame=renderScreen(data,state,60,16);assert.equal(frame.sectionRegions![0]!.scroll,0);assert.match(frame.lines.join('\n'),/SECOND 0/);
 handleKey(state,'escape',data,frame);frame=renderScreen(data,state,60,16);assert.equal(frame.sectionRegions![0]!.scroll,prior);assert.match(frame.lines.join('\n'),/FIRST 20/);
});

test('Home resets a wheeled help viewport including frozen confirmation help',()=>{
 for(const confirmation of [false,true]){
  const data=demoData(),state=createUiState();state.selectedKey=data.sessions[0]!.key;state.help=true;state.helpText=Array.from({length:50},(_,i)=>'HELP '+i).join('\n');
  if(confirmation)state.processConfirmation={sessionKey:state.selectedKey,target:{key:'exact',pid:1,name:'fixture',owner:state.selectedKey}};
  let frame=renderScreen(data,state,60,16),region=frame.sectionRegions![0]!;handleRowWheel(state,region.x+2,region.y+1,20,frame);frame=renderScreen(data,state,60,16);assert.ok(frame.sectionRegions![0]!.scroll>0);
  handleKey(state,'home',data,frame);frame=renderScreen(data,state,60,16);assert.equal(frame.sectionRegions![0]!.scroll,0);assert.match(frame.lines.join('\n'),/HELP 0/);
 }
});
