import { describe, it, expect, vi } from 'vitest';
import { runHooks } from '../hook-runner.js';
import { CommandExecutor } from '../executors/command-executor.js';
import { HttpExecutor } from '../executors/http-executor.js';
import type { THooksConfig, IHookInput, IHookTypeExecutor, IHookDefinition } from '../types.js';

describe('Hook flow integration', () => {
  const baseInput: IHookInput = {
    session_id: 'integration-test',
    cwd: process.cwd(),
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
  };

  it('should execute command hooks end-to-end', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo allowed' }],
        },
      ],
    };

    const result = await runHooks(config, 'PreToolUse', baseInput);

    expect(result.blocked).toBe(false);
  });

  it('should block when command hook exits with code 2', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo "denied" >&2; exit 2' }],
        },
      ],
    };

    const result = await runHooks(config, 'PreToolUse', baseInput);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('denied');
  });

  it('should handle multiple hook types in same config', async () => {
    // Mock fetch for HTTP executor
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'echo command-ok' },
            { type: 'http', url: 'https://example.com/hook' },
          ],
        },
      ],
    };

    const result = await runHooks(config, 'PreToolUse', baseInput);

    expect(result.blocked).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('should skip unknown hook types gracefully', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            // Force an unknown type for testing
            { type: 'unknown-type' as 'command', command: 'should-not-run' },
          ],
        },
      ],
    };

    // Provide only command executor — 'unknown-type' won't match any
    const executors: IHookTypeExecutor[] = [new CommandExecutor()];
    const result = await runHooks(config, 'PreToolUse', baseInput, executors);

    expect(result.blocked).toBe(false);
  });

  it('should process multiple events independently', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo pre-tool' }],
        },
      ],
      SessionStart: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: 'echo session-start' }],
        },
      ],
    };

    const preResult = await runHooks(config, 'PreToolUse', baseInput);
    expect(preResult.blocked).toBe(false);

    const sessionInput: IHookInput = {
      session_id: 'integration-test',
      cwd: process.cwd(),
      hook_event_name: 'SessionStart',
    };
    const sessionResult = await runHooks(config, 'SessionStart', sessionInput);
    expect(sessionResult.blocked).toBe(false);
  });

  it('should match tool names with regex patterns', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: '^(Bash|Read)$',
          hooks: [{ type: 'command', command: 'echo matched' }],
        },
      ],
    };

    // Should match Bash
    const bashResult = await runHooks(config, 'PreToolUse', baseInput);
    expect(bashResult.blocked).toBe(false);

    // Should not match Write
    const writeInput: IHookInput = { ...baseInput, tool_name: 'Write' };
    const writeResult = await runHooks(config, 'PreToolUse', writeInput);
    expect(writeResult.blocked).toBe(false);
  });

  it('should return not blocked when config is undefined', async () => {
    const result = await runHooks(undefined, 'PreToolUse', baseInput);
    expect(result.blocked).toBe(false);
  });

  it('should return not blocked when event has no hooks', async () => {
    const config: THooksConfig = {
      SessionStart: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: 'echo start' }],
        },
      ],
    };

    // PreToolUse has no hooks in this config
    const result = await runHooks(config, 'PreToolUse', baseInput);
    expect(result.blocked).toBe(false);
  });

  it('should support custom executor injection', async () => {
    let executedDefinition: IHookDefinition | undefined;

    const customExecutor: IHookTypeExecutor = {
      type: 'command',
      async execute(definition, _input) {
        executedDefinition = definition;
        return { exitCode: 0, stdout: 'custom', stderr: '' };
      },
    };

    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo test' }],
        },
      ],
    };

    const result = await runHooks(config, 'PreToolUse', baseInput, [customExecutor]);

    expect(result.blocked).toBe(false);
    expect(executedDefinition).toBeDefined();
    expect(executedDefinition?.type).toBe('command');
  });
});
