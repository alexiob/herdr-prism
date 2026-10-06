import{test}from'node:test';import assert from'node:assert/strict';
const input=await import('../src/tui/input.ts').catch(()=>({}))as any;
test('terminal input decodes split arrow, UTF8, mouse and Escape without leaking raw controls',()=>{
 assert.equal(typeof input.InputDecoder,'function','input decoder missing');const decoder=new input.InputDecoder();assert.deepEqual(decoder.feed('\x1b['),[]);assert.deepEqual(decoder.feed('A'),[{type:'key',key:'up'}]);
 const bytes=Buffer.from('é');assert.deepEqual(decoder.feed(bytes.subarray(0,1)),[]);assert.deepEqual(decoder.feed(bytes.subarray(1)),[{type:'key',key:'é'}]);
 assert.deepEqual(decoder.feed('\x1b[<0;12;8M'),[{type:'mouse',button:0,x:12,y:8,release:false}]);assert.deepEqual(decoder.feed('\t\x03'),[{type:'key',key:'tab'},{type:'key',key:'ctrl+c'}]);decoder.feed('\x1b');assert.deepEqual(decoder.flushEscape(),[{type:'key',key:'escape'}]);
});
