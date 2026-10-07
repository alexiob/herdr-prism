import {clean,object} from '../providers/common.ts';
export interface AccountWindow {id:string;label:string;usedPercent:number;windowMinutes?:number;resetsAt?:number;}
export interface AccountLimits {provider:'codex'|'claude';sessionId:string;observedAt:number;source:string;plan?:string;bucket?:string;windows:AccountWindow[];credits?:{balance?:string;unlimited?:boolean;hasCredits?:boolean};spend?:{usedUsd?:number;limitUsd?:number;period?:string};}
export const accountMaxAgeMs=15*60000;
const finite=(v:unknown,max=Number.MAX_SAFE_INTEGER):number|undefined=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:undefined;
const integer=(v:unknown,max=Number.MAX_SAFE_INTEGER)=>{const n=finite(v,max);return n!==undefined&&Number.isSafeInteger(n)?n:undefined;};
function reset(v:unknown){const seconds=integer(v,8640000000000);return seconds===undefined?undefined:seconds*1000;}
export function parseAccountLimits(provider:'codex'|'claude',sessionId:string,raw:unknown,observedAt:number,source:string):AccountLimits|undefined{
 if(!sessionId||sessionId.length>4096||/[\x00-\x1f]/.test(sessionId)||!Number.isSafeInteger(observedAt)||observedAt<0)return;
 const value=object(raw),windows:AccountWindow[]=[];
 const specs=provider==='codex'?[['primary','Primary'],['secondary','Secondary']]:[['five_hour','5h'],['seven_day','7d'],['spend_limit','Spend limit']];
 for(const [id,label] of specs){const item=object(value[id!]),usedPercent=finite(provider==='codex'?item.used_percent:item.used_percentage,100);if(usedPercent===undefined)continue;
  const minutes=provider==='codex'?integer(item.window_minutes,5256000):id==='five_hour'?300:id==='seven_day'?10080:undefined;
  windows.push({id:id!,label:label!,usedPercent,windowMinutes:minutes,resetsAt:reset(item.resets_at)});
 }
 let credits:AccountLimits['credits'];if(provider==='codex'){
  const c=object(value.credits),balance=typeof c.balance==='string'&&/^\d{1,30}(?:\.\d{1,20})?$/.test(c.balance)?c.balance:undefined;
  if(balance!==undefined||c.unlimited===true||typeof c.has_credits==='boolean')credits={balance,unlimited:typeof c.unlimited==='boolean'?c.unlimited:undefined,hasCredits:typeof c.has_credits==='boolean'?c.has_credits:undefined};
 }
 const s=object(value.spend_limit),usedUsd=finite(s.used_usd),limitUsd=finite(s.limit_usd),spend=provider==='claude'&&(usedUsd!==undefined||limitUsd!==undefined)?{usedUsd,limitUsd,period:clean(s.period,80)||undefined}:undefined;
 if(!windows.length&&!credits&&!spend)return;
 return {provider,sessionId,observedAt,source:clean(source,32768),plan:provider==='codex'?clean(value.plan_type,80)||undefined:undefined,bucket:provider==='codex'?clean(value.limit_name??value.limit_id,80)||undefined:undefined,windows,credits,spend};
}
export function visibleAccountLimits(account:AccountLimits|undefined,provider:string,sessionId:string,now:number):AccountLimits|undefined{
 if(!account||account.provider!==provider||account.sessionId!==sessionId||!Number.isSafeInteger(account.observedAt)||now-account.observedAt>accountMaxAgeMs||account.observedAt>now+60000)return;
 const windows=account.windows.filter(w=>w.resetsAt===undefined||w.resetsAt>now);
 return windows.length||account.credits||account.spend?{...account,windows}:undefined;
}
