import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Duplex } from 'node:stream';
const mod = await import('../src/herdr/client.ts').catch(() => ({})) as any;

test('socket RPC correlates independent one-request replies', {skip:process.env.HAT_SOCKET_TESTS!=='1'}, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'hat-rpc-'));
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\hat-${process.pid}-${Date.now()}` : path.join(dir,'socket');
  const sockets=new Set<net.Socket>();const requests:{request:any;socket:net.Socket}[]=[];
  const server=net.createServer(socket=>{sockets.add(socket);let buffer='';socket.on('data',chunk=>{buffer+=chunk;const newline=buffer.indexOf('\n');if(newline<0)return;requests.push({request:JSON.parse(buffer.slice(0,newline)),socket});if(requests.length===2){assert.notEqual(requests[0]!.socket,requests[1]!.socket);requests[1]!.socket.end(JSON.stringify({id:requests[1]!.request.id,result:{answer:2}})+'\n');requests[0]!.socket.end(JSON.stringify({id:requests[0]!.request.id,result:{answer:1}})+'\n');}});});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});
  const client=new mod.HerdrClient(endpoint,{timeoutMs:1000});
  try{const[a,b]=await Promise.all([client.call('ping'),client.call('ping')]);assert.equal(a.answer,1);assert.equal(b.answer,2);}finally{client.close();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});
test('socket disconnect rejects pending requests', {skip:process.env.HAT_SOCKET_TESTS!=='1'}, async () => {
  assert.equal(typeof mod.HerdrClient,'function','RPC client missing');
  const dir=await mkdtemp(path.join(os.tmpdir(),'hat-close-'));
  const endpoint=process.platform==='win32'?`\\\\.\\pipe\\hat-close-${process.pid}-${Date.now()}`:path.join(dir,'socket');
  const server=net.createServer(s=>s.on('data',()=>s.destroy()));
  await new Promise<void>((r,j)=>{server.once('error',j);server.listen(endpoint,r);});
  const client=new mod.HerdrClient(endpoint,{timeoutMs:100});
  try {await assert.rejects(client.call('ping'),/closed|disconnect/);}
  finally {client.close();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});

function transport(reply:(requests:any[], socket:Duplex)=>void):()=>Duplex {
  return ()=>{
    let buffered='';const requests:any[]=[];
    const socket=new Duplex({read(){},write(data,_enc,callback){buffered+=data.toString();const lines=buffered.split('\n');buffered=lines.pop()!;for(const line of lines)requests.push(JSON.parse(line));reply(requests,socket);callback();}});
    queueMicrotask(()=>socket.emit('connect'));return socket;
  };
}
test('independent stream requests retain correlation and fragmented Unicode frames',async()=>{
 const pending:{request:any;socket:Duplex}[]=[];
 const client=new mod.HerdrClient('fixture',{timeoutMs:500,transportFactory:transport((requests,socket)=>{
   pending.push({request:requests[0],socket});if(pending.length!==2)return;
   pending[1]!.socket.push(JSON.stringify({id:pending[1]!.request.id,result:{answer:2}})+'\n');
   const line=JSON.stringify({id:pending[0]!.request.id,result:{answer:1,name:'日本語'}})+'\n';pending[0]!.socket.push(line.slice(0,-3));pending[0]!.socket.push(line.slice(-3));
 })});
 try{const[a,b]=await Promise.all([client.call('ping'),client.call('ping')]);assert.deepEqual([a.answer,b.answer],[1,2]);assert.equal(a.name,'日本語');}finally{client.close();}
});

test('subscription stream is independent and replacement keeps the old stream until latest acknowledgement',async()=>{
 const subscriptions:{request:any;socket:Duplex}[]=[];let ordinary=0;
 const client=new mod.HerdrClient('fixture',{timeoutMs:500,transportFactory:transport((requests,socket)=>{
   const request=requests[0];if(request.method==='events.subscribe'){subscriptions.push({request,socket});if(subscriptions.length===1)socket.push(JSON.stringify({id:request.id,result:{type:'subscription_started'}})+'\n');}
   else{ordinary++;assert.ok(!subscriptions.some(entry=>entry.socket===socket));socket.push(JSON.stringify({id:request.id,result:{type:'pong'}})+'\n');}
 })});
 let disconnected=0;const events:any[]=[];client.on('disconnected',()=>disconnected++);client.on('event',(event:any)=>events.push(event));
 try{
   await client.call('events.subscribe',{subscriptions:[]});await client.call('ping');assert.equal(ordinary,1);assert.equal(disconnected,0);
   const older=client.call('events.subscribe',{subscriptions:[]});const newer=client.call('events.subscribe',{subscriptions:[]});
   while(subscriptions.length<3)await new Promise(resolve=>setImmediate(resolve));
   assert.equal(subscriptions[0]!.socket.destroyed,false);subscriptions[0]!.socket.push(JSON.stringify({event:'pane_updated',data:{name:'日本語'}})+'\n');
   subscriptions[2]!.socket.push(JSON.stringify({id:subscriptions[2]!.request.id,result:{type:'subscription_started'}})+'\n');await newer;
   subscriptions[1]!.socket.push(JSON.stringify({id:subscriptions[1]!.request.id,result:{type:'subscription_started'}})+'\n');await older;
   assert.equal(subscriptions[0]!.socket.destroyed,true);assert.equal(subscriptions[1]!.socket.destroyed,true);assert.equal(subscriptions[2]!.socket.destroyed,false);assert.equal(disconnected,0);assert.equal(events[0].data.name,'日本語');
   const lost=new Promise(resolve=>client.once('disconnected',resolve));subscriptions[2]!.socket.destroy();await lost;assert.equal(disconnected,1);
 }finally{client.close();}
});
test('RPC disconnect rejects pending work and malformed envelopes cannot satisfy calls',async()=>{
  assert.equal(typeof mod.HerdrClient,'function','RPC client missing');
  const client=new mod.HerdrClient('stream',{timeoutMs:500,transportFactory:transport((_r,s)=>s.destroy())});
  try{await assert.rejects(client.call('ping'),/closed|disconnect/);}finally{client.close();}
  const bad=new mod.HerdrClient('stream',{timeoutMs:500,transportFactory:transport((_r,s)=>s.push('not-json\n'))});
  try{await assert.rejects(bad.call('ping'),/Malformed/);}finally{bad.close();}
});

test('ordinary Herdr calls use independent one-request connections without false subscription loss',async()=>{
 let connections=0,disconnected=0;
 const client=new mod.HerdrClient('one-request-fixture',{timeoutMs:100,transportFactory:()=>{connections++;let used=false;const s=new Duplex({read(){},write(data,_encoding,done){if(used){done(new Error('ordinary connection already consumed'));return;}used=true;const request=JSON.parse(data.toString());s.push(JSON.stringify({id:request.id,result:{type:'pong'}})+'\n');s.push(null);done();}});queueMicrotask(()=>s.emit('connect'));return s;}});
 client.on('disconnected',()=>disconnected++);
 try{assert.equal((await client.call('ping')).type,'pong');assert.equal((await client.call('ping')).type,'pong');assert.equal(connections,2);assert.equal(disconnected,0);}finally{client.close();}
});

test('Windows Herdr filesystem socket names map to its exact namespaced pipe contract',()=>{
 assert.equal(typeof mod.herdrTransportPath,'function');
 assert.equal(mod.herdrTransportPath('C:\\Users\\A B\\herdr\\sessions\\test\\herdr.sock','win32'),'\\\\.\\pipe\\C:\\Users\\A B\\herdr\\sessions\\test\\herdr.sock');
 assert.equal(mod.herdrTransportPath('\\\\.\\pipe\\existing-日本語','win32'),'\\\\.\\pipe\\existing-日本語');
 assert.equal(mod.herdrTransportPath('/tmp/herdr.sock','darwin'),'/tmp/herdr.sock');
});

test('the real RPC client sends width export and ratio requests while refusing malformed or unsupported layout methods before I/O',async()=>{
 const requests:any[]=[];
 const client=new mod.HerdrClient('width-fixture',{timeoutMs:500,transportFactory:transport((entries,socket)=>{const request=entries[0];requests.push(request);socket.push(JSON.stringify({id:request.id,result:{layout:{root:{type:'pane',pane_id:'native'}}}})+'\n');})});
 try{
  await client.call('layout.export',{pane_id:'panel'});await client.call('layout.set_split_ratio',{pane_id:'panel',path:[false],ratio:0.7});
  assert.deepEqual(requests.map(r=>[r.method,r.params]),[['layout.export',{pane_id:'panel'}],['layout.set_split_ratio',{pane_id:'panel',path:[false],ratio:0.7}]]);
  await assert.rejects(client.call('layout.export',{pane_id:3}),/expected/);
  await assert.rejects(client.call('layout.set_split_ratio',{pane_id:'panel',path:['left'],ratio:0.7}),/boolean/);
  await assert.rejects(client.call('layout.apply',{}),/Unsupported/);
  assert.equal(requests.length,2,'validation failures must not connect to the host');
 }finally{client.close();}
});
