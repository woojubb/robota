import type {
  IExternalEventSource,
  IExternalEventSourceOptions,
} from '@robota-sdk/agent-framework';
import type {
  IExternalEventGrant,
  TExternalEventAdmission,
  TExternalEventAuditRecord,
  TExternalEventRefusal,
  TExternalEventSettlementOutcome,
} from '@robota-sdk/agent-interface-transport';

/** What a grant has seen. Counts only: no principal, token, claim, content or address. */
export interface IExternalEventGrantCounters {
  readonly accepted: number;
  readonly refused: Partial<Record<TExternalEventRefusal, number>>;
  readonly settled: Partial<Record<TExternalEventSettlementOutcome, number>>;
}

export interface IExternalEventGrantRow {
  readonly grantId: string;
  /** Which kind of principal the grant pins; never its value. */
  readonly principal: 'subject' | 'client';
  readonly state: 'open' | 'revoked';
  readonly counters: IExternalEventGrantCounters;
}

export interface IExternalEventGrantHost {
  /** Deliver to the grant a carrier addressed; a label this session does not hold is refused. */
  receive(grantId: string, delivery: unknown): Promise<TExternalEventAdmission>;
  revoke(grantId: string): 'revoked' | 'unknown-grant';
  list(): readonly IExternalEventGrantRow[];
  close(): void;
}

export interface IExternalEventGrantSession {
  openExternalEventSource(options: IExternalEventSourceOptions): Promise<IExternalEventSource>;
}

/** A grant the session would not open; the start that asked for it fails. */
export class ExternalEventGrantRefusedError extends Error {
  constructor(readonly grantId: string) {
    super(`grant ${grantId}: refused by the session`);
    this.name = 'ExternalEventGrantRefusedError';
  }
}

interface IGrantEntry {
  readonly grant: IExternalEventGrant;
  readonly source: IExternalEventSource;
  revoked: boolean;
  accepted: number;
  readonly refused: Partial<Record<TExternalEventRefusal, number>>;
  readonly settled: Partial<Record<TExternalEventSettlementOutcome, number>>;
}

/**
 * Open every grant on the session, or none: a start that lost a grant is not a start. The session
 * builds each verifier from its own grant with the factory it was constructed with.
 */
export async function openExternalEventGrants(
  session: IExternalEventGrantSession,
  grants: readonly IExternalEventGrant[],
  options: {
    readonly audit?: (record: TExternalEventAuditRecord) => void;
  } = {},
): Promise<IExternalEventGrantHost> {
  const forward = (record: TExternalEventAuditRecord): void => {
    try {
      options.audit?.(record);
    } catch {
      // A reporting sink cannot change a decision.
    }
  };
  const entries = new Map<string, IGrantEntry>();
  const closeAll = (): void => {
    for (const entry of entries.values()) entry.source.close();
  };
  for (const grant of grants) {
    const counts = {
      refused: {} as Partial<Record<TExternalEventRefusal, number>>,
      settled: {} as Partial<Record<TExternalEventSettlementOutcome, number>>,
    };
    let source: IExternalEventSource;
    try {
      source = await session.openExternalEventSource({
        grant,
        audit: (record) => {
          if ('refusal' in record)
            counts.refused[record.refusal] = (counts.refused[record.refusal] ?? 0) + 1;
          else counts.settled[record.settlement] = (counts.settled[record.settlement] ?? 0) + 1;
          forward(record);
        },
      });
    } catch {
      closeAll();
      throw new ExternalEventGrantRefusedError(grant.grantId);
    }
    entries.set(grant.grantId, { grant, source, revoked: false, accepted: 0, ...counts });
  }
  return {
    receive: async (grantId, delivery) => {
      const entry = entries.get(grantId);
      if (entry === undefined) {
        forward({ at: new Date().toISOString(), refusal: 'unknown-grant' });
        return { admitted: false, refusal: 'unknown-grant' };
      }
      const receipt = await entry.source.receive(delivery);
      if (!receipt.admitted) return { admitted: false, refusal: receipt.refusal };
      entry.accepted += 1;
      return { admitted: true, turnId: receipt.turnId };
    },
    revoke: (grantId) => {
      const entry = entries.get(grantId);
      if (entry === undefined) return 'unknown-grant';
      entry.revoked = true;
      entry.source.revoke();
      return 'revoked';
    },
    list: () =>
      [...entries.values()].map((entry) => ({
        grantId: entry.grant.grantId,
        principal: (entry.grant.verifier.allowedSubjects?.length ?? 0) > 0 ? 'subject' : 'client',
        state: entry.revoked ? 'revoked' : 'open',
        counters: {
          accepted: entry.accepted,
          refused: { ...entry.refused },
          settled: { ...entry.settled },
        },
      })),
    close: closeAll,
  };
}
