/**
 * Issue #2245 — a config declaring a hook type the session cannot execute is refused at assembly,
 * naming the type and why, instead of validating and then denying every tool call.
 */
import { describe, expect, it } from 'vitest';

import {
  assertConfiguredHookTypesExecutable,
  unrunnableHookTypes,
} from '../hook-type-reachability.js';

import type { IHookTypeExecutor, THooksConfig } from '@robota-sdk/agent-core';

function executor(type: IHookTypeExecutor['type']): IHookTypeExecutor {
  return { type, execute: async () => ({ outcome: 'allow', source: type, stdout: '' }) };
}

const BUILTINS = [executor('command'), executor('http')];

describe('unrunnableHookTypes (issue #2245)', () => {
  it('names a prompt hook with no providerFactory-backed executor, once', () => {
    const hooks: THooksConfig = {
      PreToolUse: [{ matcher: '', hooks: [{ type: 'prompt', prompt: 'ok?' }] }],
      Stop: [{ matcher: '', hooks: [{ type: 'prompt', prompt: 'done?' }] }],
    };
    expect(unrunnableHookTypes(hooks, BUILTINS)).toEqual([
      { type: 'prompt', reason: expect.stringContaining('providerFactory') },
    ]);
  });

  it('is empty when every declared type has an executor', () => {
    const hooks: THooksConfig = {
      PreToolUse: [
        { matcher: '', hooks: [{ type: 'command', command: 'true' }, { type: 'guardrail' }] },
      ],
    };
    expect(unrunnableHookTypes(hooks, [...BUILTINS, executor('guardrail')])).toEqual([]);
    expect(unrunnableHookTypes(undefined, BUILTINS)).toEqual([]);
  });
});

describe('assertConfiguredHookTypesExecutable', () => {
  it('throws naming each unrunnable type and the option it needs', () => {
    const hooks: THooksConfig = {
      PreToolUse: [
        {
          matcher: '',
          hooks: [{ type: 'agent', agent: 'reviewer' }, { type: 'guardrail' }],
        },
      ],
    };
    expect(() => assertConfiguredHookTypesExecutable(hooks, BUILTINS)).toThrow(
      /"agent" \(requires the `sessionFactory`.*"guardrail" \(requires registered `guardrails`/,
    );
  });

  it('does not throw for a runnable configuration', () => {
    const hooks: THooksConfig = {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'http', url: 'http://h/' }] }],
    };
    expect(() => assertConfiguredHookTypesExecutable(hooks, BUILTINS)).not.toThrow();
  });
});
