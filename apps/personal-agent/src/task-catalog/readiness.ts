/**
 * Whether the host can run a task now. The answer is a function of the definition's required
 * capabilities and effect ceiling and of the context the host hands in, and of nothing else: no
 * clock, no network, no stored state, and no word of the definition's or an offer's text, so a card
 * cannot claim more than the host verified. A task is ready when every capability it needs has a
 * usable verified binding within its ceiling; a capability with no binding the host could ever use is
 * unavailable, and one the person can still set up names the one step that is left.
 *
 * Each capability is judged on its own. Which account serves which, and the values a task asks for,
 * are settled when the person starts a task, not when the list is shown.
 */
import { effectExceeds, effectRank, isIssuedBinding } from './bindings.js';
import { READINESS_TEXT } from './readiness-text.js';

import type { TBindingSource } from './bindings.js';
import type { ITaskDefinition, TEffectCeiling, TReadiness, TSetupStep } from './types.js';

/** A verified binding the host cannot use yet, and the one thing that stands in the way. */
export type TBindingBlocker = { readonly capability: string; readonly effect: TEffectCeiling } & (
  | { readonly outcome: 'needs-setup'; readonly step: TSetupStep }
  | { readonly outcome: 'unavailable'; readonly reason: string }
);

/** What the host knows when it shows the list. */
export interface IReadinessContext {
  /** The bindings that can be used right now; a value only host code made counts. */
  readonly bindings: readonly TBindingSource[];
  /**
   * Verified bindings that cannot be used yet. A blocker can only hold a task back: it never makes
   * one ready.
   */
  readonly blockers: readonly TBindingBlocker[];
  /** The person's connectors by id and the title they gave each, to name an account in a step. */
  readonly accounts: readonly { readonly id: string; readonly title: string }[];
}

export const EMPTY_READINESS_CONTEXT: IReadinessContext = {
  bindings: [],
  blockers: [],
  accounts: [],
};

export function mergeReadinessContexts(...parts: readonly IReadinessContext[]): IReadinessContext {
  return {
    bindings: parts.flatMap((part) => part.bindings),
    blockers: parts.flatMap((part) => part.blockers),
    accounts: parts.flatMap((part) => part.accounts),
  };
}

type TVerdict =
  | { readonly kind: 'ready'; readonly access: string }
  | { readonly kind: 'setup'; readonly step: TSetupStep }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** The closest to ready first: a tool to allow, then a connector to sign in again, then a service to add. */
const STEP_ORDER: Readonly<Record<TSetupStep['type'], number>> = {
  'allow-tool': 0,
  reconnect: 1,
  connect: 2,
  'choose-account': 3,
};

const accountOf = (step: TSetupStep): string => ('connectorId' in step ? step.connectorId : '');

/** Code-unit order, so the answer does not depend on the machine's locale. */
const before = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The verified bindings the host issued for a capability, whatever they may do. */
const issuedFor = (capability: string, context: IReadinessContext): TBindingSource[] =>
  context.bindings.filter(
    (binding) => isIssuedBinding(binding) && binding.capability === capability,
  );

function judge(capability: string, ceiling: TEffectCeiling, context: IReadinessContext): TVerdict {
  const bound = issuedFor(capability, context);
  const held = context.blockers.filter((blocker) => blocker.capability === capability);
  if (bound.length === 0 && held.length === 0)
    return { kind: 'unavailable', reason: READINESS_TEXT.noBinding(capability) };
  const usable = bound.filter((binding) => !effectExceeds(binding.effect, ceiling));
  const waiting = held.filter((blocker) => !effectExceeds(blocker.effect, ceiling));
  if (usable.length === 0 && waiting.length === 0) {
    const lowest = [...bound, ...held]
      .map((entry) => entry.effect)
      .sort((a, b) => effectRank(a) - effectRank(b))[0]!;
    return {
      kind: 'unavailable',
      reason: READINESS_TEXT.aboveCeiling(capability, lowest, ceiling),
    };
  }
  if (usable.length > 0) {
    const accounts = [
      ...new Set(
        usable.flatMap((binding) => (binding.account === undefined ? [] : [binding.account])),
      ),
    ].sort();
    if (accounts.length > 1) {
      return {
        kind: 'setup',
        step: {
          type: 'choose-account',
          accounts: accounts.map((id) => ({
            id,
            title: context.accounts.find((account) => account.id === id)?.title ?? id,
          })),
        },
      };
    }
    return { kind: 'ready', access: usable[0]!.argumentBoundary };
  }
  const steps = waiting
    .flatMap((blocker) => (blocker.outcome === 'needs-setup' ? [blocker.step] : []))
    .sort((a, b) => STEP_ORDER[a.type] - STEP_ORDER[b.type] || before(accountOf(a), accountOf(b)));
  if (steps.length > 0) return { kind: 'setup', step: steps[0]! };
  const reason = waiting.flatMap((blocker) =>
    blocker.outcome === 'unavailable' ? [blocker.reason] : [],
  )[0]!;
  return { kind: 'unavailable', reason };
}

/**
 * The definition's readiness from the context. With several problems, unavailable comes before needs
 * setup, and among unavailable ones the first capability in the definition's order is the one named.
 */
export function readinessOf(definition: ITaskDefinition, context: IReadinessContext): TReadiness {
  const verdicts = definition.capabilities.map((capability) =>
    judge(capability, definition.effectCeiling, context),
  );
  const unavailable = verdicts.find(
    (verdict): verdict is Extract<TVerdict, { kind: 'unavailable' }> =>
      verdict.kind === 'unavailable',
  );
  if (unavailable !== undefined) return { state: 'unavailable', reason: unavailable.reason };
  const steps = new Map<string, TSetupStep>();
  for (const verdict of verdicts)
    if (verdict.kind === 'setup') steps.set(JSON.stringify(verdict.step), verdict.step);
  if (steps.size > 0) return { state: 'needs-setup', steps: [...steps.values()] };
  return {
    state: 'ready',
    accesses: [
      ...new Set(verdicts.flatMap((verdict) => (verdict.kind === 'ready' ? [verdict.access] : []))),
    ],
  };
}

/**
 * The verified bindings a task would run on: for each capability it needs, the ones the host issued that
 * stay within the task's effect ceiling. Read from the same context as `readinessOf`, so a launch records
 * exactly what its readiness was judged on.
 */
export function usableBindingsOf(
  definition: ITaskDefinition,
  context: IReadinessContext,
): readonly TBindingSource[] {
  return definition.capabilities.flatMap((capability) =>
    issuedFor(capability, context).filter(
      (binding) => !effectExceeds(binding.effect, definition.effectCeiling),
    ),
  );
}
