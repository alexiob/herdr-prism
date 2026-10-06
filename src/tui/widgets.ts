import {cellWidth,sanitize,truncate,wrap} from './text.ts';
import type {ColorRole,TextSpan} from './theme.ts';
export const span=(text:string,role:ColorRole='text',selected=false):TextSpan=>({text:sanitize(text),role,selected});
export const pad=(text:string,width:number)=>text+' '.repeat(Math.max(0,width-cellWidth(text)));
export function asciiText(text:string):string{return text.replace(/[┌┐└┘├┤]/g,'+').replace(/[─▱]/g,'-').replace(/│/g,'|').replace(/→/g,'>').replace(/←/g,'<').replace(/[▾]/g,'v').replace(/[▸›]/g,'>').replace(/●/g,'*').replace(/·/g,'.').replace(/✎/g,'*').replace(/↑/g,'^').replace(/↓/g,'v').replace(/—/g,'-').replace(/[▁▂▃▄▅▆▇█▰]/g,'#');}
export function summary(input:string,width:number):string {
  width=Math.max(0,width);const text=sanitize(input).replace(/[\r\n\t]/g,' ');
  if(cellWidth(text)<=width)return text;
  const fit=wrap(text,width,1)[0]??'',word=fit.lastIndexOf(' ');
  return word>Math.min(8,width/3)?fit.slice(0,word).trimEnd():truncate(text,width);
}
export function readableWrap(input:string,width:number):string[]{
  width=Math.max(1,width);const lines:string[]=[];
  for(const raw of sanitize(input).replace(/\r/g,'').split('\n')){
    let rest=raw.replace(/\t/g,'    ');if(!rest){lines.push('');continue;}
    while(cellWidth(rest)>width){const fit=wrap(rest,width,1)[0]!,space=fit.lastIndexOf(' '),separator=Math.max(fit.lastIndexOf('/'),fit.lastIndexOf('\\'));const cut=space>0?space:separator>0?separator+1:fit.length;lines.push(rest.slice(0,cut).trimEnd());rest=rest.slice(cut).replace(/^ +/,'');}
    lines.push(rest);
  }
  return lines;
}
export function valueSpans(value:string,role:ColorRole='text',selected=false):TextSpan[]{
  if(/^(?:unavailable|—)/i.test(value.trim()))return [span(value,'warning',selected)];
  return value.split(/(MiB\b|GiB\b|KiB\b|\b(?:tokens|lines|files|commits|seconds|minutes)\b|\+\d+|-\d+)/g).filter(Boolean).map(part=>span(part,/^(?:tokens|MiB|GiB|KiB|lines|files|commits|seconds|minutes)$/.test(part)?'secondary':/^\+\d+$/.test(part)?'positive':/^-\d+$/.test(part)?'negative':role,selected));
}
export function meter(percent?:number,width=10,ascii=false):string{if(percent===undefined||!Number.isFinite(percent)||percent<0)return '—';const n=Math.round(Math.min(100,percent)*width/100);return (ascii?'#':'▰').repeat(n)+(ascii?'-':'▱').repeat(width-n);}
export function documentText(doc:import('./types.ts').DetailDocument):string{return [doc.title,...doc.sections.flatMap(section=>[section.title,...(section.fields??[]).map(field=>`${field.label}: ${field.value}`),section.text??''])].join('\n');}

/** Bound styled output itself, including tiny terminals and wide graphemes. */
export function fitSpans(parts:TextSpan[],width:number):TextSpan[]{
 const result:TextSpan[]=[];let used=0;const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
 for(const part of parts){let text='';for(const {segment}of segmenter.segment(part.text)){const size=cellWidth(segment);if(used+size>width)return [...result,...(text?[{...part,text}]:[])];text+=segment;used+=size;}if(text)result.push({...part,text});}return result;
}
