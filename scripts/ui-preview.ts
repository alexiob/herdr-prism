import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {previewViews,inspectorPreviewTabs,renderPreview,formatPreview} from '../src/tui/preview.ts';
import type {PreviewView} from '../src/tui/preview.ts';
import type {PreviewFrame} from '../src/tui/preview.ts';
import type {ThemeName} from '../src/tui/theme.ts';
import {InputDecoder} from '../src/tui/input.ts';
import {pathToFileURL} from 'node:url';

export interface PreviewBrowseState {selected:number;scroll:number;sectionScroll:Record<string,number>;sectionSelections:Map<string,number>;activeSection?:string;freeScroll:boolean;open?:boolean;}
type PreviewRegion=NonNullable<PreviewFrame['sectionRegions']>[number];
function scrollPreview(value:PreviewBrowseState,frame:PreviewFrame,region:PreviewRegion|undefined,delta:number){
 value.freeScroll=true;
 if(region){value.activeSection=region.id;value.sectionScroll[region.id]=Math.max(0,Math.min(Math.max(0,region.total-region.contentHeight),(value.sectionScroll[region.id]??region.scroll)+delta));if(!frame.entries.length||frame.view==='Notes')value.scroll=value.sectionScroll[region.id]!;}
 else value.scroll=Math.max(0,value.scroll+delta);
}
export function navigatePreview(value:PreviewBrowseState,frame:PreviewFrame,key:string):boolean{
 if(!['down','j','up','k','left','right','home','end','pageup','pagedown'].includes(key)||frame.view==='Notes editor')return false;
 const regions=frame.sectionRegions??[],current=regions.find(r=>r.id===value.activeSection)??regions.find(r=>r.entries.includes(value.selected))??regions[0];
 if(key==='left'||key==='right'){
  if(!current||regions.length<2)return true;
  if(current.entries.includes(value.selected))value.sectionSelections.set(current.id,value.selected);
  const at=regions.indexOf(current),neighbors=regions.filter(r=>key==='right'?r.column>current.column:r.column<current.column).sort((a,b)=>Math.abs(a.line-current.line)-Math.abs(b.line-current.line));
  const next=neighbors[0]??regions[(at+(key==='right'?1:regions.length-1))%regions.length]!;value.activeSection=next.id;
  if(next.entries.length){value.selected=value.sectionSelections.get(next.id)??next.entries[0]!;value.freeScroll=false;}return true;
 }
 const direction=key==='up'||key==='k'||key==='pageup'?-1:1;
 if(key==='pageup'||key==='pagedown'){scrollPreview(value,frame,current,direction*Math.max(1,current?.contentHeight??frame.bodyHeight));return true;}
 const entries=current?current.entries:frame.entries.map((_,i)=>i);
 if(entries.length){const at=entries.indexOf(value.selected);value.selected=entries[Math.max(0,Math.min(entries.length-1,key==='home'?0:key==='end'?entries.length-1:at+direction))]!;value.activeSection=current?.id;value.freeScroll=false;}
 else scrollPreview(value,frame,current,key==='home'?-100000:key==='end'?100000:direction);
 return true;
}
export function mousePreview(value:PreviewBrowseState,frame:PreviewFrame,event:{x:number;y:number;button:number;release:boolean}):boolean{
 value.open=false;if(event.release)return false;
 const region=frame.sectionRegions?.find(r=>event.x>=r.column+1&&event.x<r.column+r.width+1&&event.y>=r.line+1&&event.y<r.line+r.height+1);
 if(event.button===64||event.button===65){
  if(region){scrollPreview(value,frame,region,event.button===64?-3:3);return true;}
  if(!frame.sectionRegions&&event.x>=1&&event.x<=frame.lines[0]!.length&&event.y>frame.bodyStart&&event.y<=frame.bodyStart+frame.bodyHeight){scrollPreview(value,frame,undefined,event.button===64?-3:3);return true;}return false;
 }
 if(event.button!==0||frame.view==='Notes editor')return false;
 const position=frame.positions.find(p=>event.y===p.line+1&&event.x>=p.column+1&&event.x<p.column+p.width+1);
 if(!position)return false;value.selected=position.entry;value.activeSection=region?.id;value.freeScroll=false;
 const actionColumn=position.actionColumn;value.open=actionColumn!==undefined&&event.x===actionColumn+1;return true;
}

