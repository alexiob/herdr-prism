import {tabs} from '../src/tui/types.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { freshPrivateDirectory } from './helpers/private-dir.ts';
import { StateStore } from '../src/state/store.ts';
import { NativePublisher } from '../src/native/publisher.ts';
import { nativeRows } from '../src/config/index.ts';
import { createUiState, renderScreen } from '../src/tui/screen.ts';
import { diagnosticExport } from '../src/tui/export.ts';

test('server identity survives reconnect and separates identical endpoint paths on different hosts', async t => {
  const { loadServerIdentity } = await import('../src/runtime/server.ts');
  const dir = await freshPrivateDirectory(join(tmpdir(), 'prism-servers-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const one = new StateStore(join(dir, 'one')), two = new StateStore(join(dir, 'two'));
  const a = await loadServerIdentity(one, { host: 'builder', session: 'work' });
  assert.deepEqual(await loadServerIdentity(one, { host: 'builder', session: 'work' }), a);
  const b = await loadServerIdentity(two, { host: 'builder', session: 'work' });
  assert.notEqual(a.id, b.id, 'common hostnames/socket paths must not identify two servers as one');
  assert.equal(a.host, 'builder'); assert.equal(a.session, 'work');
  await one.write('server-identity', { id: 'invalid\u001bidentity' });
  await assert.rejects(loadServerIdentity(one), /identity/);
});

test('combined native ranks keep server trees contiguous despite colliding pane IDs and ordinals', async () => {
  const reports: any[] = [];
  const session = (id: string): any => ({ key: id, depth: 0, children: [], evidence: { id, provider: 'pi', messages: [], tools: [], usage: [], goals: [] }, attachment: { pane_id: id, terminal_id: id, tokens: {} } });
  const rpc = { call: async (method: string, params: any): Promise<any> => { if (method === 'pane.get') return { pane: { terminal_id: params.pane_id, tokens: {} } }; if (method === 'pane.report_metadata') reports.push(params); return {}; } };
  const a = new NativePublisher(rpc), b = new NativePublisher(rpc);
  a.setServerIdentity('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
  b.setServerIdentity('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
  await a.publish([session('p1'), session('p2')]);
  await b.publish([session('p1'), session('p2')]);
  const combined = [reports[0], reports[2], reports[1], reports[3]].sort((x, y) => x.tokens.hat_rank.localeCompare(y.tokens.hat_rank));
  assert.deepEqual(combined.map(r => r.tokens.hat_rank), reports.map(r => r.tokens.hat_rank));
  assert.equal(new Set(reports.map(r => r.tokens.hat_rank)).size, 4);
  assert.ok(reports.every(r => r.tokens.hat_index === ''), 'combined host focus indices remain Herdr-owned');
  assert.ok(nativeRows().flat().includes('machine'), 'custom rows must retain client-assigned machine labels');
});

test('every dashboard view identifies its server while diagnostics redact the hostname and identity', () => {
  const state = createUiState();
  const data: any = { sessions: [], updatedAt: 0, stale: false, diagnostics: [], server: { id: 'private-id', host: 'remote-builder', session: 'work' } };
  for (const tab of tabs) {
    state.tab = tab;
    const frame=renderScreen(data,state,80,24);assert.match(frame.lines.slice(0,frame.bodyStart).join('\n'), /remote-builder\/work/);
  }
  assert.ok(!diagnosticExport(data).includes('remote-builder'));
  assert.ok(!diagnosticExport(data).includes('private-id'));
});

test('explicit Herdr clipboard writes encode terminal controls as data for client forwarding', async () => {
  const { clipboardSequence } = await import('../src/tui/platform.ts');
  const text = 'remote file\n\u001b]52;c;malicious\u0007 📄';
  const sequence = clipboardSequence(text);
  assert.match(sequence, /^\u001b\]52;c;[A-Za-z0-9+/=]*\u0007$/);
  assert.equal(Buffer.from(sequence.slice(7, -1), 'base64').toString('utf8'), text);
  assert.throws(() => clipboardSequence('x'.repeat(1024 * 1024 + 1)), /limit/);
});
