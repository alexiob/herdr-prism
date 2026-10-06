import type {DashboardSession,Message} from '../model/types.ts';
import type {ProcessView} from '../process/ownership.ts';
import type {UsageSummary} from '../metrics/usage-reducer.ts';
import type {GitSummary} from '../git/cache.ts';
export const tabs=['Overview','Agents','Processes','Messages','Refs','To-do'] as const;
export type Tab=typeof tabs[number];
export interface UiRef {id:string;target:string;messageId:string;line?:number;edited:boolean;exists?:boolean;kind?:string;source?:string;sources?:import('../content/refs.ts').RefSource[];}
export interface UiTodo {id:string;text:string;messageId:string;checked:boolean;firstSeenAt?:number;latestMessageId?:string;repeated?:boolean;source?:string;}
export interface SessionView extends DashboardSession {resource?:ProcessView;usage?:UsageSummary;git?:GitSummary;refs?:UiRef[];refCoverage?:'session'|'partial'|'retained'|'unavailable';refUpdatedAt?:number;todos?:UiTodo[];todoStatus?:string;todoSourceMessageId?:string;todoReportedAt?:number;history?:{cpu:(number|undefined)[];memory:(string|undefined)[];peakMemoryBytes?:string;observedFrom?:number;observedTo?:number;windowMs?:number;points?:{at:number;gap?:boolean;cpuPercent?:number;memoryBytes?:string;}[];};}
export interface DashboardData {sessions:SessionView[];updatedAt:number;stale:boolean;diagnostics:string[];demo?:boolean;server?:import('../runtime/server.ts').ServerIdentity;}
export interface ReaderPosition {cursor:number;cursorId?:string;scroll:number;}
export interface MessageReader {lastIds:string[];following:boolean;newCount:number;initialized?:boolean;anchorId?:string;}
export interface UiState {tab:Tab;selectedKey?:string;cursor:number;cursorId?:string;scroll:number;collapsed:Set<string>;expanded:Set<string>;filter:string;editingFilter:boolean;pin:boolean;subtree:boolean;ascii:boolean;monochrome:boolean;help:boolean;detail?:string;numberPrefix:string;numberTargets:Map<number,string>;view:'lineage'|'worktrees';notice?:string;pagedMessages:Map<string,Message[]>;messageReaders:Map<string,MessageReader>;readers:Map<string,ReaderPosition>;detailReader?:ReaderPosition;readerKey?:string;followMessages:boolean;}
export interface UiAction {type:'focus'|'select'|'open-ref'|'message'|'source'|'toggle-todo'|'copy'|'pin'|'scope'|'quit'|'settings'|'export'|'page-messages';sessionKey?:string;id?:string;target?:string;line?:number;text?:string;beforeId?:string;}
export interface ScreenRow {id:string;text:string;action?:UiAction;sourceId?:string;copy?:string;disclosureColumn?:number;}
export interface RenderedScreen {lines:string[];rows:ScreenRow[];selectedLine?:number;bodyStart:number;bodyHeight:number;numericTargets:Map<number,string>;}
