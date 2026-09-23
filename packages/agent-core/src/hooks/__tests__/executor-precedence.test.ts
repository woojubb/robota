import { describe, expect, it } from 'vitest';

import { runHooks } from '../hook-runner.js';

import type { IHookInput, IHookTypeExecutor, THooksConfig } from '../types.js';

/**
 * SEC-016 — the LAST executor of a given type wins, and that is a correctness property.
 *
 * `runHooks` builds its lookup with `Map.set` in array order, so a later entry of the same `type`
 * replaces an earlier one. `create-session` depends on this: it seeds the built-in command/http
 * executors FIRST precisely so a caller-supplied executor of the same type can still override one.
 *
 * Nothing pinned it. Changing `executorMap.set(...)` to a `has()`-guarded first-wins would leave
 * every other test in this repository green while silently inverting the rule — the built-in,
 * process-spawning `CommandExecutor` would override the replacement a caller supplied deliberately.
 * That is a loss of control at a security boundary, so it is asserted here, in the package that
 * OWNS the behaviour, rather than by checking array position in a caller.
 *
 * These cases assert which executor actually EXECUTED, not where it sat in the input array. Array
 * position is the mechanism; which one runs is the property.
 */

const config: THooksConfig = {
  PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'noop' }] }],
} as unknown as THooksConfig;

const input = { toolName: 'Bash', toolInput: {} } as unknown as IHookInput;

/** An executor of `type` that records that it ran and allows. */
function recordingExecutor(type: string, label: string, ran: string[]): IHookTypeExecutor {
  return {
    type,
    execute: async () => {
      ran.push(label);
      return { outcome: 'allow' as const, source: 'command' as const, stdout: label };
    },
  } as IHookTypeExecutor;
}

describe('SEC-016 — executor precedence within one type is last-wins', () => {
  it('runs the LATER executor when two share a type', async () => {
    const ran: string[] = [];
    const result = await runHooks(config, 'PreToolUse', input, [
      recordingExecutor('command', 'seeded-builtin', ran),
      recordingExecutor('command', 'caller-supplied', ran),
    ]);

    // The whole point: the caller's entry, appended after the seed, is the one that executes.
    expect(ran).toEqual(['caller-supplied']);
    expect(result.stdout).toBe('caller-supplied');
  });

  it('does not merely run both — the earlier one is REPLACED, not also invoked', async () => {
    // Not "because running both would pass case 1" — it would not; case 1 asserts an exact call
    // list. This case exists because case 1 has only two entries, so "last" and "second" cannot be
    // told apart there. Three entries distinguish last-wins from any fixed-position rule.
    const ran: string[] = [];
    await runHooks(config, 'PreToolUse', input, [
      recordingExecutor('command', 'first', ran),
      recordingExecutor('command', 'second', ran),
      recordingExecutor('command', 'third', ran),
    ]);

    expect(ran).toEqual(['third']);
  });

  it('a denial from the later executor is what blocks, not an allow from the earlier one', async () => {
    // Precedence has to hold on the path that decides, not only on the happy path.
    const denying: IHookTypeExecutor = {
      type: 'command',
      execute: async () => ({
        outcome: 'deny' as const,
        source: 'command' as const,
        reason: 'caller-supplied executor denied',
      }),
    } as IHookTypeExecutor;
    const ran: string[] = [];

    const result = await runHooks(config, 'PreToolUse', input, [
      recordingExecutor('command', 'seeded-builtin', ran),
      denying,
    ]);

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('caller-supplied executor denied');
    expect(ran).toEqual([]);
  });

  it('keys the lookup by TYPE, not by array position', async () => {
    // Review caught this case green for the wrong reason. The `http` executor used to be the LAST
    // array entry, so selecting it proved nothing: a type-blind `resolvedExecutors[len - 1]`
    // implementation passed. The mutation is only excluded if the winning `command` executor sits
    // AFTER the `http` one, so "last overall" and "last of its type" give different answers.
    const executors = (ran: string[]) => [
      recordingExecutor('command', 'command-one', ran),
      recordingExecutor('http', 'http-executor', ran),
      recordingExecutor('command', 'command-two', ran),
    ];

    const httpRan: string[] = [];
    await runHooks(
      {
        PreToolUse: [{ matcher: '', hooks: [{ type: 'http', url: 'https://example.invalid' }] }],
      } as unknown as THooksConfig,
      'PreToolUse',
      input,
      executors(httpRan),
    );
    // Type-blind last-wins would run `command-two` here.
    expect(httpRan).toEqual(['http-executor']);

    const commandRan: string[] = [];
    const result = await runHooks(config, 'PreToolUse', input, executors(commandRan));
    // And the command hook still takes the LATER of the two command executors, not the http one.
    expect(commandRan).toEqual(['command-two']);
    expect(result.unknownHookTypes).toBeUndefined();
  });
});
