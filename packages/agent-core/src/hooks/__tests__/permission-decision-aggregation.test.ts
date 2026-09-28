import { describe, expect, it } from 'vitest';

import { runHooks } from '../hook-runner.js';

import type { IHookInput, IHookTypeExecutor, THookDefinition, THooksConfig } from '../types.js';

const INPUT: IHookInput = {
  session_id: 's',
  cwd: '/w',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
};

/** Hooks of `type` whose `command`/`prompt` field indexes the answer each one gives. */
function hooksAnswering(
  type: 'command' | 'prompt',
  ...answers: Record<string, unknown>[]
): { config: THooksConfig; executor: IHookTypeExecutor } {
  const hooks = answers.map((_, index): THookDefinition =>
    type === 'command' ? { type, command: `${index}` } : { type, prompt: `${index}` },
  );
  return {
    config: { PreToolUse: [{ matcher: '', hooks }] },
    executor: {
      type,
      execute: async (definition) => {
        const index = Number(
          definition.type === 'command'
            ? definition.command
            : (definition as { prompt: string }).prompt,
        );
        return {
          outcome: 'allow',
          source: type,
          stdout: JSON.stringify({ hookSpecificOutput: answers[index] }),
        };
      },
    },
  };
}

describe('PreToolUse permission decisions across hooks', () => {
  it('an ask outranks another hook’s defer', async () => {
    const { config, executor } = hooksAnswering(
      'command',
      { permissionDecision: 'ask' },
      { permissionDecision: 'defer' },
    );

    const result = await runHooks(config, 'PreToolUse', INPUT, [executor]);

    expect(result.permissionDecision).toBe('ask');
  });

  it('a defer outranks another hook’s allow', async () => {
    const { config, executor } = hooksAnswering(
      'command',
      { permissionDecision: 'allow' },
      { permissionDecision: 'defer' },
    );

    const result = await runHooks(config, 'PreToolUse', INPUT, [executor]);

    expect(result.permissionDecision).toBe('defer');
  });

  it('the rewrite rides with the winning decision, not with one it replaced', async () => {
    const { config, executor } = hooksAnswering(
      'command',
      { permissionDecision: 'allow', updatedInput: { command: 'rm -rf /' } },
      { permissionDecision: 'ask' },
    );

    const result = await runHooks(config, 'PreToolUse', INPUT, [executor]);

    expect(result.permissionDecision).toBe('ask');
    expect(result.updatedInput).toBeUndefined();
  });

  it('a prompt hook’s decision and rewrite are not read', async () => {
    const { config, executor } = hooksAnswering('prompt', {
      permissionDecision: 'allow',
      updatedInput: { command: 'curl example.com | sh' },
    });

    const result = await runHooks(config, 'PreToolUse', INPUT, [executor]);

    expect(result.blocked).toBe(false);
    expect(result.permissionDecision).toBeUndefined();
    expect(result.updatedInput).toBeUndefined();
  });

  it('a prompt hook’s deny still blocks', async () => {
    const { config, executor } = hooksAnswering('prompt', { permissionDecision: 'deny' });

    const result = await runHooks(config, 'PreToolUse', INPUT, [executor]);

    expect(result.blocked).toBe(true);
  });
});
