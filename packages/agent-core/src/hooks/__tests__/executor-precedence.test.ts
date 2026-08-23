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
    // A `has()`-guarded first-wins would fail the case above; running both would pass it while
    // still executing the built-in. Asserting the exact call list rules out both mutations.
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

  it('leaves executors of DIFFERENT types alone', async () => {
    // Last-wins is scoped to a type; an unrelated executor must not be displaced by it.
    const ran: string[] = [];
    const result = await runHooks(
      {
        PreToolUse: [{ matcher: '', hooks: [{ type: 'http', url: 'https://example.invalid' }] }],
      } as unknown as THooksConfig,
      'PreToolUse',
      input,
      [
        recordingExecutor('command', 'command-one', ran),
        recordingExecutor('command', 'command-two', ran),
        recordingExecutor('http', 'http-executor', ran),
      ],
    );

    expect(ran).toEqual(['http-executor']);
    expect(result.unknownHookTypes).toBeUndefined();
  });
});
