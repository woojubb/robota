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

  it('should allow when agent response has ok: true', async () => {
    const mockSession = { run: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.outcome).toBe('allow');
    expect(result.outcome === 'allow' && result.stdout).toContain('"ok":true');
  });

  it('should deny with the reason when agent response has ok: false', async () => {
    const response = JSON.stringify({ ok: false, reason: 'Code review failed' });
    const mockSession = { run: vi.fn().mockResolvedValue(response) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.outcome).toBe('deny');
    expect(result.outcome === 'deny' && result.reason).toBe('Code review failed');
  });

  it('should deny with a default reason when ok: false and no reason', async () => {
    const response = JSON.stringify({ ok: false });
    const mockSession = { run: vi.fn().mockResolvedValue(response) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.outcome).toBe('deny');
    expect(result.outcome === 'deny' && result.reason).toBe('Blocked by agent hook');
  });

  it('should error when session throws', async () => {
    const mockSession = { run: vi.fn().mockRejectedValue(new Error('Session timeout')) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.outcome).toBe('error');
    expect(result.outcome === 'error' && result.kind).toBe('transport-failure');
    expect(result.outcome === 'error' && result.reason).toBe('Session timeout');
  });

  it('should error when agent response is not valid JSON', async () => {
    const mockSession = { run: vi.fn().mockResolvedValue('not json') };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.outcome).toBe('error');
    expect(result.outcome === 'error' && result.kind).toBe('malformed-response');
    expect(result.outcome === 'error' && result.reason).toContain('not valid JSON');
  });

  it('should handle JSON response embedded in markdown code blocks', async () => {
    const response = '```json\n{"ok": false, "reason": "nope"}\n```';
    const mockSession = { run: vi.fn().mockResolvedValue(response) };
    const sessionFactory = vi.fn().mockReturnValue(mockSession);
    const executor = new AgentExecutor({ sessionFactory });

    const definition: IAgentHookDefinition = { type: 'agent', agent: 'reviewer' };
    const result = await executor.execute(definition, makeInput());

    expect(result.outcome).toBe('deny');
    expect(result.outcome === 'deny' && result.reason).toBe('nope');
  });
});
