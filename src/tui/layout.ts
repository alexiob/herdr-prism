import {resolveNotesSessionKey,inspectionParentKey} from '../runtime/follow.ts';
import {sessionName,breadcrumbPath,fitBreadcrumb} from './identity.ts';
import {orderedTabs,tabLabel} from './types.ts';
import type {DashboardData,UiState,ScreenRow,RenderedScreen,DetailDocument,DetailSection,TabRegion,RowRegion,SectionRegion,ReaderPosition} from './types.ts';
import type {TextSpan} from './theme.ts';
import {span,pad,summary,readableWrap,valueSpans,asciiText,fitSpans} from './widgets.ts';
import {cellWidth,truncate,age} from './text.ts';
export interface LayoutSection {id:string;title:string;rows:ScreenRow[];description?:string[];column?:0|1;fields?:DetailSection['fields'];text?:string;viewport?:boolean;}
export const sectionReaderKey=(state:UiState,id:string)=>`${state.selectedKey??''}:${state.tab}:${state.detailDocument?.processTarget?.key??''}:${state.help?'help:'+state.helpViewId:state.detail!==undefined?'detail:'+state.detailViewId:'main'}:${id}`;
export function processPanelHeights(factsRows:number,height:number):[number,number]{const facts=factsRows+2<=height-5?factsRows+2:height>=8?Math.max(3,Math.min(Math.floor(height/2),height-5)):Math.max(1,Math.floor(height/2));return[facts,Math.max(0,height-facts)];}
interface BodyLine {parts:TextSpan[];index?:number;display?:string;disclosureX?:number;actionX?:number;first?:boolean;}
interface Panel {id:string;title:string;column?:0|1;rows:ScreenRow[];content:BodyLine[];indices:number[];}
export function groupRows(rows:ScreenRow[],fallback:string):LayoutSection[]{
 const result:LayoutSection[]=[];for(const row of rows){const id=row.section??fallback;let section=result.at(-1);if(!section||section.id!==id){section={id,title:id,rows:[],column:row.column};result.push(section);}section.rows.push(row);}return result;
}
/** Fit every panel inside its allocation; retain all virtual entries for local navigation. */
export function renderLayout(data:DashboardData,state:UiState,sections:LayoutSection[],columns:number,height:number,now:number,numericTargets=new Map<number,string>(),document?:DetailDocument,minimumBodyRows=1):RenderedScreen{
 columns=Math.max(1,Math.floor(columns));height=Math.max(1,Math.floor(height));
 const notebook=state.tab==='Notes'&&!state.help&&state.detail===undefined;
 const displayedKey=notebook?resolveNotesSessionKey(state):state.selectedKey;
 const session=data.sessions.find(s=>s.key===displayedKey)??(!displayedKey&&!notebook&&!state.restrictAutomaticSelection&&!state.notes?.editing?data.sessions[0]:undefined);
 const name=session?sessionName(session):notebook&&state.notes&&state.notes.sessionKey===displayedKey?state.notes.title:'Agent unavailable',provider=session?.evidence.provider??'—',model=session?.evidence.model??session?.usage?.model??'model —';
 const inspecting=Boolean(!notebook&&state.boundSessionKey&&displayedKey!==state.boundSessionKey),transcriptOnly=inspecting&&session&&!session.attachment&&!session.attachments?.length;
 const navigationRegions:NonNullable<RenderedScreen['navigationRegions']>=[];
 const path=breadcrumbPath(data,notebook?displayedKey:state.boundSessionKey,displayedKey??session?.key);path.at(-1)!.label=name;
 const demoPrefix=data.demo&&columns>=20?'[DEMO] ':'',parts=fitBreadcrumb(path,columns-cellWidth(demoPrefix)),breadcrumb:TextSpan[]=[span(demoPrefix,'secondary')];let breadcrumbX=cellWidth(demoPrefix)+1;
 for(const [index,part]of parts.entries()){
  if(index){breadcrumb.push(span(' > ','secondary'));breadcrumbX+=3;}
  const current=index===parts.length-1;breadcrumb.push({...span(part.label,current?'accent':'path'),bold:current});
  if(part.key&&!current)navigationRegions.push({x:breadcrumbX,y:1,width:cellWidth(part.label),action:{type:part.key===state.boundSessionKey?'follow-bound':'select',sessionKey:part.key}});
  breadcrumbX+=cellWidth(part.label);
 }
 const header:TextSpan[][]=[breadcrumb,[span(`${provider} · ${model} · ${session?.evidence.state??'unknown'}${state.pin&&!notebook?' · Pinned':''}`,'identity')]];
 if(inspecting){
  const parentKey=inspectionParentKey(data,state),parent=data.sessions.find(s=>s.key===parentKey),owner=data.sessions.find(s=>s.key===state.boundSessionKey);
  const descriptor=transcriptOnly?'Recorded worker':'Worker view';
  const prefix=columns>=50?descriptor+' ':columns>=20?'Worker ':'';const line:TextSpan[]=[span(prefix,'warning')];let used=cellWidth(prefix);
  const buttons:{label:string;short:string;action:import('./types.ts').UiAction}[]=[];
  if(parentKey&&parentKey!==state.boundSessionKey)buttons.push({label:'← Parent: '+sessionName(parent),short:'← Parent',action:{type:'select',sessionKey:parentKey}});
  buttons.push({label:'↑ Owning agent: '+sessionName(owner),short:'↑ Owner',action:{type:'follow-bound',sessionKey:state.boundSessionKey}});
  for(const [i,button]of buttons.entries()){
   const remaining=columns-used-(buttons.length-i-1),width=Math.max(0,Math.floor(remaining/(buttons.length-i)));
   if(!width)continue;const label=summary(columns>=50?button.label:button.short,width);
   navigationRegions.push({x:used+1,y:header.length+1,width:cellWidth(label),action:button.action});line.push({...span(label,'accent'),surface:'tab',bold:true});used+=cellWidth(label);if(used<columns){line.push(span(' '));used++;}
  }
  header.push(line);
 }
 let tabLine:TextSpan[]=[],used=0;const tabRegions:TabRegion[]=[];
 const order=orderedTabs(state),labels=order.map(tab=>tabLabel(tab,columns<50));
 const finish=()=>{if(used<columns)tabLine.push({...span(' '.repeat(columns-used),'secondary'),surface:'tabbar'});header.push(tabLine);tabLine=[];used=0;};
 for(const [i,tab]of order.entries()){
  const label=tab===state.tab?'['+labels[i]!+']':labels[i]!,size=Math.min(columns,cellWidth(label));if(used+size>columns&&tabLine.length)finish();
  tabRegions.push({tab,x:used+1,y:header.length+1,width:size});tabLine.push({...span(truncate(label,size),tab===state.tab?'accent':'secondary'),surface:tab===state.tab?'activeTab':'tab',bold:tab===state.tab});used+=size;
  if(used<columns){tabLine.push({...span(' ','secondary'),surface:'tabbar'});used++;}
 }
 if(tabLine.length)finish();
 const footerRows=Math.min(2,Math.max(0,height-1)),headerBudget=Math.max(0,height-footerRows-Math.min(Math.max(1,minimumBodyRows),height-footerRows));
 const removeHeader=(at:number)=>{header.splice(at,1);for(const region of navigationRegions)region.y=region.y===at+1?0:region.y>at+1?region.y-1:region.y;for(const region of tabRegions)region.y=region.y===at+1?0:region.y>at+1?region.y-1:region.y;};
 // Keep the active tab and at least one content line, even in a one-cell terminal.
 for(let n=0;n<2&&header.length>headerBudget;n++)removeHeader(1);
 while(header.length>headerBudget){const activeY=tabRegions.find(region=>region.tab===state.tab)?.y??0;let at=header.findIndex((_,i)=>i>0&&i+1!==activeY);if(at<0)at=0;removeHeader(at);}
 const bodyStart=header.length,bodyHeight=height-bodyStart-footerRows;
 const rows:ScreenRow[]=[],panels:Panel[]=[];
 const addRow=(row:ScreenRow,section:string)=>{const index=rows.length;rows.push({...row,section});return index;};
 const blank=(width:number):BodyLine=>({parts:[span('│'+' '.repeat(Math.max(0,width-2))+'│','border')]});
 const build=(section:LayoutSection,width:number):Panel=>{
  const content:BodyLine[]=[],indices:number[]=[],room=Math.max(1,width-4);let band=0;
  const addProse=(text:string,role:import('./theme.ts').ColorRole='text',id='text')=>{
   for(const [i,line]of readableWrap(text,room).entries()){
    const index=addRow({id:`${section.id}:${id}:${i}`,text:line,selectable:false,band:false,help:document?.help??'Scroll to read the complete recorded content. Left/right switches panels; Escape returns.'},section.id);indices.push(index);
    content.push({parts:[span('│ ','border'),span(pad(line,room),role),span(' │','border')],index,display:line});
   }
  };
  for(const [i,text]of (section.description??[]).entries())addProse(text,'secondary','description'+i);
  const renderRow=(input:ScreenRow,fullField=false)=>{
   const row={...input,messageBand:band%2 as 0|1};if(row.band!==false)band++;
   const arrow=row.action?' →':'',available=Math.max(1,room-cellWidth(arrow));
   if(row.valueForWidth){const valueWidth=fullField?Math.max(1,room-Math.min(12,Math.max(1,room-1))):Math.max(1,available-(row.label?Math.min(10,available):0));row.value=row.valueForWidth(valueWidth);row.text=(row.label?row.label+': ':'')+row.value;if(row.copy!==undefined)row.copy=row.value;}
   const index=addRow(row,section.id);indices.push(index);const selected=index===state.cursor&&row.selectable!==false;
   for(let gap=0;gap<Math.min(2,row.gapBefore??0);gap++)content.push(blank(width));
   const makeLine=(parts:TextSpan[],display:string,first:boolean)=>{
    const interior=[span(first&&selected?'›':' ',selected?'accent':'text',selected),...parts,span(' ',row.role??'text',selected)];
    if(row.band!==false)for(const part of interior)part.surface=row.messageBand?'messageOdd':'messageEven';
    content.push({parts:[span('│','border'),...interior,span('│','border')],index,display,first,actionX:first&&row.action?width-2:undefined,disclosureX:first&&row.disclosureColumn?row.disclosureColumn+2:undefined});
   };
   if(fullField){
    const labelWidth=Math.min(12,Math.max(1,room-1)),valueWidth=Math.max(1,room-labelWidth);
    const longLabel=cellWidth(row.label??'')>labelWidth;
    if(longLabel)for(const [i,label]of readableWrap(row.label??'',room).entries())makeLine([span(pad(label,room),'secondary',selected)],label,i===0);
    for(const [i,line]of readableWrap(row.value??'',valueWidth).entries()){
     const label=pad(i||longLabel?'':row.label??'',labelWidth);makeLine([span(label,'secondary',selected),...valueSpans(pad(line,valueWidth),row.role,selected)],label+line,!longLabel&&i===0);
    }
   }else{
    const prefix=row.label?pad(summary(row.label,Math.min(10,available)),Math.min(10,available)):'';
    const main=row.label?prefix+summary(row.value??'',Math.max(1,available-cellWidth(prefix))):summary(row.text,available),display=pad(main,available)+arrow;
    makeLine(row.label?[span(prefix,'secondary',selected),...valueSpans(pad(main.slice(prefix.length),available-cellWidth(prefix)),row.role,selected),span(arrow,'accent',selected)]:[...valueSpans(pad(main,available),row.role,selected),span(arrow,'accent',selected)],display,true);
    for(const part of row.continuations??[])for(const line of readableWrap(part.text,room))makeLine(valueSpans(pad(line,room),part.role??'text',selected),line,false);
   }
  };
  for(const [i,field]of (section.fields??[]).entries())renderRow({id:`${section.id}:field:${i}`,text:field.label+': '+field.value,label:field.label,value:field.value,valueForWidth:field.valueForWidth,role:field.role,copy:field.value,help:document?.help??'Recorded field. The full value wraps within this panel; arrows select whole fields and paging or wheels scroll their content.'},true);
  if(section.text!==undefined)addProse(section.text);
  for(const row of section.rows)renderRow(row);
  if(!indices.length)addProse('No recorded items','secondary','empty');
  return{id:section.id,title:section.title,column:section.column,rows:indices.map(index=>rows[index]!),content,indices};
 };
 const processPanels=Boolean(document?.processTarget&&sections.some(section=>section.id==='output'));
 let two=columns>=80&&sections.some(section=>section.column===1)&&sections.some(section=>section.column!==1)&&!processPanels;
 const maxColumnCount=two?Math.max(sections.filter(section=>section.column!==1).length,sections.filter(section=>section.column===1).length):sections.length;
 let focusedOnly=bodyHeight<Math.max(1,maxColumnCount)*3;
 if(processPanels)focusedOnly=bodyHeight<6;
 if(focusedOnly)two=false;
 const leftWidth=two?Math.floor((columns-2)/2):columns;
 for(const section of sections)panels.push(build(section,two&&section.column===1?columns-leftWidth-2:leftWidth));
 if(processPanels){
  const facts=panels.filter(panel=>panel.id!=='output'),output=panels.find(panel=>panel.id==='output')!;
  const content:BodyLine[]=[],indices:number[]=[];
  for(const panel of facts){content.push({parts:[span('  '+panel.title,'accent')]},...panel.content);indices.push(...panel.indices);for(const index of panel.indices)rows[index]!.section='Process facts';}
  panels.splice(0,panels.length,{id:'Process facts',title:'Process facts',rows:indices.map(index=>rows[index]!),content,indices}, {...output,id:'Output',title:'Output · shared terminal'});for(const index of output.indices)rows[index]!.section='Output';
 }
 const anchor=state.cursorId?rows.findIndex(row=>row.id===state.cursorId):-1;if(anchor>=0)state.cursor=anchor;
 state.cursor=Math.max(0,Math.min(state.cursor,rows.length-1));const active=panels.find(panel=>panel.indices.includes(state.cursor))??panels[0];
 for(const panel of panels)for(const line of panel.content){if(line.index===undefined||line.first===undefined)continue;const selected=line.index===state.cursor&&rows[line.index]?.selectable!==false;for(const part of line.parts)if(part.role!=='border')part.selected=selected;if(line.parts[1]){line.parts[1]!.text=line.first&&selected?'›':' ';line.parts[1]!.role=selected?'accent':'text';}}
 const allocations=new Map<Panel,{x:number;y:number;width:number;height:number}>();
 const allocate=(items:Panel[],x:number,width:number)=>{
  const needs=items.map(panel=>panel.content.length+2),sizes=needs.map(need=>Math.min(3,need));let remaining=bodyHeight-sizes.reduce((a,b)=>a+b,0);
  while(remaining>0){let at=-1;for(let i=0;i<sizes.length;i++)if(needs[i]!>sizes[i]!&&(at<0||needs[i]!-sizes[i]!>needs[at]!-sizes[at]!))at=i;if(at<0)break;sizes[at]!++;remaining--;}
  let y=bodyStart+1;for(const [i,panel]of items.entries()){allocations.set(panel,{x,y,width,height:sizes[i]!});y+=sizes[i]!;}
 };
 if(focusedOnly&&active)allocations.set(active,{x:1,y:bodyStart+1,width:columns,height:bodyHeight});
 else if(processPanels){const [factsHeight,outputHeight]=processPanelHeights(panels[0]!.content.length,bodyHeight);allocations.set(panels[0]!,{x:1,y:bodyStart+1,width:columns,height:factsHeight});allocations.set(panels[1]!,{x:1,y:bodyStart+factsHeight+1,width:columns,height:outputHeight});}
 else if(two){allocate(panels.filter(panel=>panel.column!==1),1,leftWidth);allocate(panels.filter(panel=>panel.column===1),leftWidth+3,columns-leftWidth-2);}
 else allocate(panels,1,columns);
 const body:TextSpan[][]=Array.from({length:bodyHeight},()=>[span(' '.repeat(columns))]),rowRegions:RowRegion[]=[],sectionRegions:SectionRegion[]=[];
 const fragments=new Map<number,{x:number;parts:TextSpan[]}[]>();
 const readers=state.sectionReaders??=new Map<string,ReaderPosition>();
 for(const panel of panels){
  const geometry=allocations.get(panel)??{x:1,y:bodyStart+1,width:columns,height:0},h=geometry.height;
  const contentHeight=h>=3?h-2:h;const key=sectionReaderKey(state,panel.id),reader=readers.get(key)??{cursor:panel.indices[0]??0,scroll:0};
  let scroll=Math.max(0,Math.min(reader.scroll,Math.max(0,panel.content.length-contentHeight)));
  const selected=panel.content.flatMap((line,i)=>line.index===state.cursor?[i]:[]);
  if(selected.length&&!reader.freeScroll&&contentHeight>0){const first=selected[0]!,last=selected.at(-1)!;if(last-first+1<=contentHeight){if(first<scroll)scroll=first;if(last>=scroll+contentHeight)scroll=last-contentHeight+1;}else if(first<scroll||first>=scroll+contentHeight)scroll=first;}
  else if(panel.id==='Retained messages'&&state.messageReaders.get(state.selectedKey??'')?.following)scroll=Math.max(0,panel.content.length-contentHeight);
  reader.scroll=scroll;if(selected.length){reader.cursor=state.cursor;reader.cursorId=rows[state.cursor]?.id;state.scroll=scroll;}readers.set(key,reader);
  sectionRegions.push({id:panel.id,...geometry,scroll,total:panel.content.length,indices:panel.indices,lineIndices:panel.content.map(line=>line.index??-1),contentHeight});
  if(!h)continue;
  const lines:BodyLine[]=[];
  if(h>=3){const title=panel.title+(focusedOnly&&panels.length>1?` (${panels.indexOf(panel)+1}/${panels.length})`:'');const heading='┌ '+truncate(title,Math.max(1,geometry.width-4))+' ';lines.push({parts:[span(heading,panel===active?'accent':'secondary'),span('─'.repeat(Math.max(0,geometry.width-cellWidth(heading)-1))+'┐','border')]});}
  lines.push(...panel.content.slice(scroll,scroll+contentHeight));while(lines.length<(h>=3?h-1:h))lines.push(blank(geometry.width));
  if(h>=3)lines.push({parts:[span('└'+'─'.repeat(Math.max(0,geometry.width-2))+'┘','border')]});
  for(const [i,line]of lines.entries()){
   const at=geometry.y-bodyStart-1+i;if(at<0||at>=bodyHeight)continue;
   const parts=fitSpans(line.parts,geometry.width),before=geometry.x-1;
   if(two){const list=fragments.get(at)??[];list.push({x:before,parts});fragments.set(at,list);}
   else body[at]=parts;
   if(line.index!==undefined){const inset=geometry.width>=5?2:0;rowRegions.push({index:line.index,x:geometry.x+inset,y:geometry.y+i,width:Math.max(1,geometry.width-inset-1),display:line.display??'',disclosureX:line.disclosureX===undefined?undefined:geometry.x+line.disclosureX-1,actionX:line.actionX===undefined?undefined:geometry.x+line.actionX-1});}
  }
 }
 for(const [at,list]of fragments){const line:TextSpan[]=[];let used=0;for(const fragment of list.sort((a,b)=>a.x-b.x)){line.push(span(' '.repeat(Math.max(0,fragment.x-used))),...fragment.parts);used=fragment.x+cellWidth(fragment.parts.map(part=>part.text).join(''));}line.push(span(' '.repeat(Math.max(0,columns-used))));body[at]=line;}
 while(readers.size>96)readers.delete(readers.keys().next().value!);
 const messageReader=session&&state.tab==='Messages'?state.messageReaders.get(session.key):undefined;
 const status=state.notice??`${data.server?data.server.host+'/'+data.server.session+' · ':''}${inspecting?transcriptOnly?'Recorded worker · Esc parent · Shift+F owning agent · ':'Worker view · Esc parent · Shift+F owning agent · ':notebook?'':'Following '+name+' · '}${data.stale?'STALE · ':''}${messageReader?.newCount?`${messageReader.newCount} new · `:messageReader?.following?'Following end · ':''}${document?.capturedAt!==undefined?'Snapshot '+age(document.capturedAt,now):'Evidence '+age(data.updatedAt,now)} ago`;
 let controls=state.processConfirmation&&!state.help?'Enter choose · y confirm · Esc cancel · ? help':state.editingFilter?'Filter: '+state.filter:state.numberPrefix?'Prism agent: '+state.numberPrefix+' · Enter':state.help?'↑↓ scroll · Esc back · ? help':document?.processTarget?'←→ panel · r output · Shift+K terminate · Esc · ? help':document?'←→ panel · ↑↓ entries · Pg scroll · Esc · ?':state.tab==='Processes'?'←→ panel · Enter · Shift+K terminate · ?':state.tab==='Agents'?'Enter inspect · f focus · ←→ panel · ?':'←→ panel · ↑↓ entries · Pg scroll · Enter · ?';
 if(inspecting&&!state.help&&!state.editingFilter&&!state.processConfirmation){const back=document||state.refSources?'Esc back':'Esc parent';controls+=' · '+back+' · Shift+F owner';if(cellWidth(controls)>columns&&!document?.processTarget)controls=back+' · Shift+F owner';}
 if(document?.processTarget&&!state.help&&cellWidth(controls)>columns)controls=inspecting?'r output · Shift+K · Esc · Shift+F':'r output · Shift+K · Esc · ?';
 const spans:TextSpan[][]=[...header,...body,...footerRows===2?[[span(status,data.stale||transcriptOnly?'warning':'secondary')],[span(controls,'secondary')]]:footerRows===1?[[span(controls,'secondary')]]:[]];
 for(let i=0;i<spans.length;i++){if(state.ascii)for(const part of spans[i]!)part.text=asciiText(part.text);spans[i]=fitSpans(spans[i]!,columns);}
 const selectedRegion=rowRegions.find(region=>region.index===state.cursor),lines=spans.map(line=>line.map(part=>part.text).join(''));
 return{lines,spans,rows,selectedLine:rows[state.cursor]?.selectable===false?undefined:selectedRegion?selectedRegion.y-1:undefined,bodyStart,bodyHeight,numericTargets,rowRegions,tabRegions:tabRegions.filter(region=>region.y>0),navigationRegions:navigationRegions.filter(region=>region.y>0),sectionRegions,theme:state.monochrome?'mono':state.theme??'dark'};
}
