import { requireState, record, list, text, integer, unique } from './state-codec-values';
import {
  USAGE_OUTCOMES,
  USAGE_PROVENANCES,
  validUsageCost,
  validUsageTokens,
} from './usage-validation';

/** Validate the persisted usage ledger before a registry, pricing policy or participant can act on it. */
export function validateUsageState(
  usage: unknown,
  byId: Map<unknown, Record<string, unknown>>,
  byTurn: Set<string>,
  conversationId: string,
  revision: number,
): void {
  const records = list(usage).map(record);
  unique(records.map((entry) => entry.callId));
  for (const entry of records) {
    requireState(
      text(entry.callId) &&
        text(entry.providerId) &&
        text(entry.modelId) &&
        entry.conversationId === conversationId &&
        text(entry.runId) &&
        text(entry.attemptId) &&
        integer(entry.revision, 1) &&
        entry.revision <= revision &&
        typeof entry.admitted === 'boolean',
    );
    const principal = record(entry.principal);
    requireState(
      (principal.kind === 'participant' &&
        text(principal.id) &&
        byId.has(principal.id) &&
        byId.get(principal.id)?.runtime !== null) ||
        (principal.kind === 'selector' && text(principal.id)),
    );
    requireState(entry.turnId === null || text(entry.turnId));
    requireState(entry.groupId === null || text(entry.groupId));
    requireState((entry.turnId === null) === (entry.groupId === null));
    requireState(principal.kind === 'selector' ? entry.turnId === null : true);
    if (principal.kind === 'participant' && entry.turnId !== null) {
      requireState(byTurn.has(`${entry.turnId}:${entry.groupId}:${principal.id}`));
    }
    if (entry.price !== null) {
      const price = record(entry.price);
      requireState(text(price.version));
      requireState(price.cost === null || validUsageCost(price.cost));
    }
    requireState(entry.status === 'reserved' || entry.status === 'settled');
    // Only a settled cache hit can exist without an admission; every other record reserved one.
    requireState(entry.admitted || (entry.status === 'settled' && entry.outcome === 'cache-hit'));
    if (entry.status === 'settled') {
      requireState(
        (USAGE_OUTCOMES as readonly string[]).includes(String(entry.outcome)) &&
          (USAGE_PROVENANCES as readonly string[]).includes(String(entry.provenance)) &&
          typeof entry.final === 'boolean',
      );
      requireState(entry.tokens === undefined || validUsageTokens(entry.tokens));
    } else {
      requireState(
        !Object.hasOwn(entry, 'outcome') &&
          !Object.hasOwn(entry, 'provenance') &&
          !Object.hasOwn(entry, 'final') &&
          !Object.hasOwn(entry, 'tokens') &&
          !Object.hasOwn(entry, 'raw'),
      );
    }
  }
}
