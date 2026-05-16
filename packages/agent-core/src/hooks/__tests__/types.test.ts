import { describe, it, expect } from 'vitest';
import type { THookEvent, THookDefinition, IHookTypeExecutor } from '../types.js';

describe('Hook types', () => {
  it('should include all supported hook events', () => {
    const events: THookEvent[] = [
      'PreToolUse',
      'PostToolUse',
      'SessionStart',
      'SessionEnd',
      'Stop',
      'StopFailure',
      'PreCompact',
      'PostCompact',
      'UserPromptSubmit',
      'SubagentStart',
      'SubagentStop',
      'WorktreeCreate',
      'WorktreeRemove',
    ];
    expect(events).toHaveLength(13);
  });

  it('should support discriminated union for hook definitions', () => {
    const commandHook: THookDefinition = { type: 'command', command: 'echo test', timeout: 10 };
    const httpHook: THookDefinition = { type: 'http', url: 'https://example.com', timeout: 5 };
    const promptHook: THookDefinition = { type: 'prompt', prompt: 'Is this safe?' };
    const agentHook: THookDefinition = {
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
