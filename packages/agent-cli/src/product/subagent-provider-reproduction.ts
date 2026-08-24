import { createInProcessSubagentRunner } from '@robota-sdk/agent-framework';

import type { TSubagentRunnerFactory } from '@robota-sdk/agent-framework';

/**
 * ARCH-109: whether a child process can arrive at the parent's PROVIDER composition, and which
 * subagent runner follows from the answer.
 *
 * Separate from the recipe next door because it answers a different question. That file says what
 * robota composes; this one says what survives a process boundary, which is a property OF a
 * composition rather than a part of one — and the file-size floor is what made the distinction
 * worth acting on rather than only noticing.
 */

/**
 * How the parent's PROVIDER composition was arrived at, in the two facts a child cannot re-derive.
 *
 * ARCH-109. The capability question above asks what the child cannot rebuild; this asks the same
 * thing one dimension over, and it is a separate input because the answer is not readable from the
 * definitions themselves. `IProviderDefinition` carries `createProvider` and `probeProfile` — both
 * functions — so the set cannot cross the boundary as data, and comparing the parent's set with the
 * child's by provider NAME would pass in exactly the case that matters most: two different
 * implementations sharing a name, where the child silently runs different code instead of failing.
 *
 * What the composition root knows, and nothing downstream can recover, is where each came from.
 */
export interface IProviderReproduction {
  /**
   * A caller supplied `providerDefinitions` to `startCli`, so the set is not the one the worker
   * entry builds for itself.
   */
  readonly callerSuppliedDefinitions: boolean;
  /**
   * A replay provider (`--session-log`) overrides settings-based construction — in the PARENT only.
   * It is bound to a log file and a read cursor, so it is not something two processes can share.
   */
  readonly replayProvider: boolean;
}

/**
 * Provider composition a child process cannot arrive at on its own.
 *
 * ARCH-109. Stated as the two facts rather than as a single "is it custom" flag, because the
 * remedies differ: a replay provider is preserved by choosing the in-process runner, while a
 * caller-supplied set needs a paired worker entry that builds it, and only the caller can supply
 * that.
 */
export function nonReproducibleProviderComposition(
  reproduction: IProviderReproduction,
): readonly string[] {
  const missing: string[] = [];
  if (reproduction.replayProvider) missing.push('a replay provider (--session-log)');
  if (reproduction.callerSuppliedDefinitions) missing.push('caller-supplied providerDefinitions');
  return missing;
}

/**
 * ARCH-109: which subagent runner a session gets, and the one case where that is not free.
 *
 * Choosing a runner is a packaging decision — that is ARCH-034's whole point, and why the child
 * recipe goes to lengths to give a child-process subagent the same surface as an in-process one.
 * A replay provider is where the packaging choice stops being free: it is bound to a log file and a
 * read cursor, so it is not something two processes can share, and the child-process runner is built
 * from the settings-derived `providerConfig` — which carries `apiKey`. A replay parent with
 * child-process subagents therefore replays deterministically while its children make live, billed
 * calls.
 *
 * `buildChildProcess` is a THUNK rather than a value so that on the fallback branch the child runner
 * is never constructed at all. That is the property worth having and the one a test can hold: not
 * merely that the returned runner is the in-process one, but that no live provider config was
 * assembled to be carried across a boundary.
 *
 * **This selects; it does not refuse, and the first draft of this change did refuse.** A composition-
 * time throw on caller-supplied definitions broke 20 existing tests that drive the CLI through
 * `startCli({ providerDefinitions })` — which is not an abuse, it is the supported way to embed the
 * product with your own providers, and none of those sessions spawn a subagent at all. Refusing
 * there was a false positive against working software. The defect is that a child would resolve a
 * DIFFERENT provider; running the subagent in-process removes it rather than reporting it, and keeps
 * every legitimate caller working. What is genuinely given up is process isolation, so that is said
 * out loud rather than inferred.
 *
 * The capability guard above still throws, and the asymmetry is deliberate: an unreproducible SANDBOX
 * is a containment property, where the safe direction is to stop. An unreproducible PROVIDER has a
 * correct fallback, and stopping would be the unsafe direction for the user's session.
 */
export function selectRobotaSubagentRunner(options: {
  readonly reproduction: IProviderReproduction;
  readonly buildChildProcess: () => TSubagentRunnerFactory;
  /** Told what was given up, so a lost isolation guarantee is never silent. */
  readonly notice: (message: string) => void;
}): TSubagentRunnerFactory {
  const missing = nonReproducibleProviderComposition(options.reproduction);
  if (missing.length === 0) return options.buildChildProcess();
  // Told to the OPERATOR only when the operator is the one who caused it.
  //
  // `--session-log` is something a person typed, and it changes what they will observe, so staying
  // quiet about it would be the silent half of a behaviour change they asked for. Caller-supplied
  // `providerDefinitions` is a composition an embedding PROGRAM made — writing to its stderr on
  // every startup is noise it cannot act on (robota exposes no paired worker entry to fix it with)
  // and it is a contract break for the print and JSON modes, where stderr is part of the output.
  // Measured: four existing tests assert an empty stderr for exactly those runs.
  if (options.reproduction.replayProvider) {
    options.notice(
      `Subagents will run in-process: this session composed ${missing.join(' and ')}, which a child ` +
        'process cannot rebuild, so child-process subagents would run on a different provider than ' +
        'this one. Process isolation is off for subagents; the provider is shared.',
    );
  }
  return createInProcessSubagentRunner;
}
