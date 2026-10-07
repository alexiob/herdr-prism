import {orderedTabs,tabLabel} from './types.ts';
import type {DashboardData,UiState,ScreenRow,RenderedScreen,DetailDocument,DetailSection,TabRegion,RowRegion,SectionRegion} from './types.ts';
import type {TextSpan} from './theme.ts';
import {span,pad,summary,readableWrap,valueSpans,asciiText,fitSpans} from './widgets.ts';
import {cellWidth,truncate,age} from './text.ts';
export interface LayoutSection {id:string;title:string;rows:ScreenRow[];description?:string[];column?:0|1;fields?:DetailSection['fields'];text?:string;viewport?:boolean;}
export const sectionReaderKey=(state:UiState,id:string)=>`${state.selectedKey??''}:${state.tab}:${state.detailDocument?.processTarget?.key??''}:${id}`;
export function processPanelHeights(factsRows:number,height:number):[number,number]{const facts=factsRows+2<=height-5?factsRows+2:height>=8?Math.max(3,Math.min(Math.floor(height/2),height-5)):Math.max(1,Math.floor(height/2));return[facts,Math.max(0,height-facts)];}
interface BodyLine {parts:TextSpan[];positions:{index:number;column:number;width:number;display:string;disclosureX?:number}[];}

export function groupRows(rows:ScreenRow[],fallback:string):LayoutSection[]{
  const result:LayoutSection[]=[];for(const row of rows){const id=row.section??fallback;let section=result.at(-1);if(!section||section.id!==id){section={id,title:id,rows:[],column:row.column};result.push(section);}section.rows.push(row);}return result;
}
export function renderLayout(data:DashboardData,state:UiState,sections:LayoutSection[],columns:number,height:number,now:number,numericTargets=new Map<number,string>(),document?:DetailDocument,minimumBodyRows=1):RenderedScreen{
  columns=Math.max(1,Math.floor(columns));height=Math.max(1,Math.floor(height));
  const session=data.sessions.find(s=>s.key===state.selectedKey)??(!state.restrictAutomaticSelection&&!state.notes?.editing?data.sessions[0]:undefined);
  const name=session?.evidence.title??session?.evidence.id??state.notes?.title??'No session';
  const stateName=session?.evidence.state??'unknown',provider=session?.evidence.provider??'—',model=session?.evidence.model??session?.usage?.model??'model —';
  const inspecting=Boolean(state.boundSessionKey&&state.selectedKey!==state.boundSessionKey&&!state.pin),transcriptOnly=inspecting&&session&&!session.attachment&&!session.attachments?.length;
  const scope=state.subtree?'Subtree':'Self + jobs',server=data.server?data.server.host+'/'+data.server.session:'Server —';
  const selectionMode=state.pin?'Pinned':inspecting?'Inspecting · Shift+F follow':'Follow';
  const tail=` · ${stateName}`;const metadata=(cellWidth(`${provider} · ${model}${tail}`)<=columns?`${provider} · ${model}`:truncate(provider,Math.max(1,columns-cellWidth(tail))))+tail;
  const header=[ [span(truncate(`${data.demo?'[DEMO] ':''}Prism · ${name}`,columns),'accent')], [span(metadata,'identity')], [span(truncate(inspecting?`${selectionMode} · ${server} · ${scope}`:`${server} · ${scope} · ${selectionMode}`,columns),inspecting?'warning':'secondary')] ];
  const tabRegions:TabRegion[]=[];let tabLine:TextSpan[]=[],used=0;
  const finishTabLine=()=>{if(used<columns)tabLine.push({...span(' '.repeat(columns-used),'secondary'),surface:'tabbar'});header.push(tabLine);tabLine=[];used=0;};
  const order=orderedTabs(state),labels=order.map(tab=>tabLabel(tab,columns<50));
  for(const [i,tab]of order.entries()){
    const name=labels[i]!,label=(tab===state.tab?'['+name+']':name),size=cellWidth(label);
    if(used+size>columns&&tabLine.length)finishTabLine();
    tabRegions.push({tab,x:used+1,y:header.length+1,width:size});tabLine.push({...span(label,tab===state.tab?'accent':'secondary'),surface:tab===state.tab?'activeTab':'tab',bold:tab===state.tab});used+=size;
    if(used<columns){tabLine.push({...span(' ','secondary'),surface:'tabbar'});used++;}
  }
  if(tabLine.length)finishTabLine();
  // Keep room for the selected entry in short terminals; tabs keep measured targets.
  if(header.length>height-2-minimumBodyRows){header.splice(1,Math.min(2,header.length-(height-2-minimumBodyRows)));for(const region of tabRegions)region.y=header.findIndex(line=>line.some(part=>part.text.trim()===(region.tab===state.tab?'['+labels[order.indexOf(region.tab)]+']':labels[order.indexOf(region.tab)])))+1;}
  const rows=sections.flatMap(section=>section.rows),indices=new Map(rows.map((row,i)=>[row,i]));
  const sectionLines=(items:LayoutSection[],width:number):BodyLine[]=>{
    const lines:BodyLine[]=[];for(const section of items){
      const heading='┌ '+truncate(section.title,Math.max(1,width-4))+' ';lines.push({parts:[span(heading,'accent'),span('─'.repeat(Math.max(0,width-cellWidth(heading)-1))+'┐','border')],positions:[]});
      for(const description of section.description??[])for(const line of readableWrap(description,width-4))lines.push({parts:[span('│ ','border'),span(pad(line,width-4),'secondary'),span(' │','border')],positions:[]});
      for(const field of section.fields??[]){const labelWidth=Math.min(12,Math.max(1,width-8)),valueWidth=Math.max(1,width-4-labelWidth);if(cellWidth(field.label)>labelWidth)for(const label of readableWrap(field.label,width-4))lines.push({parts:[span('│ ','border'),span(pad(label,width-4),'secondary'),span(' │','border')],positions:[]});for(const [i,line]of readableWrap(field.value,valueWidth).entries())lines.push({parts:[span('│ ','border'),span(pad(i||cellWidth(field.label)>labelWidth?'':field.label,labelWidth),'secondary'),...valueSpans(pad(line,valueWidth),field.role),span(' │','border')],positions:[]});}
      if(section.text!==undefined)for(const line of readableWrap(section.text,width-4))lines.push({parts:[span('│ ','border'),span(pad(line,width-4),'text'),span(' │','border')],positions:[]});
      for(const row of section.rows){
        const index=indices.get(row)!,selected=row.selectable!==false&&index===state.cursor,room=Math.max(1,width-4),arrow=row.action?' →':'',available=Math.max(1,room-cellWidth(arrow));
        const prefix=row.label?pad(summary(row.label,Math.min(10,available)),Math.min(10,available)):'';
        const main=row.label?prefix+summary(row.value??'',Math.max(1,available-cellWidth(prefix))):summary(row.text,available);
        const display=pad(main,available)+arrow;
        const parts=row.label?[span(prefix,'secondary',selected),...valueSpans(pad(main.slice(prefix.length),available-cellWidth(prefix)),row.role,selected),span(arrow,'accent',selected)]:[...valueSpans(pad(main,available),row.role,selected),span(arrow,'accent',selected)];
        const interior=[span(selected?'›':' ',selected?'accent':'text',selected),...parts,span(' ',row.role??'text',selected)];
        if(row.messageBand!==undefined)for(const part of interior)part.surface=row.messageBand?'messageOdd':'messageEven';
        lines.push({parts:[span('│','border'),...interior,span('│','border')],positions:[{index,column:3,width:room,display,disclosureX:row.disclosureColumn?row.disclosureColumn+2:undefined}]});
      }
      lines.push({parts:[span('└'+'─'.repeat(Math.max(0,width-2))+'┘','border')],positions:[]});
    }return lines;
  };
  const two=columns>=80&&sections.some(section=>section.column===1)&&sections.some(section=>section.column!==1);
  const processPanels=Boolean(document?.processTarget&&sections.some(section=>section.id==='output'));
  const bodyStart=header.length,bodyHeight=Math.max(1,height-bodyStart-2),independent=processPanels||!document&&sections.length>1&&sections.every(section=>section.viewport),sectionRegions:SectionRegion[]=[];
  const columnsBody=(items:LayoutSection[]):BodyLine[]=>{
    if(columns<80||!items.some(section=>section.column===1)||!items.some(section=>section.column!==1))return sectionLines(items,columns);
    const leftWidth=Math.floor((columns-2)/2),left=sectionLines(items.filter(section=>section.column!==1),leftWidth),right=sectionLines(items.filter(section=>section.column===1),columns-leftWidth-2);
    return Array.from({length:Math.max(left.length,right.length)},(_,i)=>({parts:[...(left[i]?.parts??[span(' '.repeat(leftWidth))]),span('  '),...(right[i]?.parts??[span(' '.repeat(columns-leftWidth-2))])],positions:[...left[i]?.positions??[],...(right[i]?.positions??[]).map(position=>({...position,column:position.column+leftWidth+2}))]}));
  };
  let body:BodyLine[];
  if(independent){
    body=[];const readers=state.sectionReaders??=new Map();
    let panels:{section:LayoutSection;source:BodyLine[]}[]=processPanels?[]:sections.map(section=>({section,source:sectionLines([section],columns)}));
    let heights=sections.map((_,i)=>Math.floor(bodyHeight/sections.length)+(i<bodyHeight%sections.length?1:0));
    if(processPanels){
      const facts=columnsBody(sections.filter(section=>section.id!=='output')),output=sections.find(section=>section.id==='output')!,heading=sectionLines([{id:'Process facts',title:'Process facts',rows:[]}],columns);
      panels=[{section:{id:'Process facts',title:'Process facts',rows:[]},source:[heading[0]!,...facts,heading.at(-1)!]},{section:{...output,id:'Output',title:'Output · shared terminal',rows:[]},source:sectionLines([{...output,title:'Output · shared terminal'}],columns)}];
      const actions=rows.slice();rows.splice(0,rows.length);
      for(const panel of panels)for(const [i,line]of panel.source.slice(1,-1).entries()){
        const action=line.positions[0],row=action?{...actions[action.index]!,section:panel.section.id}:{id:`process:${document!.processTarget!.key}:${panel.section.id}:${i}`,section:panel.section.id,text:line.parts.map(part=>part.text).join(''),selectable:false,help:(document?.help??'')+'\n\nLeft/right switches facts and output. Arrows, Home/End and Page Up/Down scroll the active panel; mouse wheels scroll the hovered panel. Escape returns.'};
        const index=rows.length;rows.push(row);panel.section.rows.push(row);
        for(const position of line.positions)position.index=index;
        if(!line.positions.length)line.positions.push({index,column:1,width:columns,display:row.text});
      }
      const anchor=state.cursorId?rows.findIndex(row=>row.id===state.cursorId):-1;if(anchor>=0)state.cursor=anchor;state.cursor=Math.max(0,Math.min(state.cursor,rows.length-1));
      for(const panel of panels)for(const line of panel.source.slice(1,-1)){
        let used=0;for(const part of line.parts){part.selected=false;for(const position of line.positions){const row=rows[position.index]!,selected=position.index===state.cursor&&row.selectable!==false,marker=position.column-2;if(row.action&&used===marker&&part.text.length===1){part.text=selected?'›':' ';part.role=selected?'accent':'text';}if(row.action&&used>=marker&&used<marker+position.width+1&&part.role!=='border')part.selected=selected;}used+=cellWidth(part.text);}
      }
      heights=processPanelHeights(facts.length,bodyHeight);
    }
    for(const [i,{section,source}]of panels.entries()){
      const panelHeight=heights[i]!,contentHeight=Math.max(0,panelHeight-(panelHeight>=3?2:1)),content=source.slice(1,-1),selected=content.findIndex(line=>line.positions.some(position=>position.index===state.cursor));
      const reader=readers.get(sectionReaderKey(state,section.id))??{cursor:section.rows[0]?rows.indexOf(section.rows[0]):0,cursorId:section.rows[0]?.id,scroll:selected>=0?state.scroll:0};
      let scroll=Math.max(0,Math.min(reader.scroll,Math.max(0,content.length-contentHeight)));
      if(selected>=0){if(selected<scroll)scroll=selected;if(selected>=scroll+contentHeight)scroll=Math.max(0,selected-contentHeight+1);reader.cursor=state.cursor;reader.cursorId=rows[state.cursor]?.id;}
      else if(section.id==='Retained messages'&&state.messageReaders.get(state.selectedKey??'')?.following)scroll=Math.max(0,content.length-contentHeight);
      reader.scroll=scroll;readers.set(sectionReaderKey(state,section.id),reader);if(selected>=0)state.scroll=scroll;
      sectionRegions.push({id:section.id,x:1,y:bodyStart+body.length+1,width:columns,height:panelHeight,scroll,total:content.length,indices:processPanels?content.flatMap(line=>line.positions.map(position=>position.index)):section.rows.map(row=>indices.get(row)!)});
      if(panelHeight)body.push(source[0]!);
      body.push(...content.slice(scroll,scroll+contentHeight));
      for(let blank=Math.min(contentHeight,Math.max(0,content.length-scroll));blank<contentHeight;blank++)body.push({parts:[span('│'+' '.repeat(Math.max(0,columns-2))+'│','border')],positions:[]});
      if(panelHeight>=3)body.push(source.at(-1)!);
    }
    while(readers.size>96)readers.delete(readers.keys().next().value!);
  }
  else if(two){const leftWidth=Math.floor((columns-2)/2),left=sectionLines(sections.filter(s=>s.column!==1),leftWidth),right=sectionLines(sections.filter(s=>s.column===1),columns-leftWidth-2);body=Array.from({length:Math.max(left.length,right.length)},(_,i)=>({parts:[...(left[i]?.parts??[span(' '.repeat(leftWidth))]),span('  '),...(right[i]?.parts??[span(' '.repeat(columns-leftWidth-2))])],positions:[...left[i]?.positions??[],...(right[i]?.positions??[]).map(p=>({...p,column:p.column+leftWidth+2,disclosureX:p.disclosureX===undefined?undefined:p.disclosureX+leftWidth+2}))]}));}
  else body=sectionLines(sections,columns);
  let selectedBody=body.findIndex(line=>line.positions.some(position=>position.index===state.cursor));
  if(!processPanels&&(document||!rows.length)){
    const actions=rows.slice();const physical=body.map((line,i)=>{
      const action=line.positions[0];return action?actions[action.index]!:{id:`detail:${i}`,text:line.parts.map(p=>p.text).join(''),selectable:false,help:document?.help??'Scroll to read all recorded content. Escape returns to the previous entry.'};
    });
    rows.splice(0,rows.length,...physical);
    const anchor=state.cursorId?rows.findIndex(row=>row.id===state.cursorId):-1;if(anchor>=0)state.cursor=anchor;
    state.cursor=Math.max(0,Math.min(state.cursor,rows.length-1));selectedBody=state.cursor;
    for(const [i,line]of body.entries()){
      for(const position of line.positions)position.index=i;
      let used=0;for(const part of line.parts){part.selected=false;for(const position of line.positions){const marker=position.column-2,selected=i===state.cursor;if(used===marker&&part.text.length===1){part.text=selected?'›':' ';part.role=selected?'accent':'text';}if(used>=marker&&used<marker+position.width+1&&part.role!=='border')part.selected=selected;}used+=cellWidth(part.text);}
    }
  }
  if(selectedBody<0)selectedBody=0;
  if(!independent){if(selectedBody<state.scroll)state.scroll=selectedBody;if(selectedBody>=state.scroll+bodyHeight)state.scroll=selectedBody-bodyHeight+1;state.scroll=Math.max(0,Math.min(state.scroll,Math.max(0,body.length-bodyHeight)));}
  const spans:TextSpan[][]=[...header],rowRegions:RowRegion[]=[];
  const viewportScroll=independent?0:state.scroll;
  for(let at=viewportScroll;at<Math.min(body.length,viewportScroll+bodyHeight);at++){const line=body[at]!;for(const position of line.positions){rowRegions.push({index:position.index,x:position.column,y:spans.length+1,width:position.width,display:position.display,disclosureX:position.disclosureX});if(position.disclosureX!==undefined)rows[position.index]!.disclosureColumn=position.disclosureX;}spans.push(line.parts);}
  while(spans.length<height-2)spans.push([span('')]);
  const messageReader=session&&state.tab==='Messages'?state.messageReaders.get(session.key):undefined;
  const status=state.notice??`${inspecting?transcriptOnly?'Transcript only · Shift+F follow bound agent · ':'Inspecting · Shift+F follow bound agent · ':''}${data.stale?'STALE · ':''}${messageReader?.newCount?`${messageReader.newCount} new · `:messageReader?.following?'Following end · ':''}${document?.capturedAt!==undefined?'Snapshot '+age(document.capturedAt,now):'Evidence '+age(data.updatedAt,now)} ago`;
  const controls=state.processConfirmation&&!state.help?'Enter choose · y confirm · Esc cancel · ? help':state.editingFilter?'Filter: '+state.filter:state.numberPrefix?'Prism agent: '+state.numberPrefix+' · Enter':state.help||state.detail!==undefined?(state.detailDocument?.processTarget&&!state.help?(columns<50?'←→ · r · Shift+K · Esc · ?':'←→ panel · r output · Shift+K terminate · Esc · ? help'):'↑↓ scroll · Esc back · ? help'):state.tab==='Processes'?'Enter detail · Shift+K terminate · ? help':state.tab==='Agents'?'Enter inspect · f focus · ? help':state.tab==='Messages'?'←→ panel · ↑↓ scroll · Enter · ? help':state.tab==='Refs'?'Enter detail · Space sources · ? help':state.tab==='To-do'?'Enter detail · x check · ? help':state.tab==='Notes'?'Enter edit · Ctrl+S save · ? help':columns<50?'Enter · ? help · Tab · q':'Enter open · Tab views · ? help · q close';
  const followHint=inspecting&&!state.help&&!state.processConfirmation&&!state.editingFilter&&!state.notes?.editing&&cellWidth(controls+' · Shift+F follow')<=columns?' · Shift+F follow':'';
  spans.push([span(truncate(status,columns),data.stale||transcriptOnly?'warning':'secondary')],[span(truncate(controls+followHint,columns),'secondary')]);
  if(state.ascii)for(const line of spans)for(const part of line)part.text=asciiText(part.text);
  for(let i=0;i<spans.length;i++)spans[i]=fitSpans(spans[i]!,columns);
  const lines=spans.slice(0,height).map(line=>truncate(line.map(part=>part.text).join(''),columns,state.ascii));
  return {lines,spans:spans.slice(0,height),rows,selectedLine:rows[state.cursor]?.selectable===false?undefined:bodyStart+selectedBody-viewportScroll,bodyStart,bodyHeight,numericTargets,rowRegions,tabRegions,sectionRegions:independent?sectionRegions:undefined,theme:state.monochrome?'mono':state.theme??'dark'};
}
