import type {DashboardData,SessionView} from './types.ts';
import {cellWidth,truncate} from './text.ts';
/** Human label; exact session IDs remain available in identity details. */
export function sessionName(session?:SessionView):string {
 if(!session)return 'Agent unavailable';
 const title=truncate(session.evidence.title??'',Infinity).trim();
 const opaque=/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{16,}|pane-.+)$/i;
 if(title&&(title!==session.evidence.id||!opaque.test(title)))return title;
 const attachment=session.attachment??session.attachments?.[0];
 if(attachment?.name?.trim())return truncate(attachment.name,Infinity).trim();
 const provider=session.evidence.provider,kind=session.parentKey||session.evidence.parentId?'worker':'session';
 return `${provider.charAt(0).toUpperCase()+provider.slice(1)} ${kind}`;
}

export interface BreadcrumbPart {key?:string;label:string;}
/** Only claim ancestry proven by the recorded parent chain. */
export function breadcrumbPath(data:DashboardData,ownerKey:string|undefined,key:string|undefined):BreadcrumbPart[]{
 if(!key)return[{label:'Agent unavailable'}];
 const nodes=new Map(data.sessions.map(session=>[session.key,session])),path:BreadcrumbPart[]=[],seen=new Set<string>();let cursor:string|undefined=key;
 while(cursor&&!seen.has(cursor)){
  seen.add(cursor);const session=nodes.get(cursor);path.push({key:cursor,label:sessionName(session)});
  if(cursor===ownerKey)return path.reverse();
  if(!session){break;}cursor=session.parentKey;
 }
 if(!ownerKey&&!cursor)return path.reverse();
 const current=path[0]??{label:'Agent unavailable'};
 return ownerKey&&key!==ownerKey?[{key:ownerKey,label:sessionName(nodes.get(ownerKey))},{label:'…'},current]:[current];
}
/** Preserve the current location; compact older ancestors before the leaf. */
export function fitBreadcrumb(path:BreadcrumbPart[],width:number):BreadcrumbPart[]{
 if(width<=0)return[];let visible=path.map(part=>({...part,label:truncate(part.label,Infinity)}));const leaf=visible.at(-1)??{label:'Agent unavailable'};
 const length=(parts:BreadcrumbPart[])=>parts.reduce((sum,p)=>sum+cellWidth(p.label),0)+Math.max(0,parts.length-1)*3;
 if(length(visible)<=width)return visible;
 const minimum=(parts:BreadcrumbPart[])=>parts.reduce((sum,p)=>sum+Math.min(8,cellWidth(p.label)),0)+Math.max(0,parts.length-1)*3;
 if(visible.length>2&&minimum(visible)>width)visible=[visible[0]!,{label:'…'},leaf];
 const separator=Math.max(0,visible.length-1)*3,available=width-separator;
 if(available<Math.min(8,cellWidth(leaf.label))+visible.length-1){return width>=8?[{label:'…'},{...leaf,label:truncate(leaf.label,width-4)}]:[{...leaf,label:truncate(leaf.label,width)}];}
 const ancestorWidth=visible.slice(0,-1).reduce((sum,part)=>sum+Math.min(8,cellWidth(part.label)),0);
 const widths=visible.map((part,index)=>index===visible.length-1?Math.min(cellWidth(part.label),Math.max(Math.min(8,cellWidth(part.label)),available-ancestorWidth)):Math.min(8,cellWidth(part.label)));
 let excess=widths.reduce((sum,n)=>sum+n,0)-available;
 for(let i=widths.length-2;i>=0&&excess>0;i--){const remove=Math.min(excess,widths[i]!-1);widths[i]!-=remove;excess-=remove;}
 let spare=available-widths.reduce((sum,n)=>sum+n,0);
 for(let i=0;i<widths.length-1&&spare>0;i++){const add=Math.min(spare,cellWidth(visible[i]!.label)-widths[i]!);widths[i]!+=add;spare-=add;}
 return visible.map((part,index)=>({...part,label:truncate(part.label,widths[index]!)}));
}
