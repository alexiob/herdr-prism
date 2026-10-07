import test from 'node:test';
import assert from 'node:assert/strict';
import {demoData} from '../src/runtime/demo.ts';
import {processDocument} from '../src/tui/facts.ts';
import {withProcessOutput} from '../src/process/output.ts';
import {documentText} from '../src/tui/widgets.ts';
import {createUiState,renderScreen,showDetail,handleKey,handleRowWheel,handleRowClick} from '../src/tui/screen.ts';
import {cellWidth} from '../src/tui/text.ts';
import {renderPreview} from '../src/tui/preview.ts';

const output=Array.from({length:200},(_,i)=>`LINE ${String(i).padStart(3,'0')} · ${'日本語 😀 retained output '.repeat(10)} END ${i}`).join('\n');
function fixture(){const data=demoData(),session=data.sessions[0]!,target=session.resource!.processes[0]!,state=createUiState();state.selectedKey=session.key;state.tab='Processes';const doc=withProcessOutput(processDocument(session,target,1),{availability:'known',scope:'shared-terminal',pid:target.pid,owner:target.owner,processKey:target.key,capturedAt:1,text:output});showDetail(state,documentText(doc),doc);return{data,state,doc,target};}
test('process facts and captured output stay bounded in independent fixed viewports at every terminal size',()=>{
 for(const width of [26,36,60,80,120])for(const height of [12,20,34,100]){
  const {data,state,doc}=fixture();let frame=renderScreen(data,state,width,height);assert.equal(frame.sectionRegions?.length,2);const [facts,stream]=frame.sectionRegions!;
  assert.equal(facts!.id,'Process facts');assert.equal(stream!.id,'Output');assert.equal(stream!.width,width);assert.ok(stream!.total>200,'all wrapped capture lines remain in virtual rows');assert.ok(frame.rows.some(row=>row.text.includes('END 199')));
  if(frame.bodyHeight>=8)assert.ok(stream!.height>=5);
  const geometry=frame.sectionRegions!.map(region=>[region.id,region.y,region.height]);
  handleKey(state,'right',data,frame);frame=renderScreen(data,state,width,height);const fixedFacts=frame.lines.slice(facts!.y-1,facts!.y-1+facts!.height);
  handleKey(state,'end',data,frame);frame=renderScreen(data,state,width,height);assert.deepEqual(frame.sectionRegions!.map(region=>[region.id,region.y,region.height]),geometry);assert.deepEqual(frame.lines.slice(facts!.y-1,facts!.y-1+facts!.height),fixedFacts);assert.equal(frame.rows[state.cursor]?.id,'process-output-refresh');
  assert.ok(frame.rowRegions?.some(region=>region.index===state.cursor));assert.equal(handleKey(state,'enter',data,frame)?.type,'process-output');
  handleKey(state,'up',data,frame);frame=renderScreen(data,state,width,height);assert.ok(frame.rows[state.cursor]?.text.includes('END 199'));assert.ok(frame.lines.some(line=>line.includes('END 199')));
  const fixedOutput=frame.lines.slice(stream!.y-1,stream!.y-1+stream!.height);handleKey(state,'left',data,frame);frame=renderScreen(data,state,width,height);handleKey(state,'end',data,frame);frame=renderScreen(data,state,width,height);assert.deepEqual(frame.lines.slice(stream!.y-1,stream!.y-1+stream!.height),fixedOutput);
  for(const line of frame.lines)assert.ok(cellWidth(line)<=width);
  assert.equal(doc.sections.find(section=>section.id==='output')!.rows!.length,1,'rendering never mutates or duplicates the capture refresh action');
 }
});
test('hovered output wheel, mouse refresh, resize, help and termination retain exact detail identity',()=>{
 const {data,state,target}=fixture();let frame=renderScreen(data,state,80,34),stream=frame.sectionRegions![1]!;handleRowWheel(state,20,stream.y+1,3,frame);frame=renderScreen(data,state,80,34);assert.equal(frame.rows[state.cursor]?.section,'Output');
 const cursorId=state.cursorId;frame=renderScreen(data,state,26,12);assert.equal(state.cursorId,cursorId);assert.ok(frame.rowRegions?.some(region=>region.index===state.cursor));handleKey(state,'end',data,frame);frame=renderScreen(data,state,26,12);
 const refresh=frame.rowRegions!.find(region=>frame.rows[region.index]?.id==='process-output-refresh')!;assert.equal(handleRowClick(state,refresh.actionX!,refresh.y,data,frame)?.processTarget?.key,target.key);assert.equal(handleKey(state,'r',data,frame)?.processTarget?.key,target.key);
 handleKey(state,'?',data,frame);frame=renderScreen(data,state,26,12);assert.equal(frame.sectionRegions?.length,1);assert.match(state.helpText!,/shared terminal|shared.*stream/i);handleKey(state,'escape',data,frame);frame=renderScreen(data,state,26,12);assert.equal(frame.rows[state.cursor]?.id,'process-output-refresh');
 handleKey(state,'K',data,frame);assert.equal(state.processConfirmation?.target.key,target.key);assert.equal(state.cursorId,'process-cancel');handleKey(state,'escape',data,renderScreen(data,state,80,34));assert.equal(state.processConfirmation,undefined);assert.equal(state.detailDocument?.processTarget?.key,target.key);
});
test('different process identities never reuse another captured output scroll position',()=>{
 const {data,state,doc,target}=fixture();let frame=renderScreen(data,state,80,20);handleKey(state,'right',data,frame);frame=renderScreen(data,state,80,20);handleKey(state,'end',data,frame);frame=renderScreen(data,state,80,20);assert.ok(frame.sectionRegions![1]!.scroll>0);
 const other={...doc,processTarget:{...target,key:'other-process-identity'}};showDetail(state,documentText(other),other);frame=renderScreen(data,state,80,20);assert.equal(frame.sectionRegions![1]!.scroll,0);
});
test('process preview keeps output bounded separately from facts',()=>{
 const entry=renderPreview('Processes').entries.find(entry=>entry.id==='p1')!;
 for(const width of [26,80,120]){const frame=renderPreview('Detail',{entry,width,height:34});assert.equal(frame.sectionRegions?.length,2);assert.ok(frame.lines.some(line=>line.includes('Output')));assert.ok(frame.lines.some(line=>line.includes('Identity')));}
});
