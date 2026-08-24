import { describe, expect, it } from 'vitest';

import { createInProcessSubagentRunner } from '@robota-sdk/agent-framework';

import { createRobotaPacks } from '../robota-profile.js';
import { createRobotaSubagentComposition } from '../robota-subagent-composition.js';
import {
  nonReproducibleProviderComposition,
  selectRobotaSubagentRunner,
} from '../subagent-provider-reproduction.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { TSubagentRunnerFactory } from '@robota-sdk/agent-framework';

describe('ARCH-109 — the provider dimension of "can the child reproduce this?"', () => {
  /**
   * A definition set that is NOT the default one, and shares a built-in's `type` on purpose.
   *
   * The shared name is the point. It is the case a name-comparison check would call "same" and the
   * child would then run different code for — which is why the ORIGIN is reported by the composition
   * root rather than re-derived from the definitions downstream.
   */
  const CALLER_DEFINITIONS = [
    { type: 'openai', createProvider: () => ({}) },
  ] as unknown as readonly IProviderDefinition[];

  it('names each composition a child cannot rebuild, and says nothing about one it can', () => {
    expect(
      nonReproducibleProviderComposition({
        callerSuppliedDefinitions: true,
        replayProvider: false,
      }),
    ).toEqual(['caller-supplied providerDefinitions']);
    expect(
      nonReproducibleProviderComposition({
        callerSuppliedDefinitions: false,
        replayProvider: true,
      }),
    ).toEqual(['a replay provider (--session-log)']);
    expect(
      nonReproducibleProviderComposition({
        callerSuppliedDefinitions: false,
        replayProvider: false,
      }),
    ).toEqual([]);
  });

  it('the child recipe carries the definitions it is GIVEN, not an imported default set', () => {
    // The seam this fills already existed — `ISubagentWorkerComposition.providerDefinitions` is
    // documented as carrying definitions so "a custom provider type resolves instead of throwing
    // `Unknown provider`". Robota's worker entry pinned it to the default set, so the seam was
    // present and unused. Asserting identity, not a name match: a name match passes for the default
    // set too, and so would not fail on the defect this names.
    const composition = createRobotaSubagentComposition(createRobotaPacks, CALLER_DEFINITIONS);

    expect(composition.providerDefinitions).toBe(CALLER_DEFINITIONS);
    expect(createRobotaSubagentComposition().providerDefinitions).not.toBe(CALLER_DEFINITIONS);
  });
});

describe('ARCH-109 — a composition a child cannot rebuild keeps its subagents in-process', () => {
  function record(): { readonly notices: string[]; readonly notice: (m: string) => void } {
    const notices: string[] = [];
    return { notices, notice: (m) => notices.push(m) };
  }

  it('never builds the child-process runner, so no live provider config is assembled to cross', () => {
    const { notices, notice } = record();
    let built = 0;

    const runner = selectRobotaSubagentRunner({
      reproduction: { callerSuppliedDefinitions: false, replayProvider: true },
      buildChildProcess: () => {
        built += 1;
        return createInProcessSubagentRunner;
      },
      notice,
    });

    // The stronger of the two assertions. "The returned runner is the in-process one" would pass
    // even if the child runner had been constructed and discarded — and constructing it is what
    // reads `providerConfig`, which carries `apiKey`. Zero calls is the property.
    expect(built).toBe(0);
    expect(runner).toBe(createInProcessSubagentRunner);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/--session-log/);
    // Isolation was given up. Saying so is the difference between a fallback and a silent downgrade.
    expect(notices[0]).toMatch(/isolation is off/);
  });

  it('falls back for caller-supplied definitions rather than refusing the session', () => {
    const { notices, notice } = record();

    const runner = selectRobotaSubagentRunner({
      reproduction: { callerSuppliedDefinitions: true, replayProvider: false },
      buildChildProcess: () => {
        throw new Error('the child runner must not be built for an unreproducible composition');
      },
      notice,
    });

    // Regression guard with a measured cause: the first draft THREW here, and 20 existing tests
    // driving the CLI through `startCli({ providerDefinitions })` failed — none of which spawn a
    // subagent. Supplying your own providers is the supported way to embed the product, so refusing
    // it was a false positive against working software.
    expect(runner).toBe(createInProcessSubagentRunner);
    // And SILENTLY, which is the second half of the same measurement. Four more tests assert an
    // empty stderr for print and JSON runs, where stderr is part of the output contract — and an
    // embedding program cannot act on the warning anyway, since robota exposes no paired worker
    // entry to fix it with. The operator-typed `--session-log` case above is the one that speaks.
    expect(notices).toEqual([]);
  });

  it('builds the child-process runner for an ordinary run, and says nothing', () => {
    const { notices, notice } = record();
    const sentinel = (() => undefined) as unknown as TSubagentRunnerFactory;
    let built = 0;

    const runner = selectRobotaSubagentRunner({
      reproduction: { callerSuppliedDefinitions: false, replayProvider: false },
      buildChildProcess: () => {
        built += 1;
        return sentinel;
      },
      notice,
    });

    // The control half. Without it, a selector that returned the in-process runner unconditionally
    // would satisfy every test above and quietly remove process isolation from every session.
    expect(built).toBe(1);
    expect(runner).toBe(sentinel);
    expect(notices).toEqual([]);
  });
});
