import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {previewViews,renderPreview,formatPreview} from '../src/tui/preview.ts';
import type {PreviewView} from '../src/tui/preview.ts';
import type {ThemeName} from '../src/tui/theme.ts';
import {InputDecoder} from '../src/tui/input.ts';

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
const save=option('--save');
if(save){
  await mkdir(save,{recursive:true});
  for(const view of previewViews){const frame=render(view);const name=view.toLowerCase().replace(/[^a-z0-9]+/g,'-');await writeFile(path.join(save,name+'.txt'),formatPreview(frame,{color:false}));await writeFile(path.join(save,name+'.ansi'),formatPreview(frame,{color:true}));}
}
if(!args.includes('--browse')){
  for(const view of requested?[requested]:previewViews)process.stdout.write('\n'+formatPreview(render(view),{color}));
}else{
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('--browse needs an interactive terminal');
  let view:PreviewView=requested??'Overview',selected=0,scroll=0,entry:NonNullable<Parameters<typeof renderPreview>[1]>['entry'];
  const history:{view:PreviewView;selected:number;scroll:number}[]=[];
  let frame=render(view),closed=false;
  const draw=()=>{frame=render(view,{width:Math.min(width,process.stdout.columns||width),height:Math.min(height,process.stdout.rows||height),selected,scroll,entry});scroll=frame.scroll;process.stdout.write('\x1b[H\x1b[2J'+formatPreview(frame,{color}));};
  const close=()=>{if(closed)return;closed=true;process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',input);process.stdout.off('resize',draw);process.stdout.write('\x1b[?25h\x1b[?1049l');};
  const decoder=new InputDecoder();let timer:NodeJS.Timeout|undefined;
  const key=(key:string)=>{
    if(key==='q'||key==='ctrl+c'){clearTimeout(timer);close();return;}
    if(key==='tab'||key==='shift+tab'){const i=previewViews.indexOf(view);view=previewViews[(i+(key==='tab'?1:previewViews.length-1))%previewViews.length]!;selected=0;scroll=0;history.length=0;}
    else if(key==='escape'){const previous=history.pop();if(previous)({view,selected,scroll}=previous);}
    else if(key==='?'||key==='enter'){
      const picked=frame.entries[Math.max(0,Math.min(selected,frame.entries.length-1))];
      if(picked){entry=picked;history.push({view,selected,scroll});view=key==='?'?'Help':picked.target??'Detail';selected=0;scroll=0;}
    }else if(key==='down'||key==='j'){if(frame.entries.length)selected=Math.min(selected+1,frame.entries.length-1);else scroll++;}
    else if(key==='up'||key==='k'){if(frame.entries.length)selected=Math.max(0,selected-1);else scroll=Math.max(0,scroll-1);}
    else if(key==='left'||key==='right'){
      const current=frame.positions.find(position=>position.entry===selected);
      if(current){const candidates=frame.positions.filter(position=>key==='right'?position.column>current.column:position.column<current.column).sort((a,b)=>Math.abs(a.line-current.line)-Math.abs(b.line-current.line)||Math.abs(a.column-current.column)-Math.abs(b.column-current.column));if(candidates[0])selected=candidates[0].entry;}
    }
    else if(key==='home'){selected=0;scroll=0;}
    else if(key==='end'){if(frame.entries.length)selected=frame.entries.length-1;else scroll=100000;}
    else if(key==='pagedown'){if(frame.entries.length)selected=Math.min(frame.entries.length-1,selected+Math.max(1,frame.positions.length));else scroll+=frame.bodyHeight;}
    else if(key==='pageup'){if(frame.entries.length)selected=Math.max(0,selected-Math.max(1,frame.positions.length));else scroll=Math.max(0,scroll-frame.bodyHeight);}
    draw();
  };
  const input=(data:Buffer)=>{clearTimeout(timer);for(const event of decoder.feed(data))if(event.type==='key')key(event.key);timer=setTimeout(()=>{for(const event of decoder.flushEscape())if(event.type==='key')key(event.key);},40);};
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',input);process.stdout.on('resize',draw);process.once('SIGINT',close);process.once('SIGTERM',close);process.stdout.write('\x1b[?1049h\x1b[?25l');draw();
}
