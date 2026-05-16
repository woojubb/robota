import { describe, it, expect, vi } from 'vitest';
import { AgentExecutor } from '../agent-executor.js';
import type { IAgentHookDefinition, IHookInput } from '@robota-sdk/agent-core';

const makeInput = (overrides?: Partial<IHookInput>): IHookInput => ({
  session_id: 'test-session',
  cwd: '/tmp',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  ...overrides,
});

describe('AgentExecutor', () => {
  it('should have type "agent"', () => {
    const executor = new AgentExecutor({ sessionFactory: vi.fn() });
    expect(executor.type).toBe('agent');
  });

  it('should call session factory with maxTurns and timeout from definition', async () => {
    const mockSession = { run: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = {
      type: 'agent',
      agent: 'reviewer',
      maxTurns: 10,
      timeout: 30,
    };
    await executor.execute(definition, makeInput());

    expect(sessionFactory).toHaveBeenCalledWith({ maxTurns: 10, timeout: 30 });
  });

  it('should use default maxTurns 50 and timeout 60 when not specified', async () => {
    const mockSession = { run: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    await executor.execute(definition, makeInput());

    expect(sessionFactory).toHaveBeenCalledWith({ maxTurns: 50, timeout: 60 });
  });

  it('should pass hook input as prompt to session.run', async () => {
    const mockSession = { run: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const input = makeInput({ tool_name: 'Write' });
    await executor.execute(definition, input);

    const promptArg = mockSession.run.mock.calls[0][0] as string;
    expect(promptArg).toContain(JSON.stringify(input));
  });

  it('should return exitCode 0 when agent response has ok: true', async () => {
    const mockSession = { run: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"ok":true');
    expect(result.stderr).toBe('');
  });

  it('should return exitCode 2 with reason when agent response has ok: false', async () => {
    const response = JSON.stringify({ ok: false, reason: 'Code review failed' });
    const mockSession = { run: vi.fn().mockResolvedValue(response) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('Code review failed');
  });

  it('should return exitCode 2 with default reason when ok: false and no reason', async () => {
    const response = JSON.stringify({ ok: false });
    const mockSession = { run: vi.fn().mockResolvedValue(response) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('Blocked by agent hook');
  });

  it('should return exitCode 1 when session throws', async () => {
    const mockSession = { run: vi.fn().mockRejectedValue(new Error('Session timeout')) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Session timeout');
  });

  it('should return exitCode 1 when agent response is not valid JSON', async () => {
    const mockSession = { run: vi.fn().mockResolvedValue('not json') };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Failed to parse');
  });

  it('should handle JSON response embedded in markdown code blocks', async () => {
    const response = '```json\n{"ok": false, "reason": "nope"}\n```';
    const mockSession = { run: vi.fn().mockResolvedValue(response) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('nope');
  });
});
