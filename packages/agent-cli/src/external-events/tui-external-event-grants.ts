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
} from '@robota-sdk/agent-interface-transport';

export interface ITuiExternalEventGrants {
  /** Open the grants on a newly bound session, closing them on the one it replaces. */
  bind(session: IExternalEventGrantSession): Promise<void>;
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
  const revokedRow = (grant: IExternalEventGrant): IExternalEventGrantRow => ({
    grantId: grant.grantId,
    principal: (grant.verifier.allowedSubjects?.length ?? 0) > 0 ? 'subject' : 'client',
    state: 'revoked',
    counters: { accepted: 0, refused: {}, settled: {} },
  });
  return {
    bind: (session) => {
      const next = binding.then(async () => {
        host?.close();
        host = undefined;
        const opened = await openExternalEventGrants(
          session,
          grants.filter((grant) => !revoked.has(grant.grantId)),
          {
            // Refusals are reported by the carrier that answered them; the session reports how turns end.
            audit: (record) => {
              const line = 'settlement' in record ? describeExternalEventRecord(record) : undefined;
              if (line !== undefined) report(line);
            },
          },
        );
        // A revocation that arrived while the grants were opening still applies.
        for (const grantId of revoked) opened.revoke(grantId);
        host = opened;
      });
      binding = next.catch(() => undefined);
      return next;
    },
    receive: async (grantId, delivery) => {
      if (revoked.has(grantId)) return { admitted: false, refusal: 'grant-revoked' };
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
