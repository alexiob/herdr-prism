import { test } from 'node:test';
import assert from 'node:assert/strict';
const schema=await import('../src/herdr/schema.ts').catch(()=>({})) as any;
test('schema rejects fabricated tree methods and malformed native metadata requests',()=>{
  assert.equal(typeof schema.validateRequest,'function','schema validator missing');
  assert.throws(()=>schema.validateRequest('agent.tree.set',{}),/Unsupported/);
  assert.throws(()=>schema.validateRequest('pane.report_metadata',{pane_id:'p',source:'plugin:iob.herdr-prism',tokens:{'invalid.token':'a'}}),/pattern|property/);
  assert.throws(()=>schema.validateRequest('pane.report_metadata',{pane_id:'p',source:'plugin:iob.herdr-prism',tokens:Object.fromEntries(Array.from({length:17},(_,i)=>['hat_'+i,'x']))}),/maxProperties/);
  assert.throws(()=>schema.validateRequest('agent.focus',{pane_id:'p'}),/target/);
});
test('schema accepts verified view, right split and TTL metadata request contracts',()=>{
  assert.equal(typeof schema.validateRequest,'function','schema validator missing');
  schema.validateRequest('agent.focus',{target:'w1:p1'});
  schema.validateRequest('agent.view.set',{source:'plugin:iob.herdr-prism',sort:[{field:{token:'hat_rank'},order:'asc'}]});
  schema.validateRequest('plugin.pane.open',{plugin_id:'iob.herdr-prism',entrypoint:'inspector',placement:'split',direction:'right',target_pane_id:'w1:p1',focus:false});
  schema.validateRequest('pane.report_metadata',{pane_id:'w1:p1',source:'plugin:iob.herdr-prism',tokens:{hat_load:'100% 500MiB',hat_old:null},ttl_ms:15000,seq:1});
});

test('width restoration accepts only the pinned export and split-ratio request types',async()=>{
 const {readFile}=await import('node:fs/promises');
 const bundled=JSON.parse(await readFile(new URL('../src/herdr/protocol.json',import.meta.url),'utf8')),pinned=JSON.parse(await readFile(new URL('./fixtures/herdr/protocol-22.json',import.meta.url),'utf8'));
 for(const definition of ['LayoutExportParams','LayoutSetSplitRatioParams'])assert.deepEqual(bundled.schemas.request.$defs[definition],pinned.schemas.request.$defs[definition]);
 schema.validateRequest('layout.export',{pane_id:'w1:p1'});schema.validateRequest('layout.export',{tab_id:'w1:t1'});
 schema.validateRequest('layout.set_split_ratio',{pane_id:'w1:p1',path:[false,true],ratio:0.7});schema.validateRequest('layout.set_split_ratio',{tab_id:'w1:t1',path:[],ratio:0.5});
 assert.throws(()=>schema.validateRequest('layout.export',{pane_id:42}),/expected/);
 assert.throws(()=>schema.validateRequest('layout.set_split_ratio',{pane_id:'w1:p1',path:[0],ratio:0.7}),/boolean/);
 assert.throws(()=>schema.validateRequest('layout.set_split_ratio',{pane_id:'w1:p1',ratio:0.7}),/path/);
 assert.throws(()=>schema.validateRequest('layout.set_split_ratio',{pane_id:'w1:p1',path:[],ratio:NaN}),/finite/);
 assert.throws(()=>schema.validateRequest('layout.apply',{}),/Unsupported/,'supporting width changes must not enable replacing a whole native layout');
});

test('update focus restoration accepts the pinned generic terminal focus request',async()=>{
 const {readFile}=await import('node:fs/promises');
 const bundled=JSON.parse(await readFile(new URL('../src/herdr/protocol.json',import.meta.url),'utf8')),pinned=JSON.parse(await readFile(new URL('./fixtures/herdr/protocol-22.json',import.meta.url),'utf8'));
 assert.deepEqual(bundled.schemas.request.oneOf.find((value:any)=>value.properties.method.const==='pane.focus'),pinned.schemas.request.oneOf.find((value:any)=>value.properties.method.const==='pane.focus'));
 schema.validateRequest('pane.focus',{pane_id:'w1:p1'});
 assert.throws(()=>schema.validateRequest('pane.focus',{target:'w1:p1'}),/pane_id/);
});