async function main(){
const args=process.argv.slice(2);
const option=(name:string)=>{const at=args.indexOf(name);return at>=0?args[at+1]:undefined;};
const width=Number(option('--width')??50),height=Number(option('--height')??34);
const theme=(option('--theme')??'dark') as ThemeName;
if(!['dark','light','mono'].includes(theme))throw new Error('Theme must be dark, light or mono');
if(!Number.isSafeInteger(width)||width<26||width>240||!Number.isSafeInteger(height)||height<10||height>100)throw new Error('Width must be 26–240, height 10–100');
const requested=option('--view') as PreviewView|undefined;
if(requested&&!previewViews.includes(requested))throw new Error(`Choose a view: ${previewViews.join(', ')}`);
if(args.includes('--help')){
  process.stdout.write('Prism synthetic terminal design gallery\n\n  npm run ui:preview\n  npm run ui:preview -- --browse\n  npm run ui:preview -- --width 80 --theme light\n  npm run ui:preview -- --view Processes --plain\n  npm run ui:preview -- --save artifacts/ui-design\n\nBrowse: Tab/Shift+Tab views, arrows select, Enter opens, ? contextual help, Escape back, q exits.\nNo running Herdr session or private data is accessed.\n');
  process.exit(0);
}
const color=!args.includes('--plain')&&theme!=='mono';
const render=(view:PreviewView,extra:Parameters<typeof renderPreview>[1]={})=>renderPreview(view,{width,height,theme,ascii:args.includes('--ascii'),...extra});
const entryId=option('--entry');
const initial=entryId?inspectorPreviewTabs.flatMap(tab=>render(tab).entries.map(entry=>({tab,entry}))).find(item=>item.entry.id===entryId):undefined;
if(entryId&&!initial)throw new Error('Unknown preview entry: '+entryId);
const save=option('--save');
if(save){
  await mkdir(save,{recursive:true});
  for(const view of previewViews){const frame=render(view);const name=view.toLowerCase().replace(/[^a-z0-9]+/g,'-');await writeFile(path.join(save,name+'.txt'),formatPreview(frame,{color:false}));await writeFile(path.join(save,name+'.ansi'),formatPreview(frame,{color:true}));}
}
if(!args.includes('--browse')){
  for(const view of requested?[requested]:initial?['Detail'] as const:previewViews)process.stdout.write('\n'+formatPreview(render(view,{entry:initial?.entry}),{color}));
}else{
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('--browse needs an interactive terminal');
  let view:PreviewView=requested??(initial?'Detail':'Overview'),selected=0,scroll=0,entry:NonNullable<Parameters<typeof renderPreview>[1]>['entry']=initial?.entry;
  const history:{view:PreviewView;selected:number;scroll:number;sectionScroll:Record<string,number>;activeSection?:string;freeScroll:boolean}[]=[];
  let frame=render(view),closed=false,sectionScroll:Record<string,number>={},activeSection:string|undefined,freeScroll=false;const sectionSelections=new Map<string,number>();
  const browseState=():PreviewBrowseState=>({selected,scroll,sectionScroll,sectionSelections,activeSection,freeScroll});
  const accept=(value:PreviewBrowseState)=>{({selected,scroll,sectionScroll,activeSection,freeScroll}=value);};
  const reset=()=>{selected=0;scroll=0;sectionScroll={};activeSection=undefined;freeScroll=false;sectionSelections.clear();};
  const draw=()=>{frame=render(view,{width:Math.min(width,process.stdout.columns||width),height:Math.min(height,process.stdout.rows||height),selected,scroll,sectionScroll,entry,activeSection:frame.entries.length?undefined:activeSection,freeScroll});scroll=frame.scroll;if(frame.sectionScroll)sectionScroll=frame.sectionScroll;process.stdout.write('\x1b[H\x1b[2J'+formatPreview(frame,{color}));if(frame.terminalCursor)process.stdout.write(`\x1b[${frame.terminalCursor.line};${frame.terminalCursor.column}H\x1b[?25h`);else process.stdout.write('\x1b[?25l');};
  const close=()=>{if(closed)return;closed=true;process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',input);process.stdout.off('resize',draw);process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l');};
  const decoder=new InputDecoder();let timer:NodeJS.Timeout|undefined;
  const key=(key:string)=>{
    if(key==='q'||key==='ctrl+c'){clearTimeout(timer);close();return;}
    if(key==='tab'||key==='shift+tab'){const i=previewViews.indexOf(view);view=previewViews[(i+(key==='tab'?1:previewViews.length-1))%previewViews.length]!;reset();history.length=0;}
    else if(key==='escape'){const previous=history.pop();if(previous)({view,selected,scroll,sectionScroll,activeSection,freeScroll}=previous);else if(view==='Detail'||view==='Help'||view==='Notes editor'){view=initial?.tab??'Overview';reset();}}
    else if(key==='?'||key==='enter'){
      const picked=frame.entries[Math.max(0,Math.min(selected,frame.entries.length-1))]??(key==='?'&&view==='Detail'?entry:undefined);
      if(picked){entry=picked;history.push({view,selected,scroll,sectionScroll:{...sectionScroll},activeSection,freeScroll});view=key==='?'?'Help':picked.target??'Detail';reset();}
    }else {const value=browseState();if(navigatePreview(value,frame,key))accept(value);}
    draw();
  };
  const input=(data:Buffer)=>{clearTimeout(timer);for(const event of decoder.feed(data)){
    if(event.type==='key')key(event.key);
    else if(event.type==='mouse'){const value=browseState();if(mousePreview(value,frame,event)){accept(value);if(value.open)key('enter');else draw();}}
  }timer=setTimeout(()=>{for(const event of decoder.flushEscape())if(event.type==='key')key(event.key);},40);};
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',input);process.stdout.on('resize',draw);process.once('SIGINT',close);process.once('SIGTERM',close);process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h');draw();
}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
