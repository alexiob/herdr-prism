import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUiState} from '../src/tui/screen.ts';
import {renderNotes} from '../src/tui/notes.ts';
import {cellWidth} from '../src/tui/text.ts';
import type {DashboardData} from '../src/tui/types.ts';

const data:DashboardData={sessions:[],updatedAt:0,stale:false,diagnostics:[]};
function reader(text:string,editing=false){
  const state=createUiState();state.tab='Notes';state.selectedKey='notes-agent';
  state.notes={sessionKey:'notes-agent',title:'Notes agent',text,cursor:text.length,editing,status:'saved'};
  return state;
}

test('read Notes expose their scrolled source at every viewport size and retain Enter edit',()=>{
  for(const columns of [1,8,12,36])for(const height of [1,2,3,5,8,10,18]){
    const state=reader('first\nsecond\nthird\nlast');state.notesScroll=Number.MAX_SAFE_INTEGER;
    const frame=renderNotes(data,state,columns,height,0),region=frame.sectionRegions?.find(region=>region.id==='notes');
    assert.equal(frame.lines.length,height);
    assert.equal(frame.rows[0]?.action?.type,'notes-edit');
    assert.ok(region,`${columns}x${height}: missing Markdown viewport`);
    assert.ok(region.contentHeight>0);
    assert.equal(region.height,region.contentHeight);
    assert.ok(region.y>=frame.bodyStart+1&&region.y+region.height<=height+1);
    assert.equal(region.scroll,Math.max(0,region.total-region.contentHeight));
    assert.ok(frame.rowRegions?.some(target=>frame.rows[target.index]?.text==='last'||frame.rows[target.index]?.text==='t'),`${columns}x${height}: final source line unavailable`);
    for(const line of frame.lines)assert.ok(cellWidth(line)<=columns);
  }
});

test('Notes metadata describes only document rows and exact Markdown survives rendering',()=>{
  const text='# Header\n\n    code    spaces\nfinal',state=reader(text);
  const frame=renderNotes(data,state,36,18,0),region=frame.sectionRegions!.find(region=>region.id==='notes')!;
  assert.equal(region.total,4);assert.equal(region.lineIndices.length,4);
  assert.deepEqual(region.lineIndices.map(index=>frame.rows[index]!.text),['# Header','','    code    spaces','final']);
  assert.ok(region.indices.every(index=>frame.rows[index]!.selectable===false));
  for(const target of frame.rowRegions!.filter(target=>region.indices.includes(target.index))){
    assert.ok(target.y>=region.y&&target.y<region.y+region.height);
    assert.equal(frame.rows[target.index]!.action,undefined);
  }
  assert.equal(state.notes!.text,text);
});

test('editor free scroll preserves the viewport and hides its offscreen caret until following resumes',()=>{
  const state=reader(Array.from({length:30},(_,i)=>`source ${i+1}`).join('\n'),true);
  state.notesScroll=0;state.notesFreeScroll=true;
  let frame=renderNotes(data,state,36,14,0),region=frame.sectionRegions!.find(region=>region.id==='notes')!;
  assert.equal(region.scroll,0);assert.ok(frame.lines.some(line=>line.includes('source 1')));assert.equal(frame.terminalCursor,undefined);
  state.notesFreeScroll=false;
  frame=renderNotes(data,state,36,14,0);region=frame.sectionRegions!.find(region=>region.id==='notes')!;
  assert.ok(region.scroll>0);assert.ok(frame.lines.some(line=>line.includes('source 30')));
  assert.ok(frame.terminalCursor);assert.ok(frame.terminalCursor.line>=region.y&&frame.terminalCursor.line<region.y+region.height);
});

test('free scrolling an editor with a visible caret preserves its exact source position',()=>{
  const state=reader('top\n日本語\nlast',true);state.notes!.cursor=6;state.notesFreeScroll=true;
  const frame=renderNotes(data,state,36,14,0),region=frame.sectionRegions!.find(region=>region.id==='notes')!;
  assert.equal(frame.terminalCursor?.line,region.y+1);
  assert.equal(frame.terminalCursor?.column,7);
});
