import { test } from 'node:test';
import assert from 'node:assert/strict';

const model = await import('../src/model/graph.ts').catch(() => ({})) as any;
const make = (id: string, parentId?: string) => ({ id, provider: 'codex', parentId, messages: [], usage: [], goals: [], tools: [], availability: 'known' });

test('lineage retains four nested levels and unresolved parents without guessing by cwd', () => {
  assert.equal(typeof model.buildForest, 'function', 'lineage implementation is missing');
  const result = model.buildForest([make('a'), make('b', 'a'), make('c', 'b'), make('d', 'c'), make('orphan', 'missing')]);
  assert.deepEqual(result.order.map((v: any) => [v.key, v.depth]), [['codex:a', 0], ['codex:b', 1], ['codex:c', 2], ['codex:d', 3], ['codex:orphan', 0]]);
  assert.equal(result.nodes.get('codex:orphan').parentIssue, 'unresolved');
});
test('cycles are diagnosed and every session appears exactly once', () => {
  assert.equal(typeof model.buildForest, 'function', 'lineage implementation is missing');
  const result = model.buildForest([make('a', 'b'), make('b', 'a')]);
  assert.equal(result.order.length, 2);
  assert.equal(new Set(result.order.map((v: any) => v.key)).size, 2);
  assert.ok(result.diagnostics.some((d: string) => d.includes('cycle')));
});
test('same raw session ID across providers does not merge', () => {
  assert.equal(typeof model.sessionKey, 'function', 'session identity implementation is missing');
  assert.notEqual(model.sessionKey('codex', 'same'), model.sessionKey('claude', 'same'));
});
test('deep lineage does not overflow the call stack or lose descendants',()=>{
  assert.equal(typeof model.buildForest,'function','lineage implementation is missing');
  const chain=Array.from({length:10000},(_,i)=>make(String(i),i?String(i-1):undefined));
  const result=model.buildForest(chain);assert.equal(result.order.length,10000);assert.equal(result.order.at(-1).depth,9999);
});
