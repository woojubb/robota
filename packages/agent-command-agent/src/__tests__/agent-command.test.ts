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
    createBackgroundJobGroup: vi.fn().mockReturnValue({
      id: 'group_1',
      parentSessionId: 'test-session-id',
      waitPolicy: 'wait_all',
      taskIds: ['agent_1', 'agent_2'],
      status: 'running',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      results: [],
    }),
    waitBackgroundJobGroup: vi.fn().mockResolvedValue({
      id: 'group_1',
      parentSessionId: 'test-session-id',
      waitPolicy: 'wait_all',
      taskIds: ['agent_1', 'agent_2'],
      status: 'completed',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:02.000Z',
      completedAt: '2026-05-01T00:00:02.000Z',
      results: [
        {
          taskId: 'agent_1',
          label: 'developer',
          status: 'completed',
          summary: 'developer summary',
        },
        {
          taskId: 'agent_2',
          label: 'designer',
          status: 'completed',
          summary: 'designer summary',
        },
      ],
    }),
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
    const coreModelCommands = coreExecutor
      .listModelInvocableCommands()
      .map((command) => command.name);

    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const modelCommands = executor.listModelInvocableCommands().map((command) => command.name);

    expect(executor.hasCommand('agent')).toBe(true);
    expect(modelCommands).toEqual([...coreModelCommands, '/agent']);
    expect(coreModelCommands).not.toContain('/agent');
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
    expect(agent?.description).toContain('Subagent jobs');
    expect(agent?.description).toContain('parallel');
    expect(agent?.description).toContain('consolidated');
    expect(agent?.description).toContain('When the user explicitly asks');
    expect(agent?.description).toContain('start the requested agent command immediately');
    expect(agent?.description).toContain('do not ask a follow-up question');
    expect(agent?.description).toContain('target selection inside the agent prompt');
    expect(agent?.description).not.toContain('<agent>');
    expect(agent?.description).not.toContain('XML/HTML');
    expect(agent?.argumentHint).toContain('PROMPT');
    expect(agent?.argumentHint).not.toContain('<');
  });

  it('spawns a background agent from direct natural-language /agent input', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute('agent', session, 'analyze the selected task');

    expect(result?.success).toBe(true);
    expect(result?.data?.agentId).toBe('agent_1');
    expect(
      (session as unknown as { spawnAgentJob: ReturnType<typeof vi.fn> }).spawnAgentJob,
    ).toHaveBeenCalledWith({
      agentType: 'general-purpose',
      label: 'general-purpose',
      mode: 'background',
      prompt: 'analyze the selected task',
    });
    expect(
      (session as unknown as { waitAgentJob: ReturnType<typeof vi.fn> }).waitAgentJob,
    ).not.toHaveBeenCalled();
  });

  it('uses plain placeholder names in usage errors', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const runResult = await executor.execute('agent', session, 'run');
    const parallelResult = await executor.execute('agent', session, 'parallel');

    expect(runResult?.message).toContain('AGENT_NAME');
    expect(parallelResult?.message).toContain('LABEL');
    expect(runResult?.message).not.toContain('<');
    expect(parallelResult?.message).not.toContain('<');
  });

  it('spawns a named background agent from direct /agent input', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute('agent', session, 'Plan "draft architecture"');

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
    expect(
      (session as unknown as { waitAgentJob: ReturnType<typeof vi.fn> }).waitAgentJob,
    ).not.toHaveBeenCalled();
  });

  it('keeps /agent run as a compatibility alias that defaults to background general-purpose', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute('agent', session, 'run "analyze this task"');

    expect(result?.success).toBe(true);
    expect(result?.data?.agentId).toBe('agent_1');
    expect(
      (session as unknown as { spawnAgentJob: ReturnType<typeof vi.fn> }).spawnAgentJob,
    ).toHaveBeenCalledWith({
      agentType: 'general-purpose',
      label: 'general-purpose',
      mode: 'background',
      prompt: 'analyze this task',
    });
  });

  it('does not treat the first natural-language token as an agent type for /agent run', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute('agent', session, 'run analyze this task');

    expect(result?.success).toBe(true);
    expect(
      (session as unknown as { spawnAgentJob: ReturnType<typeof vi.fn> }).spawnAgentJob,
    ).toHaveBeenCalledWith({
      agentType: 'general-purpose',
      label: 'general-purpose',
      mode: 'background',
      prompt: 'analyze this task',
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
      waitBackgroundJobGroup: vi.fn().mockImplementation((groupId: string) => {
        callOrder.push(`wait-group:${groupId}`);
        return Promise.resolve({
          id: groupId,
          parentSessionId: 'test-session-id',
          waitPolicy: 'wait_all',
          taskIds: ['agent_1', 'agent_2'],
          status: 'completed',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:02.000Z',
          completedAt: '2026-05-01T00:00:02.000Z',
          results: [],
        });
      }),
    });

    const result = await executor.execute(
      'agent',
      session,
      'parallel developer=general-purpose:"implementation risks" designer=Plan:"architecture boundaries"',
    );

    expect(result?.success).toBe(true);
    expect(result?.data?.agentIds).toEqual(['agent_1', 'agent_2']);
    expect(result?.data?.groupId).toBe('group_1');
    expect(
      (session as unknown as { createBackgroundJobGroup: ReturnType<typeof vi.fn> })
        .createBackgroundJobGroup,
    ).toHaveBeenCalledWith({
      waitPolicy: 'wait_all',
      taskIds: ['agent_1', 'agent_2'],
      label: 'agent parallel',
    });
    expect(callOrder).toEqual(['spawn:developer', 'spawn:designer', 'wait-group:group_1']);
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
      'parallel developer:"implementation risks" designer:"architecture boundaries"',
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

  it('waits for a parallel group when --wait is requested', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute(
      'agent',
      session,
      'parallel --wait developer:"implementation risks" designer=Plan:"architecture boundaries"',
    );

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Background job group group_1: completed');
    expect(result?.message).toContain('[completed] developer agent_1: developer summary');
    expect(
      (session as unknown as { waitBackgroundJobGroup: ReturnType<typeof vi.fn> })
        .waitBackgroundJobGroup,
    ).toHaveBeenCalledWith('group_1');
  });

  it('waits for a parallel group by default so model-routed calls produce a consolidated result', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute(
      'agent',
      session,
      'parallel developer:"implementation risks" designer=Plan:"architecture boundaries"',
    );

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Background job group group_1: completed');
    expect(result?.message).toContain('[completed] developer agent_1: developer summary');
    expect(
      (session as unknown as { waitBackgroundJobGroup: ReturnType<typeof vi.fn> })
        .waitBackgroundJobGroup,
    ).toHaveBeenCalledWith('group_1');
  });

  it('detaches a parallel group only when --detach is explicit', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute(
      'agent',
      session,
      'parallel --detach developer:"implementation risks" designer=Plan:"architecture boundaries"',
    );

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Started agent jobs:');
    expect(result?.data?.groupId).toBe('group_1');
    expect(
      (session as unknown as { waitBackgroundJobGroup: ReturnType<typeof vi.fn> })
        .waitBackgroundJobGroup,
    ).not.toHaveBeenCalled();
  });

  it('waits for an existing agent group by id', async () => {
    const module = createAgentCommandModule();
    const executor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...(module.systemCommands ?? []),
    ]);
    const session = createMockSession();

    const result = await executor.execute('agent', session, 'wait group_1');

    expect(result?.success).toBe(true);
    expect(result?.data?.groupId).toBe('group_1');
    expect(result?.message).toContain('[completed] designer agent_2: designer summary');
    expect(
      (session as unknown as { waitBackgroundJobGroup: ReturnType<typeof vi.fn> })
        .waitBackgroundJobGroup,
    ).toHaveBeenCalledWith('group_1');
  });
});
