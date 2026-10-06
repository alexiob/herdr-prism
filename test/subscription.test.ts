import test from 'node:test';
import assert from 'node:assert/strict';
import {Duplex} from 'node:stream';
import {once} from 'node:events';
import {HerdrClient} from '../src/herdr/client.ts';
import {SnapshotCache} from '../src/herdr/subscription.ts';
const snapshot=(pane='one')=>({protocol:22,version:'fixture',agents:[{pane_id:pane,terminal_id:'term-'+pane}],panes:[],tabs:[],workspaces:[],layouts:[]});
const acknowledged=new WeakSet<Duplex>();
const answer=(socket:Duplex,request:any,result:any)=>{if(request.method==='events.subscribe')acknowledged.add(socket);socket.push(JSON.stringify({id:request.id,result})+'\n');};
function transport(handler:(request:any,socket:Duplex,generation:number)=>void){let generation=0;const sockets:Duplex[]=[],subscriptions:Duplex[]=[];const factory=()=>{let buffer='',requests=0;const current=++generation;const socket=new Duplex({read(){},write(data,_encoding,done){buffer+=data;const lines=buffer.split('\n');buffer=lines.pop()!;for(const line of lines){if(++requests>1){socket.destroy(new Error('Herdr accepts one request per connection'));break;}const request=JSON.parse(line);if(request.method==='events.subscribe')subscriptions.push(socket);handler(request,socket,current);}done();}});sockets.push(socket);queueMicrotask(()=>socket.emit('connect'));return socket;};return{factory,sockets,eventSocket(){const socket=subscriptions.slice().reverse().find(s=>acknowledged.has(s)&&!s.destroyed);assert.ok(socket,'an acknowledged event stream must exist');return socket;}};}
async function fixture(t:any,handler:(request:any,socket:Duplex,generation:number)=>void){const wire=transport(handler);const client=new HerdrClient('subscription-fixture',{transportFactory:wire.factory,timeoutMs:1000});const cache=new SnapshotCache(client);t.after(()=>{cache.close();client.close();});return{...wire,client,cache};}

test('subscription precedes snapshot and an event during its read yields the latest complete snapshot',async t=>{
 const calls:string[]=[];let first:any,reads=0;const f=await fixture(t,(request,socket)=>{calls.push(request.method);if(request.method==='events.subscribe')answer(socket,request,{});else if(++reads===1)first={request,socket};else answer(socket,request,{snapshot:snapshot('latest')});});
 const emitted:any[]=[];f.cache.on('snapshot',value=>emitted.push(value));const started=f.cache.start();
 while(!first)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls[0],'events.subscribe');f.eventSocket().push(JSON.stringify({event:'pane_updated',data:{pane_id:'latest'}})+'\n');answer(first.socket,first.request,{snapshot:snapshot('old')});
 assert.equal((await started).agents[0].pane_id,'latest');assert.equal(f.cache.snapshot?.agents[0].pane_id,'latest');assert.equal(emitted.length,1);assert.ok(reads>=2);
});

test('events_lost marks stale immediately and resubscribes before publishing recovered snapshot',async t=>{
 const calls:string[]=[];let hold=false,pending:any;const f=await fixture(t,(request,socket)=>{calls.push(request.method);if(hold&&request.method==='events.subscribe'){pending={request,socket};return;}answer(socket,request,request.method==='session.snapshot'?{snapshot:snapshot(hold?'recovered':'initial')}:{});});
 await f.cache.start();hold=true;const before=calls.length;f.eventSocket().push(JSON.stringify({event:'events_lost'})+'\n');assert.equal(f.cache.stale,true,'lost events invalidate freshness before async recovery');
 while(!pending)await new Promise(resolve=>setImmediate(resolve));hold=false;const updated=once(f.cache,'snapshot');answer(pending.socket,pending.request,{});await updated;assert.equal(calls[before],'events.subscribe');assert.equal(f.cache.stale,false);
});

