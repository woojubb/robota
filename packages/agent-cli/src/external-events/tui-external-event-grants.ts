import {
  openExternalEventGrants,
  type IExternalEventGrantHost,
  type IExternalEventGrantRow,
  type IExternalEventGrantSession,
} from './external-event-grant-host.js';

import type { ICommandExternalEventsAdapter } from '@robota-sdk/agent-framework';
import type {
  IExternalEventDelivery,
  IExternalEventGrant,
  TExternalEventAdmission,
  TExternalEventAuditRecord,
  TExternalEventRefusal,
} from '@robota-sdk/agent-interface-transport';

export interface ITuiExternalEventGrants {
  /** Open the grants on a newly bound session, closing them on the one it replaces. */
  bind(session: IExternalEventGrantSession): Promise<void>;
  /** Count a carrier-decided refusal against the bound session's grant. */
  countRefusal(grantId: string, refusal: TExternalEventRefusal): void;
  /** Deliver to the currently bound session's grant. */
  receive(grantId: string, delivery: IExternalEventDelivery): Promise<TExternalEventAdmission>;
  readonly adapter: ICommandExternalEventsAdapter;
  close(): void;
}

/** One content-free line for a refusal or an unfinished turn; nothing for a completed one. */
export function describeExternalEventRecord(record: TExternalEventAuditRecord): string | undefined {
  const who =
    record.grantId === undefined ? 'External event' : `External event grant ${record.grantId}`;
  if ('refusal' in record) return `${who}: an event was refused (${record.refusal}).`;
  return record.settlement === 'completed'
    ? undefined
    : `${who}: a turn ended ${record.settlement}.`;
}

/** A refusal of one kind is reported at most once in this window; the rest are counted. */
const REFUSAL_REPORT_WINDOW_MS = 60_000;

/**
 * Report the endpoint's refusals without letting whoever reaches the public URL write to the owner's
 * terminal at will: one line per grant and reason per window, carrying how many more were refused since,
 * and nothing at all for a peer already over its failure budget.
 */
export function createRefusalReporter(
  report: (line: string) => void,
  now: () => number = Date.now,
): (record: TExternalEventAuditRecord) => void {
  const windows = new Map<string, { startedAt: number; suppressed: number }>();
  return (record) => {
    if (!('refusal' in record)) {
      const line = describeExternalEventRecord(record);
      if (line !== undefined) report(line);
      return;
    }
    const key = `${record.grantId ?? ''}\u0000${record.refusal}`;
    const at = now();
    const window = windows.get(key);
    if (
      record.throttled === true ||
      (window !== undefined && at - window.startedAt < REFUSAL_REPORT_WINDOW_MS)
    ) {
      if (window !== undefined) window.suppressed += 1;
      else windows.set(key, { startedAt: at - REFUSAL_REPORT_WINDOW_MS, suppressed: 1 });
      return;
    }
    const earlier = window?.suppressed ?? 0;
    windows.set(key, { startedAt: at, suppressed: 0 });
    const line = describeExternalEventRecord(record);
    if (line === undefined) return;
    report(earlier > 0 ? `${line} ${earlier} more were refused since the last report.` : line);
  };
}

/**
 * The TUI's grants follow its session: each switch reopens them on the new session. A grant the
 * owner revoked stays revoked for the life of this process.
 */
export function createTuiExternalEventGrants(
  grants: readonly IExternalEventGrant[],
  report: (line: string) => void,
): ITuiExternalEventGrants {
  const revoked = new Set<string>();
  let host: IExternalEventGrantHost | undefined;
  // One bind at a time, so two switches cannot both keep a host open.
  let binding: Promise<void> = Promise.resolve();
  let boundSession: IExternalEventGrantSession | undefined;
  const revokedRow = (grant: IExternalEventGrant): IExternalEventGrantRow => ({
    grantId: grant.grantId,
    principal: (grant.verifier.allowedSubjects?.length ?? 0) > 0 ? 'subject' : 'client',
    state: 'revoked',
    counters: { accepted: 0, refused: {}, settled: {} },
  });
  return {
    bind: (session) => {
      const next = binding.then(async () => {
        // The same session keeps its grants: its ingress remembers each revocation already.
        if (session === boundSession && host !== undefined) return;
        host?.close();
        host = undefined;
        boundSession = undefined;
        const opened = await openExternalEventGrants(session, grants, {
          // Refusals are reported by the carrier that answered them; the session reports how turns end.
          audit: (record) => {
            const line = 'settlement' in record ? describeExternalEventRecord(record) : undefined;
            if (line !== undefined) report(line);
          },
        });
        // A revocation that arrived while the grants were opening still applies.
        for (const grantId of revoked) opened.revoke(grantId);
        host = opened;
        boundSession = session;
      });
      binding = next.catch(() => undefined);
      return next;
    },
    countRefusal: (grantId, refusal) => host?.countRefusal(grantId, refusal),
    receive: async (grantId, delivery) => {
      // A revoked grant is still opened, revoked, on each bound session, so the session verifies the
      // token before it says the grant is revoked.
      await binding;
      if (host === undefined) return { admitted: false, refusal: 'session-unavailable' };
      return host.receive(grantId, delivery);
    },
    adapter: {
      list: () => {
        const open = new Map((host?.list() ?? []).map((row) => [row.grantId, row]));
        return grants.flatMap((grant) => {
          const row = open.get(grant.grantId);
          if (row !== undefined) return [row];
          return revoked.has(grant.grantId) ? [revokedRow(grant)] : [];
        });
      },
      revoke: (grantId) => {
        if (!grants.some((grant) => grant.grantId === grantId)) return 'unknown-grant';
        revoked.add(grantId);
        host?.revoke(grantId);
        return 'revoked';
      },
    },
    close: () => {
      host?.close();
      host = undefined;
    },
  };
}
