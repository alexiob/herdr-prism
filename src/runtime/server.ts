import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';
import { StateStore } from '../state/store.ts';
import { sanitize, truncate } from '../tui/text.ts';

export interface ServerIdentity { id: string; host: string; session: string; }
export const serverIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Socket paths are local to one host; persisted random IDs also separate common hostnames. */
export async function loadServerIdentity(store: StateStore, labels: Partial<Omit<ServerIdentity, 'id'>> = {}): Promise<ServerIdentity> {
  const stored = await store.read<{ id: string }>('server-identity');
  if (stored !== undefined && (!stored || typeof stored.id !== 'string' || !serverIdPattern.test(stored.id)))
    throw new Error('Invalid persisted server identity');
  const id = stored?.id ?? randomUUID();
  if (!stored) await store.write('server-identity', { id });
  const label = (value: string) => truncate(sanitize(value).replace(/[\r\n\t]/g, ' '), 128);
  return { id, host: label(labels.host ?? hostname()), session: label(labels.session ?? process.env.HERDR_SESSION ?? 'default') };
}

/** Named Unix socket selection takes precedence over an inherited session environment. */
export function serverSession(endpoint?: string): string {
  if (endpoint && path.basename(endpoint) === 'herdr.sock') {
    const directory = path.dirname(endpoint);
    if (path.basename(path.dirname(directory)) === 'sessions') return path.basename(directory);
    if (path.basename(directory) === 'herdr') return 'default';
  }
  return process.env.HERDR_SESSION ?? 'default';
}
