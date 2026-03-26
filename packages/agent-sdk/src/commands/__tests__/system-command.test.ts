import { describe, it, expect, vi } from 'vitest';
import { SystemCommandExecutor, createSystemCommands } from '../system-command.js';
import type { InteractiveSession } from '../../interactive/interactive-session.js';

function createMockSession(overrides?: Record<string, unknown>) {
  const underlying = {
    clearHistory: vi.fn(),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getMessageCount: vi.fn().mockReturnValue(5),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    getContextState: vi.fn().mockReturnValue({
      usedTokens: 5000,
      maxTokens: 200000,
      usedPercentage: 2.5,
    }),
    compact: vi.fn(),
    ...overrides,
  };

  return {
    getSession: () => underlying,
    getContextState: underlying.getContextState,
    _underlying: underlying,
  } as unknown as InteractiveSession;
}

describe('SystemCommandExecutor', () => {
  it('lists all built-in commands', () => {
    const executor = new SystemCommandExecutor();
    const commands = executor.listCommands();
    expect(commands.length).toBeGreaterThanOrEqual(12);
    expect(commands.map((c) => c.name)).toContain('help');
    expect(commands.map((c) => c.name)).toContain('clear');
    expect(commands.map((c) => c.name)).toContain('mode');
  });

  it('returns null for unknown command', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('nonexistent', createMockSession(), '');
    expect(result).toBeNull();
  });

  it('help returns command list', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('help', createMockSession(), '');
    expect(result!.success).toBe(true);
    expect(result!.message).toContain('Available commands');
  });

  it('clear calls session.clearHistory', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession();
    const result = await executor.execute('clear', session, '');
    expect(result!.success).toBe(true);
    expect(
      (session as unknown as { _underlying: { clearHistory: ReturnType<typeof vi.fn> } })
        ._underlying.clearHistory,
    ).toHaveBeenCalled();
  });

  it('mode shows current mode without args', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('mode', createMockSession(), '');
    expect(result!.message).toContain('default');
    expect(result!.data?.mode).toBe('default');
  });

  it('mode sets valid mode', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession();
    const result = await executor.execute('mode', session, 'plan');
    expect(result!.success).toBe(true);
    expect(result!.data?.mode).toBe('plan');
  });

  it('mode rejects invalid mode', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('mode', createMockSession(), 'invalid');
    expect(result!.success).toBe(false);
  });

  it('model returns modelId in data', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('model', createMockSession(), 'claude-sonnet-4-6');
    expect(result!.success).toBe(true);
    expect(result!.data?.modelId).toBe('claude-sonnet-4-6');
  });

  it('language returns language in data', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('language', createMockSession(), 'ko');
    expect(result!.success).toBe(true);
    expect(result!.data?.language).toBe('ko');
  });

  it('cost returns session info', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('cost', createMockSession(), '');
    expect(result!.message).toContain('test-session-id');
    expect(result!.data?.messageCount).toBe(5);
  });

  it('context returns token usage', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('context', createMockSession(), '');
    expect(result!.message).toContain('5,000');
    expect(result!.data?.usedTokens).toBe(5000);
  });

  it('compact calls session.compact', async () => {
    const executor = new SystemCommandExecutor();
    const session = createMockSession();
    const result = await executor.execute('compact', session, 'focus on tests');
    expect(result!.success).toBe(true);
    expect(
      (session as unknown as { _underlying: { compact: ReturnType<typeof vi.fn> } })._underlying
        .compact,
    ).toHaveBeenCalledWith('focus on tests');
  });

  it('resume returns triggerResumePicker in data', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('resume', createMockSession(), '');
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.data?.triggerResumePicker).toBe(true);
  });

  it('rename returns name in data', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('rename', createMockSession(), 'my-session');
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.data?.name).toBe('my-session');
  });

  it('rename fails without name argument', async () => {
    const executor = new SystemCommandExecutor();
    const result = await executor.execute('rename', createMockSession(), '');
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
  });

  it('register adds custom command', async () => {
    const executor = new SystemCommandExecutor();
    executor.register({
      name: 'custom',
      description: 'Custom command',
      execute: () => ({ message: 'custom result', success: true }),
    });
    expect(executor.hasCommand('custom')).toBe(true);
    const result = await executor.execute('custom', createMockSession(), '');
    expect(result!.message).toBe('custom result');
  });
});
