import {tabs,tabLabel} from './types.ts';
import type {Tab} from './types.ts';
import {EventEmitter} from 'node:events';
import type {NotesEditorState,DashboardData,UiState,RenderedScreen,ScreenRow} from './types.ts';
import {NotesStore,noteLimit} from '../state/notes.ts';
import type {NoteSnapshot} from '../state/notes.ts';
import {sanitize,cellWidth,truncate} from './text.ts';
import {span,pad,fitSpans,asciiText} from './widgets.ts';
import type {TextSpan} from './theme.ts';
import {renderLayout} from './layout.ts';
import {resolveNotesSessionKey} from '../runtime/follow.ts';
import {sessionName} from './identity.ts';

export interface EditorViewport {columns:number;height:number;tabOrder?:readonly Tab[];}
export function notesEditorFits(viewport:EditorViewport):boolean{
  let lines=1,used=0;for(const tab of viewport.tabOrder??tabs){const name=(tab==='Notes'?'[':'')+tabLabel(tab,viewport.columns<50)+(tab==='Notes'?']':'');if(used&&used+name.length>viewport.columns){lines++;used=0;}used+=name.length+1;}return viewport.columns>=12&&viewport.height>=Math.max(10,lines+6);
}
const segments=new Intl.Segmenter(undefined,{granularity:'grapheme'});
function boundaries(text:string){return [...segments.segment(text)].map(s=>s.index).concat(text.length);}
function lineStart(text:string,cursor:number){return cursor===0?0:text.lastIndexOf('\n',cursor-1)+1;}
function lineEnd(text:string,cursor:number){const end=text.indexOf('\n',cursor);return end<0?text.length:end;}

export class NotesController extends EventEmitter {
  value?:NotesEditorState;
  private revision:string|null=null;
  private recovery?:NoteSnapshot;
  private dirty=false;
  private timer?:NodeJS.Timeout;
  private saving?:Promise<void>;
  private store:NotesStore;private delay:number;
  constructor(store:NotesStore,delay=500){super();this.store=store;this.delay=delay;}
  private changed(){this.emit('change',this.value);}
  async open(sessionKey:string,title:string,reload=false){
    await this.flush();
    if(this.value?.sessionKey===sessionKey&&!reload){this.value.title=title;return;}
    // Publish a new identity only after its own file has been read successfully.
    const note=await this.store.load(sessionKey);this.revision=note.revision;this.recovery=undefined;
    this.value={sessionKey,title,text:note.text,cursor:0,editing:false,persisted:note.revision!==null,status:'saved'};this.changed();
  }
  begin(viewport?:EditorViewport){if(viewport&&!notesEditorFits(viewport))return;if(this.value){this.value.editing=true;this.changed();}}
  private insert(text:string){const value=this.value!;const next=value.text.slice(0,value.cursor)+text+value.text.slice(value.cursor);if(Buffer.byteLength(next)>noteLimit){value.error='Notes exceed 1 MiB limit';this.changed();return;}value.text=next;value.cursor+=text.length;this.modified();}
  private modified(){this.dirty=true;this.value!.status=this.recovery?'conflict':'dirty';this.value!.error=undefined;clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush().catch(()=>{}),this.delay);this.changed();}
  paste(text:string,viewport?:EditorViewport){if(viewport&&!notesEditorFits(viewport))return;if(this.value?.editing)this.insert(sanitize(text).replace(/\r\n?/g,'\n'));}
  key(key:string,viewport?:EditorViewport):boolean{
    const value=this.value;if(!value?.editing)return false;
    if(viewport&&!notesEditorFits(viewport)){this.changed();return true;}
    if(['escape','tab','shift+tab','ctrl+c','ctrl+s'].includes(key))return false;
    const before=value.cursor,start=lineStart(value.text,before),end=lineEnd(value.text,before);
    if(key==='left')value.cursor=boundaries(value.text).filter(n=>n<before).at(-1)??0;
    else if(key==='right')value.cursor=boundaries(value.text).find(n=>n>before)??value.text.length;
    else if(key==='home')value.cursor=start;
    else if(key==='end')value.cursor=end;
    else if(key==='up'||key==='down'){
      const targetStart=key==='up'?lineStart(value.text,Math.max(0,start-1)):Math.min(value.text.length,end+1);
      if(key==='up'&&start===0||key==='down'&&end===value.text.length)return true;
      const targetEnd=lineEnd(value.text,targetStart),column=cellWidth(value.text.slice(start,before));let used=0;value.cursor=targetStart;
      for(const s of segments.segment(value.text.slice(targetStart,targetEnd))){const width=cellWidth(s.segment);if(used+width>column)break;used+=width;value.cursor+=s.segment.length;}
    }
    else if(key==='backspace'||key==='delete'){
      const from=key==='backspace'?(boundaries(value.text).filter(n=>n<before).at(-1)??0):before;
      const to=key==='delete'?(boundaries(value.text).find(n=>n>before)??value.text.length):before;
      if(to!==from){value.text=value.text.slice(0,from)+value.text.slice(to);value.cursor=from;this.modified();}return true;
    }
    else if(key==='enter')this.insert('\n');
    else if(key==='space')this.insert(' ');
    else if([...key].length===1&&key.codePointAt(0)!>=32)this.insert(key);
    else return true;
    this.changed();return true;
  }
  async flush():Promise<void>{
    clearTimeout(this.timer);
    if(this.saving){await this.saving;return this.dirty?this.flush():undefined;}
    if(!this.value||!this.dirty)return;
    this.saving=(async()=>{
      while(this.dirty){const value=this.value!,text=value.text;this.dirty=false;value.status='saving';this.changed();
        try{const saved=await this.store.save(value.sessionKey,text,this.revision,this.recovery);
          if(saved.conflict){this.recovery=saved;value.recoveryPath=saved.path;}else this.revision=saved.revision;
          value.persisted=true;value.savedAt=Date.now();value.status=this.dirty?'dirty':saved.conflict?'conflict':'saved';value.error=saved.conflict?'External edit preserved; this draft is saved separately.':undefined;this.changed();
        }catch(error){this.dirty=true;value.status='error';value.error=(error as Error).message;this.changed();throw error;}
      }
    })();
    try{await this.saving;}finally{this.saving=undefined;}
  }
  async end(){await this.flush();if(this.value){this.value.editing=false;this.changed();}}
  async close(){await this.end();clearTimeout(this.timer);}
}

