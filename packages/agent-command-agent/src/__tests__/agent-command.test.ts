import { describe, expect, it, vi } from 'vitest';
import {
  CommandRegistry,
  SystemCommandExecutor,
  createSystemCommands,
} from '@robota-sdk/agent-sdk';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import { createAgentCommandModule } from '../agent-command-module.js';

function createMockSession(overrides?: Record<string, unknown>): InteractiveSession {
  const session = {
    listAgentDefinitions: vi.fn().mockReturnValue([
      { name: 'general-purpose', description: 'General-purpose task execution agent.' },
      { name: 'Plan', description: 'Read-only planning agent.' },
    ]),
    listAgentJobs: vi.fn().mockReturnValue([]),
    readBackgroundTaskLog: vi.fn().mockResolvedValue({ taskId: 'agent_1', lines: [] }),
    spawnAgentJob: vi.fn().mockResolvedValue({
      id: 'agent_1',
      type: 'Plan',
      label: 'Plan',
      parentSessionId: 'test-session-id',
      status: 'running',
      mode: 'background',
      depth: 1,
      cwd: '/workspace',
      promptPreview: 'draft architecture',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }),
    waitAgentJob: vi.fn(),
    sendAgentJob: vi.fn(),
    cancelAgentJob: vi.fn(),
    closeAgentJob: vi.fn(),
    ...overrides,
  };
  return session as unknown as InteractiveSession;
}

describe('agent command module', () => {
  it('contributes /agent without changing SDK core commands', () => {
    const coreExecutor = new SystemCommandExecutor(createSystemCommands());
    expect(coreExecutor.hasCommand('agent')).toBe(false);

    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);

    expect(executor.hasCommand('agent')).toBe(true);
    expect(executor.listModelInvocableCommands().map((command) => command.name)).toEqual([
      '/agent',
    ]);
  });

  it('requests agent runtime wiring through the command module contract', () => {
    const module = createAgentCommandModule();

    expect(module.sessionRequirements).toEqual(['agent-runtime']);
    expect(module.commandSources).toHaveLength(1);
    expect(module.systemCommands).toHaveLength(1);
  });

  it('projects /agent from its injected command source', () => {
    const module = createAgentCommandModule();
    const registry = new CommandRegistry();
    registry.addModule(module);

    const agent = registry
      .getCapabilityDescriptors()
      .find((descriptor) => descriptor.name === '/agent');

    expect(agent).toMatchObject({
      kind: 'builtin-command',
      userInvocable: true,
      modelInvocable: true,
      safety: 'background-agent',
    });
    expect(agent?.description).toContain('subagent jobs');
    expect(agent?.description).toContain('ExecuteCommand');
    expect(agent?.description).toContain('<agent>');
    expect(agent?.argumentHint).toContain('run [<agent>]');
  });

  it('spawns a background agent and returns the agentId', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute(
      'agent',
      session,
      'run Plan --background "draft architecture"',
    );

    expect(result?.success).toBe(true);
    expect(result?.data?.agentId).toBe('agent_1');
    expect(
      (session as unknown as { spawnAgentJob: ReturnType<typeof vi.fn> }).spawnAgentJob,
    ).toHaveBeenCalledWith({
      agentType: 'Plan',
      label: 'Plan',
      mode: 'background',
      prompt: 'draft architecture',
    });
  });

  it('defaults /agent run prompt-only syntax to general-purpose', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute('agent', session, 'run --background "이걸로 분석해"');

    expect(result?.success).toBe(true);
    expect(result?.data?.agentId).toBe('agent_1');
    expect(
      (session as unknown as { spawnAgentJob: ReturnType<typeof vi.fn> }).spawnAgentJob,
    ).toHaveBeenCalledWith({
      agentType: 'general-purpose',
      label: 'general-purpose',
      mode: 'background',
      prompt: '이걸로 분석해',
    });
  });

  it('returns a command failure for explicit unknown agent types instead of throwing', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute(
      'agent',
      session,
      'run --agent missing --background "draft architecture"',
    );

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('Unknown agent type: missing');
    expect(
      (session as unknown as { spawnAgentJob: ReturnType<typeof vi.fn> }).spawnAgentJob,
    ).not.toHaveBeenCalled();
  });

  it('spawns every parallel background job before any wait path', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const callOrder: string[] = [];
    const session = createMockSession({
      spawnAgentJob: vi.fn().mockImplementation((request: { label: string }) => {
        callOrder.push(`spawn:${request.label}`);
        return Promise.resolve({
          id: `agent_${callOrder.length}`,
          type: request.label,
          label: request.label,
          parentSessionId: 'test-session-id',
          status: 'running',
          mode: 'background',
          depth: 1,
          cwd: '/workspace',
          promptPreview: request.label,
          updatedAt: '2026-05-01T00:00:00.000Z',
        });
      }),
      waitAgentJob: vi.fn().mockImplementation((jobId: string) => {
        callOrder.push(`wait:${jobId}`);
        return Promise.resolve({ jobId, output: 'done' });
      }),
    });

    const result = await executor.execute(
      'agent',
      session,
      'parallel developer=general-purpose:"implementation risks" designer=Plan:"architecture boundaries" --background',
    );

    expect(result?.success).toBe(true);
    expect(result?.data?.agentIds).toEqual(['agent_1', 'agent_2']);
    expect(callOrder).toEqual(['spawn:developer', 'spawn:designer']);
  });

  it('supports simple parallel label prompt syntax with default agent type', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute(
      'agent',
      session,
      'parallel developer:"implementation risks" designer:"architecture boundaries" --background',
    );

    expect(result?.success).toBe(true);
    const spawnAgentJob = (session as unknown as { spawnAgentJob: ReturnType<typeof vi.fn> })
      .spawnAgentJob;
    expect(spawnAgentJob).toHaveBeenNthCalledWith(1, {
      agentType: 'general-purpose',
      label: 'developer',
      mode: 'background',
      prompt: 'implementation risks',
    });
    expect(spawnAgentJob).toHaveBeenNthCalledWith(2, {
      agentType: 'general-purpose',
      label: 'designer',
      mode: 'background',
      prompt: 'architecture boundaries',
    });
  });
});
