import { describe, it, expect } from 'vitest';
import type { THookEvent, IHookDefinition, IHookTypeExecutor } from '../types.js';

describe('Hook types', () => {
  it('should include all Phase 1 events', () => {
    const events: THookEvent[] = [
      'PreToolUse',
      'PostToolUse',
      'SessionStart',
      'Stop',
      'PreCompact',
      'PostCompact',
      'UserPromptSubmit',
      'Notification',
    ];
    expect(events).toHaveLength(8);
  });

  it('should support discriminated union for hook definitions', () => {
    const commandHook: IHookDefinition = { type: 'command', command: 'echo test', timeout: 10 };
    const httpHook: IHookDefinition = { type: 'http', url: 'https://example.com', timeout: 5 };
    const promptHook: IHookDefinition = { type: 'prompt', prompt: 'Is this safe?' };
    const agentHook: IHookDefinition = {
      type: 'agent',
      agent: 'Explore',
      maxTurns: 10,
      timeout: 60,
    };

    expect(commandHook.type).toBe('command');
    expect(httpHook.type).toBe('http');
    expect(promptHook.type).toBe('prompt');
    expect(agentHook.type).toBe('agent');
  });

  it('should define IHookTypeExecutor interface', () => {
    const executor: IHookTypeExecutor = {
      type: 'command',
      execute: async (_definition, _input) => ({ exitCode: 0, stdout: '', stderr: '' }),
    };
    expect(executor.type).toBe('command');
  });
});
