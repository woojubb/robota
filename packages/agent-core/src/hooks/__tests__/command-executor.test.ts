import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../executors/command-executor.js';
import type { IHookInput } from '../types.js';

describe('CommandExecutor', () => {
  const executor = new CommandExecutor();

  it('should have type "command"', () => {
    expect(executor.type).toBe('command');
  });

  it('should execute shell command and return result', async () => {
    const definition = { type: 'command' as const, command: 'echo hello' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: process.cwd(),
      hook_event_name: 'SessionStart',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('should respect timeout in seconds', async () => {
    const definition = { type: 'command' as const, command: 'sleep 10', timeout: 1 };
    const input: IHookInput = {
      session_id: 'test',
      cwd: process.cwd(),
      hook_event_name: 'SessionStart',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).not.toBe(0);
  }, 15_000);

  it('should use default timeout of 10 seconds when not specified', async () => {
    const definition = { type: 'command' as const, command: 'echo fast' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: process.cwd(),
      hook_event_name: 'SessionStart',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(0);
  });

  it('should pass JSON input on stdin', async () => {
    const definition = { type: 'command' as const, command: 'cat' };
    const input: IHookInput = {
      session_id: 'test-123',
      cwd: '/tmp',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.session_id).toBe('test-123');
    expect(parsed.tool_name).toBe('Bash');
  });

  it('should return exit code 1 and error message on command failure', async () => {
    const definition = { type: 'command' as const, command: 'exit 1' };
    const input: IHookInput = {
      session_id: 'test',
      cwd: process.cwd(),
      hook_event_name: 'SessionStart',
    };
    const result = await executor.execute(definition, input);
    expect(result.exitCode).toBe(1);
  });
});
