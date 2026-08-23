/**
 * SELFHOST-005 — guardrail hook executor.
 *
 * A registered `IHookTypeExecutor` (`type: 'guardrail'`) that fans out the registered guardrail SET in
 * PARALLEL and FAILS FAST: the first guardrail that returns `pass: false` (or throws — fail-safe) maps
 * onto the `deny` outcome `runHooks` understands (SEC-015; formerly exit code 2), so a guardrail block flows
 * through the SAME `runHooks` → `runPreToolHook` → `PermissionEnforcer` denial path hooks already use —
 * no new runner, no second turn-blocking mechanism. Parallelism lives INSIDE the executor; the guardrail
 * SET runs concurrently while the turn still carries exactly one block decision.
 *
 * The guardrail functions (the POLICY) are the consumer's, injected at construction (registered in
 * `agent-framework`); this executor is pure neutral mechanism.
 */

import type {
  THookOutcome,
  IHookInput,
  IHookTypeExecutor,
  THookDefinition,
  TGuardrail,
} from '../types.js';

/** Internal: a guardrail failure carried out of the parallel race so the first one blocks. */
class GuardrailBlock extends Error {
  constructor(
    readonly guardrailName: string,
    readonly guardrailReason: string,
  ) {
    super(guardrailReason);
    this.name = 'GuardrailBlock';
  }
}

export class GuardrailExecutor implements IHookTypeExecutor {
  readonly type = 'guardrail';
  private readonly guardrails: Map<string, TGuardrail>;

  constructor(guardrails: Map<string, TGuardrail> | Record<string, TGuardrail>) {
    this.guardrails =
      guardrails instanceof Map ? new Map(guardrails) : new Map(Object.entries(guardrails));
  }

  async execute(definition: THookDefinition, input: IHookInput): Promise<THookOutcome> {
    if (definition.type !== 'guardrail') {
      // Defensive: the runner dispatches by type, so this should never happen. It answers `error`
      // rather than `allow` because a mis-dispatched gate has rendered no verdict — the old
      // exit-code-0 here was itself a small instance of the coercion SEC-015 removes.
      return {
        outcome: 'error',
        source: 'guardrail',
        kind: 'malformed-response',
        reason: `GuardrailExecutor received a '${definition.type}' definition`,
      };
    }

    // Fail-safe on misconfiguration: a NAMED guardrail that isn't registered is a config error that
    // must NOT silently disable the gate — block the turn with a clear reason. (An omitted name list
    // runs all registered guardrails; an empty registry then legitimately passes.)
    if (definition.guardrails) {
      const unknown = definition.guardrails.filter((name) => !this.guardrails.has(name));
      if (unknown.length > 0) {
        return {
          outcome: 'deny',
          source: 'guardrail',
          reason: `Unknown guardrail(s) referenced but not registered: ${unknown.join(', ')}`,
        };
      }
    }

    const selected = this.selectGuardrails(definition.guardrails);
    if (selected.length === 0) return { outcome: 'allow', source: 'guardrail', stdout: '' };

    try {
      // Parallel fan-out + fail-fast: Promise.all rejects on the FIRST guardrail that blocks/throws,
      // without waiting for the rest — so the earliest failure is the turn's block decision.
      await Promise.all(
        selected.map(async ([name, guardrail]) => {
          let result;
          try {
            result = await guardrail(input);
          } catch (err) {
            // Fail-safe: a guardrail that cannot evaluate blocks the turn (it is an enforcement gate).
            const reason = err instanceof Error ? err.message : String(err);
            throw new GuardrailBlock(name, `Guardrail "${name}" errored: ${reason}`);
          }
          if (!result.pass) {
            throw new GuardrailBlock(name, result.reason ?? `Guardrail "${name}" blocked the turn`);
          }
        }),
      );
    } catch (err) {
      if (err instanceof GuardrailBlock) {
        return { outcome: 'deny', source: 'guardrail', reason: err.guardrailReason };
      }
      throw err;
    }

    return { outcome: 'allow', source: 'guardrail', stdout: '' };
  }

  /** Resolve the definition's optional name list to registered guardrails; omitted ⇒ all. */
  private selectGuardrails(names?: string[]): Array<[string, TGuardrail]> {
    if (!names) return [...this.guardrails.entries()];
    const selected: Array<[string, TGuardrail]> = [];
    for (const name of names) {
      const guardrail = this.guardrails.get(name);
      if (guardrail) selected.push([name, guardrail]);
    }
    return selected;
  }
}
