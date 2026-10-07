import type {DashboardSession,Message} from '../model/types.ts';
import type {ProcessView} from '../process/ownership.ts';
import type {UsageSummary} from '../metrics/usage-reducer.ts';
import type {GitSummary} from '../git/cache.ts';
import type {ReferenceCursor,RefSource} from '../content/refs.ts';
import type {ReferencePageCursor} from '../providers/reference-pages.ts';
import type {TextSpan,ThemeName,ColorRole} from './theme.ts';
export {defaultTabOrder as tabs} from '../config/tab-order.ts';
import {defaultTabOrder as tabs} from '../config/tab-order.ts';
export type Tab=typeof tabs[number];
export interface UiRef {id:string;target:string;messageId:string;line?:number;edited:boolean;exists?:boolean;kind?:string;source?:string;cursor?:ReferenceCursor;sources?:RefSource[];}
export interface UiTodo {id:string;text:string;messageId:string;checked:boolean;firstSeenAt?:number;latestMessageId?:string;repeated?:boolean;source?:string;}
export interface SessionView extends DashboardSession {resource?:ProcessView;usage?:UsageSummary;git?:GitSummary;refs?:UiRef[];refCoverage?:'session'|'partial'|'retained'|'unavailable';refUpdatedAt?:number;todos?:UiTodo[];todoStatus?:string;todoSourceMessageId?:string;todoReportedAt?:number;history?:{cpu:(number|undefined)[];memory:(string|undefined)[];peakMemoryBytes?:string;observedFrom?:number;observedTo?:number;windowMs?:number;points?:{at:number;gap?:boolean;cpuPercent?:number;cpuLowerBound?:number;memoryBytes?:string;}[];};}
export interface DashboardData {tabOrder?:Tab[];sessions:SessionView[];updatedAt:number;stale:boolean;diagnostics:string[];demo?:boolean;server?:import('../runtime/server.ts').ServerIdentity;}
export interface ReaderPosition {cursor:number;cursorId?:string;scroll:number;freeScroll?:boolean;detailViewId?:number;}
export interface MessageReader {lastIds:string[];following:boolean;newCount:number;initialized?:boolean;anchorId?:string;}
export interface ReferenceReader {refs:UiRef[];cursor?:ReferencePageCursor;hasMore:boolean;partial:boolean;observedAt:number;revision?:string;stale?:boolean;}
export interface ReferenceSourceReader {sessionKey:string;reference:UiRef;sources:RefSource[];cursor?:ReferencePageCursor;hasMore:boolean;partial:boolean;observedAt:number;revision?:string;stale?:boolean;}
export interface DetailField {label:string;value:string;role?:ColorRole;}
export interface DetailSection {id:string;title:string;fields?:DetailField[];text?:string;rows?:ScreenRow[];column?:0|1;}
export interface ProcessTarget {key:string;owner:string;pid:number;name:string;isHarness?:boolean;}
export interface DetailDocument {processTarget?:ProcessTarget;title:string;sections:DetailSection[];capturedAt?:number;help?:string;}
export interface NotesEditorState {sessionKey:string;title:string;text:string;cursor:number;editing:boolean;persisted?:boolean;status:'loading'|'saved'|'dirty'|'saving'|'error'|'conflict';savedAt?:number;error?:string;recoveryPath?:string;}
export interface UiState {boundSessionKey?:string;boundSessionPending?:boolean;readerSequence?:number;detailViewId?:number;helpViewId?:number;sectionReaders?:Map<string,ReaderPosition>;restrictAutomaticSelection?:boolean;tabOrder?:Tab[];processConfirmation?:{sessionKey:string;target:ProcessTarget};tab:Tab;selectedKey?:string;cursor:number;cursorId?:string;scroll:number;collapsed:Set<string>;expanded:Set<string>;filter:string;editingFilter:boolean;pin:boolean;subtree:boolean;ascii:boolean;monochrome:boolean;theme?:ThemeName;help:boolean;helpText?:string;helpReader?:ReaderPosition;detail?:string;detailDocument?:DetailDocument;detailStack?:{text:string;document?:DetailDocument;position:ReaderPosition}[];refParent?:{text:string;document?:DetailDocument;position:ReaderPosition};notes?:NotesEditorState;notesScroll?:number;notesFreeScroll?:boolean;numberPrefix:string;numberTargets:Map<number,string>;view:'lineage'|'worktrees';notice?:string;pagedMessages:Map<string,Message[]>;messageReaders:Map<string,MessageReader>;readers:Map<string,ReaderPosition>;detailReader?:ReaderPosition;readerKey?:string;followMessages:boolean;pagedRefs:Map<string,ReferenceReader>;refSources?:ReferenceSourceReader;sourceDetailReader?:ReaderPosition;}
export interface UiAction {type:'follow-bound'|'process-output'|'terminate-process'|'focus'|'select'|'tab'|'notes-edit'|'notes-save'|'open-ref'|'message'|'source'|'toggle-todo'|'copy'|'pin'|'scope'|'quit'|'settings'|'export'|'page-messages'|'page-refs'|'ref-sources';processTarget?:ProcessTarget;tab?:Tab;document?:DetailDocument;sessionKey?:string;id?:string;target?:string;line?:number;text?:string;beforeId?:string;referenceCursor?:ReferenceCursor;referencePageCursor?:ReferencePageCursor;restart?:boolean;}
export interface ScreenRow {continuations?:{text:string;role?:ColorRole}[];gapBefore?:number;band?:boolean;messageBand?:0|1;id:string;text:string;label?:string;value?:string;role?:ColorRole;section?:string;column?:0|1;help?:string;document?:DetailDocument;selectable?:boolean;action?:UiAction;sourceId?:string;copy?:string;disclosureColumn?:number;}
export interface RowRegion {index:number;x:number;y:number;width:number;display:string;disclosureX?:number;actionX?:number;}
export interface NavigationRegion {x:number;y:number;width:number;action:UiAction;}
export interface TabRegion {tab:Tab;x:number;y:number;width:number;}
export interface SectionRegion {id:string;x:number;y:number;width:number;height:number;scroll:number;total:number;indices:number[];lineIndices:number[];contentHeight:number;}
export interface RenderedScreen {sectionRegions?:SectionRegion[];lines:string[];spans?:TextSpan[][];rows:ScreenRow[];selectedLine?:number;bodyStart:number;bodyHeight:number;numericTargets:Map<number,string>;rowRegions?:RowRegion[];tabRegions?:TabRegion[];navigationRegions?:NavigationRegion[];terminalCursor?:{line:number;column:number};theme?:ThemeName;}

export function orderedTabs(state:Pick<UiState,'tabOrder'>):readonly Tab[]{return state.tabOrder??tabs;}
export function tabLabel(tab:Tab,compact:boolean):string{return compact?({Processes:'Procs',Messages:'Msgs'} as Partial<Record<Tab,string>>)[tab]??tab:tab;}
