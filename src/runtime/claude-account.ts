import {object,identity} from '../providers/common.ts';
import {parseAccountLimits} from '../metrics/account-limits.ts';
import {StateStore,identityName,processIsAbsent} from '../state/store.ts';
import {MailboxClient} from '../state/mailbox.ts';
import {acquireAdmission} from './admission.ts';
import path from 'node:path';
/** Forward an allowlist only. Never spool the full status-line input or credentials. */
export function claudeAccountPayload(input:unknown,now=Date.now()):{sessionId:string;rateLimits:Record<string,unknown>|null}|undefined{
 const value=object(input),sessionId=identity(value.session_id);if(!sessionId)return;
 const a=parseAccountLimits('claude',sessionId,value.rate_limits,now,'Claude status line');if(!a)return{sessionId,rateLimits:null};
 const rateLimits:Record<string,unknown>={};
 for(const w of a.windows)rateLimits[w.id]={used_percentage:w.usedPercent,...(w.resetsAt===undefined?{}:{resets_at:w.resetsAt/1000})};
 if(a.spend)rateLimits.spend_limit={...object(rateLimits.spend_limit),used_usd:a.spend.usedUsd,limit_usd:a.spend.limitUsd,period:a.spend.period};
 return {sessionId,rateLimits};
}
export async function submitClaudeAccount(stateDir:string,endpoint:string,input:unknown):Promise<boolean>{
 const payload=claudeAccountPayload(input);if(!payload||!stateDir||!endpoint)return false;
 // Admission never creates directories and serializes with complete uninstall.
 const admission=await acquireAdmission(stateDir,{timeoutMs:1000});
 try{const dir=path.join(stateDir,'servers',identityName(endpoint)),marker=await new StateStore(dir).read<{token:string;pid:number;endpoint:string;kind:string}>('controller');
  if(!marker||marker.kind!=='collector-service'||marker.endpoint!==endpoint||typeof marker.token!=='string'||!marker.token||marker.token.length>128||!Number.isSafeInteger(marker.pid)||marker.pid<1||processIsAbsent(marker.pid))return false;
  const reply=await new MailboxClient(dir,marker.token,1000).request('account-report',payload);return reply.accepted===true;
 }finally{await admission.release();}
}
