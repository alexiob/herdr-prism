import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderPreview} from '../src/tui/preview.ts';
import type {PreviewBrowseState} from '../scripts/ui-preview.ts';
const api=await import('../scripts/ui-preview.ts') as any;
const state=():PreviewBrowseState=>({selected:0,scroll:0,sectionScroll:{},sectionSelections:new Map(),activeSection:undefined,freeScroll:false});
test('gallery navigation uses every view region and paging scrolls without changing the logical entry',()=>{
 const frame=renderPreview('Overview',{width:80,height:24}),value=state();assert.equal(api.navigatePreview(value,frame,'right'),true);assert.ok(frame.sectionRegions!.find(r=>r.entries.includes(value.selected))!.column>0);
 const selected=value.selected;assert.equal(api.navigatePreview(value,frame,'pagedown'),true);assert.equal(value.selected,selected);assert.equal(value.freeScroll,true);
});
test('gallery wheels obey both coordinates and preserve selection while scrolling only the hovered panel',()=>{
 const frame=renderPreview('Messages',{width:80,height:20}),value=state(),region=frame.sectionRegions!.find(r=>r.entries.some(i=>frame.entries[i]!.id.startsWith('activity-tool')))!;
 assert.equal(api.mousePreview(value,frame,{x:0,y:region.line+2,button:65,release:false}),false);assert.deepEqual(value.sectionScroll,{});
 assert.equal(api.mousePreview(value,frame,{x:region.column+2,y:region.line+2,button:65,release:false}),true);assert.equal(value.selected,0);assert.ok(value.sectionScroll[region.id]>0);
});
test('gallery clicks select whole multiline entries and require explicit arrow geometry to open',()=>{
 const frame=renderPreview('Messages',{width:80,height:34}),value=state(),position=frame.positions.find(p=>p.entry===1&&p.actionColumn===undefined)!;
 assert.equal(api.mousePreview(value,frame,{x:position.column+2,y:position.line+1,button:0,release:false}),true);assert.equal(value.selected,position.entry);assert.equal(value.open,false);
 assert.equal(api.mousePreview(value,frame,{x:position.column+position.width+1,y:position.line+1,button:0,release:false}),false);
 const arrow=frame.positions.find(p=>p.entry===position.entry&&p.actionColumn!==undefined)!;assert.equal(api.mousePreview(value,frame,{x:arrow.actionColumn!+1,y:arrow.line+1,button:0,release:false}),true);assert.equal(value.open,true);
});
test('gallery document panels scroll without any selectable entries',()=>{
 const entry=renderPreview('Overview').entries.find(e=>e.id==='goal')!,frame=renderPreview('Detail',{width:50,height:12,entry}),value=state();assert.equal(api.navigatePreview(value,frame,'down'),true);assert.ok(value.scroll>0||Object.values(value.sectionScroll).some(n=>Number(n)>0));assert.equal(value.selected,0);
 const next=renderPreview('Detail',{width:50,height:12,entry,...value});assert.equal(next.sectionScroll?.[value.activeSection!],value.sectionScroll[value.activeSection!]);
});
test('gallery notes wheels scroll source while the editor keeps its actual caret identity',()=>{
 for(const view of ['Notes','Notes editor'] as const){const frame=renderPreview(view,{width:50,height:12}),value=state();value.scroll=frame.scroll;value.sectionScroll={...frame.sectionScroll};const region=frame.sectionRegions![0]!;
  assert.equal(api.mousePreview(value,frame,{x:region.column+2,y:region.line+2,button:64,release:false}),true);assert.equal(value.scroll,value.sectionScroll[region.id]);const next=renderPreview(view,{width:50,height:12,...value});assert.equal(next.scroll,value.scroll);
  if(view==='Notes editor'){assert.equal(api.navigatePreview(value,frame,'left'),false);assert.equal(next.entries.length,0);}
 }
});
