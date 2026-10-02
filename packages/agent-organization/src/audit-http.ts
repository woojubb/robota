import { OrganizationAuditAppendConflict } from './audit.js';
import type { IOrganizationAuditAnchor, IOrganizationAuditSink } from './audit.js';
import { organizationCanonical } from './canonical.js';
import { OrganizationRefused } from './types.js';

export interface IOrganizationAuditHttpEndpoint {
  /** Owner-selected service root. HTTPS, or literal loopback for private deployments. */
  readonly endpoint: string;
  /** Owner transport credential; it never enters a worker or an audit event. */
  readonly token: string;
}

function transport(options: IOrganizationAuditHttpEndpoint) {
  const url = new URL(options.endpoint);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    typeof options.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/u.test(options.token))
    throw new OrganizationRefused('invalid-schema');
  const token = options.token;
  return async (path: string, value: unknown, signal: AbortSignal, conflict = false): Promise<unknown> => {
    try {
      const response = await fetch(new URL(path, url), {
        method: 'POST', redirect: 'error', signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: organizationCanonical(value),
      });
      if (conflict && response.status === 409) {
        await response.body?.cancel();
        throw new OrganizationAuditAppendConflict();
      }
      if (!response.ok || response.body === null) {
        await response.body?.cancel();
        throw new OrganizationRefused('policy-unavailable');
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 1024 * 1024) throw new OrganizationRefused('policy-unavailable');
          chunks.push(next.value);
        }
      } finally { await reader.cancel(); }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
    } catch (error) {
      if (error instanceof OrganizationAuditAppendConflict) throw error;
      throw new OrganizationRefused('policy-unavailable');
    }
  };
}

/** Concrete owner transport. Signed checkpoint verification remains in OrganizationAudit. */
export function createOrganizationAuditHttpPorts(options: {
  readonly sink: IOrganizationAuditHttpEndpoint;
  readonly anchor: IOrganizationAuditHttpEndpoint;
}): { sink: IOrganizationAuditSink; anchor: IOrganizationAuditAnchor } {
  const sink = transport(options.sink);
  const anchor = transport(options.anchor);
  return {
    sink: {
      read: async (after, signal) => await sink('/read', after, signal) as Awaited<ReturnType<IOrganizationAuditSink['read']>>,
      append: async (expected, event, signal) => await sink('/append', { expected, event }, signal, true) as Awaited<ReturnType<IOrganizationAuditSink['append']>>,
    },
    anchor: {
      load: async (signal) => await anchor('/load', null, signal) as Awaited<ReturnType<IOrganizationAuditAnchor['load']>>,
      compareAndSet: async (expected, next, signal) => {
        const result = await anchor('/cas', { expected, next }, signal);
        if (typeof result !== 'boolean') throw new OrganizationRefused('policy-unavailable');
        return result;
      },
    },
  };
}
