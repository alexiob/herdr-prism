import test from 'node:test';
import assert from 'node:assert/strict';
import {demoData} from '../src/runtime/demo.ts';
import {createUiState,renderScreen,handleRowClick} from '../src/tui/screen.ts';
import {inspectorPreviewTabs,renderPreview,formatPreview} from '../src/tui/preview.ts';
import {styleSpans} from '../src/tui/theme.ts';
import {cellWidth} from '../src/tui/text.ts';
import {tabLabel} from '../src/tui/types.ts';

function luminance(rgb:number[]):number{
  const values=rgb.map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;});
  return .2126*values[0]!+.7152*values[1]!+.0722*values[2]!;
}
function indexedRgb(index:number):number[]{
  if(index>=232)return Array(3).fill(8+(index-232)*10);
  const cube=index-16,levels=[0,95,135,175,215,255];
  return [Math.floor(cube/36),Math.floor(cube/6)%6,cube%6].map(level=>levels[level]!);
}
test('colored tab surfaces set distinct readable foregrounds and backgrounds in both themes',()=>{
  for(const theme of ['dark','light'] as const){
    const backgrounds:string[]=[];
    for(const surface of ['tabbar','tab','activeTab'] as const){
      const output=styleSpans([{text:'Tab',role:'secondary',surface,bold:surface==='activeTab'}],{theme});
      const foreground=/38;2;(\d+);(\d+);(\d+)/.exec(output),background=/48;2;(\d+);(\d+);(\d+)/.exec(output);
      assert.ok(foreground&&background,`${theme}/${surface}: foreground and background required`);
      const fg=luminance(foreground.slice(1).map(Number)),bg=luminance(background.slice(1).map(Number));
      assert.ok((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)>=4.5,`${theme}/${surface}: readable contrast`);
      backgrounds.push(background[0]);
      if(surface==='activeTab')assert.match(output,/\x1b\[[^m]*\b1(?:;|m)/);
      for(const depth of [4,8] as const){
        const reduced=styleSpans([{text:'Tab',role:'secondary',surface}],{theme,depth});
        assert.match(reduced,depth===8?/48;5;\d+/:/(?:;|\[)(?:4[0-7]|10[0-7])(?:;|m)/);
        if(depth===8){
          const fg=luminance(indexedRgb(Number(/38;5;(\d+)/.exec(reduced)![1]))),bg=luminance(indexedRgb(Number(/48;5;(\d+)/.exec(reduced)![1])));
          assert.ok((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)>=4.5,`${theme}/${surface}: readable 256-color contrast`);
        }
      }
    }
    assert.equal(new Set(backgrounds).size,3,`${theme}: all tab surfaces differ`);
  }
});

test('wrapped live tab bars fill the terminal and retain measured clickable labels',()=>{
  const data=demoData();
  for(const width of [26,36,50,80,120])for(const height of [12,34]){
    const state=createUiState();state.selectedKey=data.sessions[0]!.key;state.tab='Processes';
    const frame=renderScreen(data,state,width,height);
    assert.equal(frame.tabRegions!.length,8);
    const tabRows=new Set(frame.tabRegions!.map(region=>region.y));
    for(const y of tabRows){
      const line=frame.spans![y-1]!;
      assert.equal(cellWidth(line.map(part=>part.text).join('')),width);
      assert.ok(line.every(part=>part.surface),`row ${y}: whole bar has a surface`);
      assert.ok(line.some(part=>part.surface==='tabbar'),`row ${y}: bar separators or padding`);
    }
    for(const region of frame.tabRegions!){
      const name=tabLabel(region.tab,width<50),label=region.tab==='Processes'?`[${name}]`:name;
      assert.equal(frame.lines[region.y-1]!.slice(region.x-1,region.x-1+region.width),label);
      assert.equal(region.width,cellWidth(label));
      handleRowClick(state,region.x,region.y,data,frame);assert.equal(state.tab,region.tab);
    }
    const active=frame.spans!.flat().find(part=>part.surface==='activeTab');
    assert.equal(active?.text,width<50?'[Procs]':'[Processes]');assert.equal(active?.bold,true);
  }
});

test('preview tab surfaces match live order and keep active brackets in plain output',()=>{
  for(const width of [26,36,50,80,120])for(const view of inspectorPreviewTabs){
    const frame=renderPreview(view,{width,height:34});
    const tabRows=frame.spans.filter(line=>line.some(part=>part.surface==='tabbar'||part.surface==='tab'||part.surface==='activeTab'));
    assert.ok(tabRows.length);
    for(const line of tabRows){assert.equal(cellWidth(line.map(part=>part.text).join('')),width);assert.ok(line.every(part=>part.surface));}
    const labels=tabRows.flat().filter(part=>part.surface!=='tabbar');
    assert.deepEqual(labels.map(part=>part.text.replace(/[\[\]]/g,'')),inspectorPreviewTabs.map(tab=>tabLabel(tab,width<50)));
    const active=labels.find(part=>part.surface==='activeTab');
    assert.equal(active?.text,`[${tabLabel(view,width<50)}]`);assert.equal(active?.bold,true);
    const plain=formatPreview(frame,{color:false});assert.ok(!plain.includes('\x1b'));assert.ok(plain.includes(active!.text));
    const mono=formatPreview({...frame,theme:'mono'});assert.ok(!mono.includes('\x1b'));assert.ok(mono.includes(active!.text));
  }
});