test('disconnect reconnects through subscription and refresh, then close removes listeners and queued recovery',async t=>{
 const calls:{method:string,generation:number}[]=[];let generation=1;const f=await fixture(t,(request,socket)=>{calls.push({method:request.method,generation});answer(socket,request,request.method==='session.snapshot'?{snapshot:snapshot('generation-'+generation)}:{});});
 await f.cache.start();const stale=once(f.cache,'stale'),updated=once(f.cache,'snapshot');generation=2;f.eventSocket().destroy();await stale;assert.equal(f.cache.stale,true);await updated;assert.equal(f.cache.snapshot?.agents[0].pane_id,'generation-2');assert.equal(calls.find(c=>c.generation===2)?.method,'events.subscribe');
 const disconnected=once(f.client,'disconnected');f.eventSocket().destroy();await disconnected;f.cache.close();assert.equal(f.client.listenerCount('event'),0);assert.equal(f.client.listenerCount('disconnected'),0);const count=calls.length;await new Promise(resolve=>setTimeout(resolve,350));assert.equal(calls.length,count);
});

test('close during initial subscription prevents snapshot requests and late interval startup',async t=>{
 let pending:any;const calls:string[]=[];const f=await fixture(t,(request,socket)=>{calls.push(request.method);if(request.method==='events.subscribe')pending={request,socket};else answer(socket,request,{snapshot:snapshot()});});
 const started=f.cache.start();const rejected=assert.rejects(started,/closed|stopped/);while(!pending)await new Promise(resolve=>setImmediate(resolve));f.cache.close();answer(pending.socket,pending.request,{});await rejected;assert.deepEqual(calls,['events.subscribe']);assert.equal(f.client.listenerCount('event'),0);await assert.rejects(f.cache.start(),/closed|stopped/);
});

test('an explicit refresh immediately after disconnect cannot read before the replacement connection subscribes',async t=>{
 const calls:{method:string,generation:number}[]=[];let generation=1;const f=await fixture(t,(request,socket)=>{calls.push({method:request.method,generation});answer(socket,request,request.method==='session.snapshot'?{snapshot:snapshot('generation-'+generation)}:{});});await f.cache.start();const disconnected=once(f.client,'disconnected');generation=2;f.eventSocket().destroy();await disconnected;await f.cache.refresh();assert.equal(calls.find(c=>c.generation===2)?.method,'events.subscribe');
});

test('events lost during agent subscription cannot let its old acknowledgement suppress renewed status subscriptions',async t=>{
 const subscriptions:any[]=[];let pending:any;const f=await fixture(t,(request,socket)=>{if(request.method==='events.subscribe'){subscriptions.push(request.params.subscriptions);if(subscriptions.length===2){pending={request,socket};return;}answer(socket,request,{});}else answer(socket,request,{snapshot:snapshot()});});const started=f.cache.start();while(!pending)await new Promise(resolve=>setImmediate(resolve));f.eventSocket().push(JSON.stringify({event:'events_lost'})+'\n');while(subscriptions.length<3)await new Promise(resolve=>setImmediate(resolve));answer(pending.socket,pending.request,{});await started;assert.ok(subscriptions.at(-1).some((entry:any)=>entry.type==='pane.agent_status_changed'&&entry.pane_id==='one'),'status subscription must be renewed after the lost-event boundary');
});

test('a failed event-driven refresh announces stale state and retains the last valid snapshot',async t=>{
 let invalid=false;const f=await fixture(t,(request,socket)=>answer(socket,request,request.method==='session.snapshot'?{snapshot:invalid?{agents:[]}:snapshot()}:{}));await f.cache.start();const staleStates:boolean[]=[];f.cache.on('stale',()=>staleStates.push(f.cache.stale));const diagnostic=once(f.cache,'diagnostic');invalid=true;f.eventSocket().push(JSON.stringify({event:'pane_updated'})+'\n');await diagnostic;assert.equal(f.cache.stale,true);assert.deepEqual(staleStates,[true],'consumers must stop live visibility work when snapshot validation fails');assert.equal(f.cache.snapshot?.agents[0].pane_id,'one');
});
