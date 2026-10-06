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
