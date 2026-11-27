import { requireState, record, list, text, integer, unique } from './state-codec-values';
import type { StoredBudget } from './usage-budget';
import {
  USAGE_OUTCOMES,
  USAGE_PROVENANCES,
  validBudgetCost,
  validModelCallBound,
  validUsageAmount,
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
  budget: StoredBudget | null,
): void {
  const currency = budget?.cost?.currency ?? null;
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
      // Under a cost budget every stored price is one the budget can add.
      if (currency !== null && price.cost !== null)
        requireState(validBudgetCost(price.cost, currency));
    }
    requireState(entry.bound === undefined || validModelCallBound(entry.bound));
    // Only admission under a budget reserves anything, so no budget means nothing to set aside or settle.
    requireState(Object.hasOwn(entry, 'reservation') && Object.hasOwn(entry, 'reconciled'));
    requireState((entry.reservation !== null) === (budget !== null && entry.admitted === true));
    if (entry.reservation !== null) {
      const { provenance, ...amount } = record(entry.reservation);
      requireState(
        (provenance === 'declared' || provenance === 'estimated') &&
          validUsageAmount(amount, currency),
      );
    }
    if (entry.reservation !== null) {
      // A declared reservation is the call's own bound; an estimate exists only where the budget allows one.
      const { provenance } = record(entry.reservation);
      requireState(
        provenance === 'declared' ? entry.bound !== undefined : budget?.mode === 'estimated',
      );
    }
    requireState(
      entry.reconciled === null ||
        (budget !== null &&
          entry.admitted === true &&
          validUsageAmount(entry.reconciled, currency)),
    );
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
