import { describe, expect, it } from 'vitest';

import { runHooks } from '../hook-runner.js';

import type { IHookInput, IHookTypeExecutor, THooksConfig } from '../types.js';

/**
 * #1831 — the runner's comment promised "skip with warning" and nothing warned.
 *
 * `AGENTS.md` makes "silence is not success" a rule-level invariant, and this was a hook runner
 * completing quietly on an unrecognised input with a comment asserting the opposite. The concrete
 * consequence the issue names: a config declaring `{ type: 'guardrail', … }` with no guardrail
 * registry supplied silently DISABLES the gate, and the author sees nothing.
 *
 * The fix reports on the RESULT rather than logging. A `console.warn` would satisfy the letter of
 * the old comment while remaining invisible to a caller and untestable — these assertions are only
 * possible because the fact is carried in the return value.
 */

const config = (type: string): THooksConfig =>
  ({
    PreToolUse: [{ matcher: '', hooks: [{ type, command: 'noop' }] }],
  }) as unknown as THooksConfig;

const input = { toolName: 'Bash', toolInput: {} } as never;

const passingExecutor: IHookTypeExecutor = {
  type: 'command',
  execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
};

describe('#1831 — an unrecognised hook type is reported, not skipped in silence', () => {
  it('names the type that had no executor', async () => {
    // The issue's exact scenario: a guardrail hook configured with no guardrail executor supplied.
    const result = await runHooks(config('guardrail'), 'PreToolUse', input, [passingExecutor]);

    expect(result.unknownHookTypes).toEqual(['guardrail']);
  });

  it('says nothing when every configured hook has an executor', async () => {
    // The ordinary case must draw no attention, or the signal stops being read.
    const result = await runHooks(config('command'), 'PreToolUse', input, [passingExecutor]);

    expect(result.unknownHookTypes).toBeUndefined();
  });

  it('reports each unknown type once, sorted', async () => {
    const many = {
      PreToolUse: [
        {
          matcher: '',
          hooks: [
            { type: 'guardrail', command: 'a' },
            { type: 'guardrail', command: 'b' },
            { type: 'agent', command: 'c' },
          ],
        },
      ],
    } as unknown as THooksConfig;

    const result = await runHooks(many, 'PreToolUse', input, [passingExecutor]);

    expect(result.unknownHookTypes).toEqual(['agent', 'guardrail']);
  });

  it('carries the fact on the BLOCKED path too', async () => {
    // An answer that depends on which path the run took would be a new trap: a caller checking for
    // disabled gates would see them only when nothing blocked.
    const blocking: IHookTypeExecutor = {
      type: 'command',
      execute: async () => ({ exitCode: 2, stdout: '', stderr: 'denied' }),
    };
    const mixed = {
      PreToolUse: [
        {
          matcher: '',
          hooks: [
            { type: 'guardrail', command: 'never-runs' },
            { type: 'command', command: 'blocks' },
          ],
        },
      ],
    } as unknown as THooksConfig;

    const result = await runHooks(mixed, 'PreToolUse', input, [blocking]);

    expect(result.blocked).toBe(true);
    expect(result.unknownHookTypes).toEqual(['guardrail']);
  });

  it('still runs the hooks it DOES recognise', async () => {
    // The unknown one is skipped, not the whole group — reporting must not become refusing.
    const mixed = {
      PreToolUse: [
        {
          matcher: '',
          hooks: [
            { type: 'guardrail', command: 'never-runs' },
            { type: 'command', command: 'runs' },
          ],
        },
      ],
    } as unknown as THooksConfig;
    let ran = false;
    const observing: IHookTypeExecutor = {
      type: 'command',
      execute: async () => {
        ran = true;
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    };

    const result = await runHooks(mixed, 'PreToolUse', input, [observing]);

    expect(ran).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.unknownHookTypes).toEqual(['guardrail']);
  });
});
