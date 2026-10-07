import {performance} from 'node:perf_hooks';
import {ProcessTracker} from '../src/process/ownership.ts';

const sessionCount=64,perSession=96,iterations=12;
const roots=Array.from({length:sessionCount},(_,index)=>({sessionKey:`fixture-${index}`,pid:index*perSession+1,startTime:'1'}));
const batch=tick=>({platform:'linux',bootId:'synthetic-benchmark',sampledAt:tick*1000,monotonicNs:String(BigInt(tick)*1000000000n),processes:Array.from({length:sessionCount*perSession},(_,index)=>({pid:index+1,ppid:index%perSession===0?0:index,startTime:String(index%perSession+1),cpuNs:String(BigInt(tick)*1000000n),rssBytes:'1048576',name:'synthetic-compiler'}))});
const tracker=new ProcessTracker(),times=[];
tracker.update(batch(1),roots);
for(let tick=2;tick<iterations+2;tick++){
 const data=batch(tick),before=performance.now();tracker.update(data,roots);const updated=performance.now();
 for(const root of roots){const view=tracker.view(root.sessionKey);if(view.coverage.total!==perSession||view.cpuPercent===undefined||view.memoryBytes!==String(BigInt(perSession)*1048576n))throw new Error('Benchmark attribution invariant failed');}
 const viewed=performance.now();times.push({updateMs:updated-before,allViewsMs:viewed-updated});
}
const summary=key=>{const sorted=times.map(time=>time[key]).sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]};};
process.stdout.write(JSON.stringify({schema:1,synthetic:true,sessions:sessionCount,processes:sessionCount*perSession,depth:perSession,iterations,node:process.version,platform:process.platform,arch:process.arch,updateMs:summary('updateMs'),allViewsMs:summary('allViewsMs')},null,2)+'\n');