/** Exact Markdown source: wrapping never rewrites its spaces or newlines. */
export function renderNotes(data:DashboardData,state:UiState,columns:number,height:number,now:number):RenderedScreen{
  columns=Math.max(1,Math.floor(columns));height=Math.max(1,Math.floor(height));
  const notesKey=resolveNotesSessionKey(state),note=state.notes?.sessionKey===notesKey?state.notes:undefined,editing=note?.editing===true;
  const owner=data.sessions.find(session=>session.key===notesKey),ownerName=owner?sessionName(owner):note?.title??'this agent';
  const title=`Notes for ${ownerName}`,inspecting=Boolean(state.boundSessionKey&&state.selectedKey!==state.boundSessionKey&&!state.pin&&!editing);
  const returnHint=inspecting&&!state.editingFilter;
  const action:ScreenRow={id:'notes-edit',text:note?.persisted===false?'Open editor':'Edit Markdown notes',help:`${title}. Enter edits this agent's notebook. Text autosaves after 500 ms. Escape returns to reading; Ctrl+S flushes. Follow is held while editing. Tab leaves after saving. Complete Prism removal deletes notes.`,action:{type:'notes-edit',sessionKey:notesKey}};if(note?.recoveryPath)action.help+=' Recovery draft: '+note.recoveryPath;
  const requestedScroll=state.notesScroll??state.scroll;
  state.cursor=0;state.cursorId='notes-edit';
  if(editing&&!notesEditorFits({columns,height,tabOrder:state.tabOrder})){
    const small=renderLayout(data,state,[{id:'notes',title:'Notes · enlarge panel',rows:[{...action,action:undefined,selectable:false}]}],columns,height,now);
    if(height>=2){small.spans![height-2]=fitSpans([span(state.notice??note?.error??'Editing paused · enlarge panel','warning')],columns);small.spans![height-1]=fitSpans([span('Esc read · Ctrl+S save · Tab leave','secondary')],columns);for(const i of [height-2,height-1])small.lines[i]=small.spans![i]!.map(p=>p.text).join('');}return small;
  }
  const frame=renderLayout(data,state,[{id:'notes',title,rows:[action]}],columns,height,now,new Map(),undefined,3);
  const sourceAction=frame.rowRegions?.find(region=>region.index===0),actionParts=sourceAction?frame.spans![sourceAction.y-1]:undefined;
  const framed=frame.bodyHeight>=4,showAction=frame.bodyHeight>=2;
  const first=frame.bodyStart+(framed?1:0)+(showAction?1:0),visible=frame.bodyHeight-(framed?2:0)-(showAction?1:0);
  const inset=columns>=4?2:0,room=Math.max(1,columns-(inset?4:0)),text=note?.text??'';
  const lines:{text:string;start:number;end:number}[]=[];let at=0;
  for(const raw of text.split('\n')){let current='',used=0,start=at;
    for(const s of segments.segment(raw)){const rendered=s.segment==='\t'?'    ':sanitize(s.segment),width=cellWidth(rendered);if(current&&used+width>room){lines.push({text:current,start,end:at});current='';used=0;start=at;}current+=rendered;used+=width;at+=s.segment.length;}
    lines.push({text:current,start,end:at});at++;
  }
  const cursor=Math.max(0,Math.min(note?.cursor??0,text.length));let cursorLine=lines.findIndex((line,i)=>cursor>=line.start&&(cursor<line.end||cursor===line.end&&(lines[i+1]?.start!==cursor)));if(cursorLine<0)cursorLine=lines.length-1;
  let scroll=Math.max(0,Math.min(requestedScroll,Math.max(0,lines.length-visible)));
  if(editing&&!state.notesFreeScroll){if(cursorLine<scroll)scroll=cursorLine;if(cursorLine>=scroll+visible)scroll=cursorLine-visible+1;}
  state.scroll=scroll;state.notesScroll=scroll;
  const setLine=(index:number,parts:TextSpan[])=>{if(state.ascii)parts=parts.map(part=>({...part,text:asciiText(part.text)}));frame.spans![index]=fitSpans(parts,columns);frame.lines[index]=frame.spans![index]!.map(part=>part.text).join('');};
  frame.rows=[action,...lines.map((line,index):ScreenRow=>({id:`notes-line:${index}`,section:'notes',text:line.text,selectable:false,band:false,help:action.help}))];
  frame.rowRegions=[];
  if(framed){const heading='┌ '+truncate(title,Math.max(1,columns-4))+' ';setLine(frame.bodyStart,[span(heading,'accent'),span('─'.repeat(Math.max(0,columns-cellWidth(heading)-1))+'┐','border')]);}
  if(showAction){const line=frame.bodyStart+(framed?1:0);setLine(line,actionParts??[span('› Edit Markdown notes →','accent',true)]);frame.rowRegions.push({index:0,x:sourceAction?.x??1,y:line+1,width:sourceAction?.width??columns,display:sourceAction?.display??'Edit Markdown notes',actionX:sourceAction?.actionX});frame.selectedLine=editing?undefined:line;}
  else frame.selectedLine=undefined;
  for(let offset=0;offset<visible;offset++){
    const index=scroll+offset,line=lines[index],raw=offset===0&&!note?'Loading notes…':index===0&&!text?'No notes yet. Open editor to write.':line?.text??'';
    setLine(first+offset,inset?[span('│ ','border'),span(pad(raw,room),/^#{1,6} /.test(raw)?'accent':'text'),span(' │','border')]:[span(raw,/^#{1,6} /.test(raw)?'accent':'text')]);
    if(line)frame.rowRegions.push({index:index+1,x:inset+1,y:first+offset+1,width:room,display:line.text});
  }
  if(framed)setLine(frame.bodyStart+frame.bodyHeight-1,[span('└'+'─'.repeat(Math.max(0,columns-2))+'┘','border')]);
  const indices=lines.map((_,index)=>index+1);
  frame.sectionRegions=[{id:'notes',x:1,y:first+1,width:columns,height:visible,contentHeight:visible,total:lines.length,scroll,indices,lineIndices:indices}];
  const status=state.notice??note?.error??(note?`${editing?'Editing · ':''}${note.status==='saved'?note.persisted===false?'Empty':'Saved':note.status==='conflict'?'Draft saved · external edit preserved':note.status}${note.savedAt?' · '+new Date(note.savedAt).toLocaleTimeString():''}`:'Loading notes…');
  if(height>=3)setLine(height-2,[span(status+(data.server?' · '+data.server.host+'/'+data.server.session:''),note?.status==='error'||note?.status==='conflict'?'warning':'secondary')]);
  const controls=editing?'Ctrl+S save · Esc read · Tab leave':'Enter edit · ↑↓ scroll · ? help · q',readingControls=returnHint?(cellWidth('Shift+F back to agent · '+controls)<=columns?'Shift+F back to agent · '+controls:'Shift+F back to agent · Enter · ?'):controls;
  if(height>=2)setLine(height-1,[span(readingControls,'secondary')]);
  if(editing&&cursorLine>=scroll&&cursorLine<scroll+visible){const line=lines[cursorLine]!,offset=text.slice(line.start,cursor).replace(/\t/g,'    ');frame.terminalCursor={line:first+cursorLine-scroll+1,column:Math.min(columns,cellWidth(offset)+inset+1)};frame.selectedLine=undefined;}
  return frame;
}
