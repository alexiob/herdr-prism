import {compareReferenceCursors} from '../content/refs.ts';
import type {RefSource} from '../content/refs.ts';
import type {ReferencePage,ReferenceSourcePage} from '../providers/reference-pages.ts';
import type {UiState,UiRef,SessionView} from './types.ts';
const sourceId=(source:RefSource)=>source.messageId+'\0'+(source.cursor?.hash??source.source??'');
export function visibleReferences(session:SessionView,state:UiState):UiRef[]{
 const paged=state.pagedRefs.get(session.key);if(paged&&paged.revision!==session.evidence.contentRevision)paged.stale=true;
 const refs=[...new Map([...(paged?.refs??[]),...(session.refs??[])].map(ref=>[ref.id,ref])).values()];return refs.sort((a,b)=>a.cursor&&b.cursor?compareReferenceCursors(b.cursor,a.cursor):0);
}
export function addReferencePage(state:UiState,key:string,page:ReferencePage,revision?:string):void {
 const previous=state.pagedRefs.get(key),old=previous&&previous.revision===revision&&!previous.stale?previous.refs:[];
 const refs=[...new Map([...old,...page.refs].map(ref=>{const sources=ref.sources??[];return[ref.id,{...ref,sources:sources.length>2?[sources[0]!,sources.at(-1)!]:sources}] as const;})).values()].slice(-500);
 let size=0;for(let i=refs.length-1;i>=0;i--){size+=Buffer.byteLength(JSON.stringify(refs[i]));if(size>4*1024*1024){refs.splice(0,i+1);break;}}
 state.pagedRefs.delete(key);state.pagedRefs.set(key,{refs,cursor:page.cursor,hasMore:page.hasMore,partial:page.partial,observedAt:page.observedAt,revision});while(state.pagedRefs.size>4)state.pagedRefs.delete(state.pagedRefs.keys().next().value!);
}
export function showReferenceSources(state:UiState,key:string,reference:UiRef,page:ReferenceSourcePage,revision?:string,append=false):void {
 const previous=state.refSources;
 if(!previous){const position={cursor:state.cursor,cursorId:state.cursorId,scroll:state.scroll};if(state.detail!==undefined){state.refParent={text:state.detail,document:state.detailDocument,position};state.detail=undefined;state.detailDocument=undefined;}else state.detailReader=position;}
 const old=append&&previous?.sessionKey===key&&previous.reference.id===reference.id&&!previous.stale&&previous.revision===revision?previous.sources:[];
 const sources=[...new Map([...old,...page.sources].map(source=>[sourceId(source),source])).values()].slice(-500);let size=0;for(let i=sources.length-1;i>=0;i--){size+=Buffer.byteLength(JSON.stringify(sources[i]));if(size>4*1024*1024){sources.splice(0,i+1);break;}}
 state.refSources={sessionKey:key,reference,sources,cursor:page.cursor,hasMore:page.hasMore,partial:page.partial,observedAt:page.observedAt,revision};state.help=false;
 if(!old.length){state.cursor=0;state.cursorId=undefined;state.scroll=0;}
}
