import type {SessionView,UiState,ScreenRow,DetailDocument,DetailField,DetailSection} from './types.ts';
import type {AccountLimits} from '../metrics/account-limits.ts';
import {visibleAccountLimits} from '../metrics/account-limits.ts';
import {age,number} from './text.ts';
import {documentText,meter} from './widgets.ts';
const help='Account-wide quota reported for the selected session. Limits and credits can be shared by other sessions or devices; they are not this conversation’s token count or a bill. Values are recorded observations, not live balance queries. Reset times and window sizes come from the provider. Old observations disappear after 15 minutes; expired quota windows are omitted. Enter opens exact values and provenance; ? shows this explanation.';
const field=(label:string,value:unknown,role:DetailField['role']='quantity'):DetailField=>({label,value:value===undefined?'—':String(value),role});
const iso=(at?:number)=>at===undefined?'—':new Date(at).toISOString();
const windowName=(w:AccountLimits['windows'][number])=>w.windowMinutes===300?'5h':w.windowMinutes===10080?'7d':w.windowMinutes===undefined?w.label:w.windowMinutes%1440===0?`${w.windowMinutes/1440}d`:w.windowMinutes%60===0?`${w.windowMinutes/60}h`:`${w.windowMinutes}m`;
function countdown(at:number,now:number){const m=Math.max(0,Math.ceil((at-now)/60000));return m>=1440?`${Math.floor(m/1440)}d ${Math.floor(m%1440/60)}h`:m>=60?`${Math.floor(m/60)}h ${m%60}m`:`${m}m`;}
const compact=(v:string|number)=>new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(Number(v));
export function accountDocument(a:AccountLimits,now:number):DetailDocument{
 const sections:DetailSection[]=[{id:'account',title:'Account scope',fields:[field('Harness',a.provider,'identity'),field('Plan',a.plan,'identity'),field('Bucket',a.bucket,'identity'),field('Session',a.sessionId,'identity'),field('Reported',iso(a.observedAt),'duration'),field('Age',age(a.observedAt,now)+' ago','duration'),field('Source',a.source,'path')]},{id:'scope',title:'How to read this',column:1,text:help}];
 for(const w of a.windows)sections.push({id:'quota-'+w.id,title:windowName(w)+' quota',fields:[field('Used',number(w.usedPercent)+'%'),field('Window',w.windowMinutes===undefined?'Not reported':number(w.windowMinutes)+' minutes','duration'),field('Resets',iso(w.resetsAt),'duration'),field('Reset in',w.resetsAt===undefined?'Not reported':countdown(w.resetsAt,now),'duration')],column:0});
 if(a.credits)sections.push({id:'credits',title:'Credits',column:1,fields:[field('Balance',a.credits.balance),field('Unlimited',a.credits.unlimited===undefined?'Not reported':a.credits.unlimited?'Yes':'No','identity'),field('Has credits',a.credits.hasCredits===undefined?'Not reported':a.credits.hasCredits?'Yes':'No','identity')]});
 if(a.spend)sections.push({id:'spend',title:'Reported spend limit',column:1,fields:[field('Used USD',a.spend.usedUsd),field('Limit USD',a.spend.limitUsd),field('Period',a.spend.period,'identity')]});
 return {title:'Account / limits',sections,capturedAt:now,help};
}
export function accountRows(session:SessionView,state:UiState,now:number):ScreenRow[]{
 const a=visibleAccountLimits(session.evidence.accountLimits,session.evidence.provider,session.evidence.id,now);if(!a)return[];
 const document=accountDocument(a,now),rows:ScreenRow[]=[];
 const add=(id:string,label:string,value:string,role:ScreenRow['role']='quantity')=>rows.push({id:'account-'+id,text:label+': '+value,label,value,role,section:'Account / limits',column:0,document,help,action:{type:'message',text:documentText(document),document}});
 if(a.plan)add('plan','Plan',a.plan+(a.bucket?' · '+a.bucket:''),'identity');
 for(const w of a.windows)add('window-'+w.id,windowName(w),`${number(w.usedPercent)}% ${meter(w.usedPercent,6,state.ascii)}${w.resetsAt===undefined?'':' · '+countdown(w.resetsAt,now)}`,w.usedPercent>=95?'negative':w.usedPercent>=80?'warning':'quantity');
 if(a.credits){const c=a.credits;add('credits','Credits',c.unlimited===true?'Unlimited':c.balance!==undefined?compact(c.balance):c.hasCredits===false?'None reported':'Available');}
 if(a.spend)add('spend','Spend',`${a.spend.usedUsd===undefined?'—':'$'+number(a.spend.usedUsd)} / ${a.spend.limitUsd===undefined?'—':'$'+number(a.spend.limitUsd)}`);
 add('reported','Reported',age(a.observedAt,now)+' ago',now-a.observedAt>120000?'warning':'secondary');return rows;
}
