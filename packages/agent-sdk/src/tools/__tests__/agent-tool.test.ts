/**
 * Tests for the Agent tool — spawn a subagent with isolated context
 * using createSubagentSession-based execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IAIProvider, IToolWithEventService } from '@robota-sdk/agent-core';
import type { IToolResult } from '@robota-sdk/agent-core';
import type { ITerminalOutput, TPermissionHandler } from '@robota-sdk/agent-sessions';
import type { IAgentDefinition } from '../../agents/agent-definition-types.js';
import type { IResolvedConfig } from '../../config/config-types.js';
import type { ILoadedContext } from '../../context/context-loader.js';

const mockProvider = {
  generateResponse: vi.fn(),
} as unknown as IAIProvider;

// Mock createSubagentSession
const mockRun = vi.fn().mockResolvedValue('task completed successfully');
const mockSessionInstance = { run: mockRun };
vi.mock('../../assembly/create-subagent-session.js', () => ({
  createSubagentSession: vi.fn(() => mockSessionInstance),
}));

// Mock getBuiltInAgent
vi.mock('../../agents/built-in-agents.js', () => ({
  getBuiltInAgent: vi.fn((name: string) => {
    const agents: Record<string, IAgentDefinition> = {
      'general-purpose': {
        name: 'general-purpose',
        description: 'General-purpose agent',
        systemPrompt: 'You are a general agent.',
      },
      Explore: {
        name: 'Explore',
        description: 'Exploration agent',
        systemPrompt: 'You are an explorer.',
      },
      Plan: {
        name: 'Plan',
        description: 'Planning agent',
        systemPrompt: 'You are a planner.',
      },
    };
    return agents[name];
  }),
}));

import { createAgentTool } from '../agent-tool.js';
import type { IAgentToolDeps } from '../agent-tool.js';
import { createSubagentSession } from '../../assembly/create-subagent-session.js';
import { getBuiltInAgent } from '../../agents/built-in-agents.js';
import type { ISubagentManager } from '../../subagents/index.js';

/** Extract the JSON-parsed data from an IToolResult */
function parseToolResult(toolResult: IToolResult): Record<string, unknown> {
  return JSON.parse(toolResult.data as string);
}

function makeTool(name: string): IToolWithEventService {
  return {
    getName: () => name,
    getDescription: () => `Mock ${name} tool`,
    schema: {
      name,
      description: `Mock ${name} tool`,
      parameters: { type: 'object', properties: {} },
    },
    execute: vi.fn(),
    validate: vi.fn(() => true),
    validateParameters: vi.fn(() => ({ valid: true, errors: [] })),
    setEventService: vi.fn(),
  } as unknown as IToolWithEventService;
}

function makeTerminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    spinner: vi.fn(),
  } as unknown as ITerminalOutput;
}

function makeConfig(overrides?: Partial<IResolvedConfig>): IResolvedConfig {
  return {
    defaultTrustLevel: 'moderate',
    provider: { name: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'test-key' },
    permissions: { allow: [], deny: [] },
    env: {},
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ILoadedContext>): ILoadedContext {
  return {
    agentsMd: '# AGENTS.md',
    claudeMd: '# CLAUDE.md',
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<IAgentToolDeps>): IAgentToolDeps {
  return {
    config: makeConfig(),
    context: makeContext(),
    tools: [makeTool('Read')],
    terminal: makeTerminal(),
    provider: mockProvider,
    ...overrides,
  };
}

describe('Agent tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue('task completed successfully');
  });

  it('should have correct name and parameter schema', () => {
    const tool = createAgentTool(makeDeps());
    expect(tool.getName()).toBe('Agent');
    const schema = tool.schema;
    expect(schema.name).toBe('Agent');
    expect(schema.description).toContain('subagent');
    expect(schema.description).toContain('one subagent job');
    expect(schema.description).toContain('terminal result');
    expect(schema.description).toContain('terminal result');
    expect(schema.description).toContain('tool call');
    expect(schema.description).toContain('When the user explicitly asks');
    expect(schema.description).toContain('start the requested subagent job immediately');
    expect(schema.description).toContain('Do not ask a follow-up question');
    expect(schema.description).toContain('one Agent tool call per requested role');
    expect(schema.description).not.toContain('<agent');
    expect(schema.description).not.toContain('pseudo-tags');
    // Verify parameters include prompt, subagent_type, model
    const props = schema.parameters.properties;
    expect(props).toHaveProperty('prompt');
    expect(props).toHaveProperty('subagent_type');
    expect(props).toHaveProperty('model');
    expect(props).not.toHaveProperty('parallel');
    expect(props).not.toHaveProperty('background');
    expect(props).not.toHaveProperty('detach');
    expect(props).toHaveProperty('isolation');
  });

  it('should resolve built-in agent type "Explore"', async () => {
    const tools = [makeTool('Read'), makeTool('Grep')];
    const config = makeConfig();
    const context = makeContext();
    const terminal = makeTerminal();
    const permissionHandler: TPermissionHandler = vi.fn();

    const tool = createAgentTool({
      config,
      context,
      tools,
      terminal,
      provider: mockProvider,
      permissionHandler,
    });

    await tool.execute({
      prompt: 'Find all test files',
      subagent_type: 'Explore',
    });

    expect(getBuiltInAgent).toHaveBeenCalledWith('Explore');
    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinition: expect.objectContaining({ name: 'Explore' }),
        parentConfig: config,
        parentContext: context,
        parentTools: tools,
        terminal,
        permissionHandler,
      }),
    );
  });

  it('should default to general-purpose when no subagent_type', async () => {
    const tools = [makeTool('Read')];
    const config = makeConfig();
    const context = makeContext();

    const tool = createAgentTool({
      config,
      context,
      tools,
      terminal: makeTerminal(),
      provider: mockProvider,
    });

    await tool.execute({ prompt: 'Do something' });

    expect(getBuiltInAgent).toHaveBeenCalledWith('general-purpose');
  });

  it('should return response with agentId', async () => {
    const tool = createAgentTool(makeDeps());

    const toolResult = await tool.execute({ prompt: 'Do task' });
    const result = parseToolResult(toolResult);

    expect(result['success']).toBe(true);
    expect(result['output']).toBe('task completed successfully');
    expect(result['agentId']).toBeDefined();
    expect(result['agentId']).toMatch(/^agent_/);
  });

  it('should route execution through injected SubagentManager in background mode', async () => {
    const subagentManager = {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent_managed_1',
        type: 'Explore',
        label: 'Explore',
        parentSessionId: 'session_parent',
        status: 'running',
        mode: 'background',
        depth: 1,
        cwd: '/workspace',
        promptPreview: 'Find files',
        updatedAt: '2026-04-30T00:00:00.000Z',
      }),
      wait: vi.fn().mockResolvedValue({
        jobId: 'agent_managed_1',
        output: 'managed output',
      }),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      shutdown: vi.fn(),
    };

    const tool = createAgentTool(
      makeDeps({
        cwd: '/workspace',
        parentSessionId: 'session_parent',
        subagentManager,
      }),
    );

    const toolResult = await tool.execute({
      prompt: 'Find files',
      subagent_type: 'Explore',
    });
    const result = parseToolResult(toolResult);

    expect(subagentManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Explore',
        label: 'Explore',
        parentSessionId: 'session_parent',
        mode: 'background',
        depth: 1,
        cwd: '/workspace',
        prompt: 'Find files',
      }),
    );
    expect(subagentManager.wait).toHaveBeenCalledWith('agent_managed_1');
    expect(createSubagentSession).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      output: 'managed output',
      agentId: 'agent_managed_1',
    });
  });

  it('should forward worktree isolation and return handoff metadata', async () => {
    const subagentManager: ISubagentManager = {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent_worktree_1',
        type: 'Explore',
        label: 'Explore',
        parentSessionId: 'session_parent',
        status: 'running',
        mode: 'background',
        depth: 1,
        cwd: '/workspace',
        isolation: 'worktree',
        promptPreview: 'Change files',
        updatedAt: '2026-04-30T00:00:00.000Z',
      }),
      wait: vi.fn().mockResolvedValue({
        jobId: 'agent_worktree_1',
        output: 'changed files',
        metadata: {
          worktreePath: '/workspace/.robota/worktrees/agent_worktree_1',
          branchName: 'robota/agent_worktree_1',
        },
      }),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      shutdown: vi.fn(),
    };

    const tool = createAgentTool(
      makeDeps({
        cwd: '/workspace',
        parentSessionId: 'session_parent',
        subagentManager,
      }),
    );

    const toolResult = await tool.execute({
      prompt: 'Change files',
      subagent_type: 'Explore',
      isolation: 'worktree',
    });
    const result = parseToolResult(toolResult);

    expect(subagentManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Explore',
        prompt: 'Change files',
        isolation: 'worktree',
      }),
    );
    expect(result).toEqual({
      success: true,
      output: 'changed files',
      agentId: 'agent_worktree_1',
      metadata: {
        worktreePath: '/workspace/.robota/worktrees/agent_worktree_1',
        branchName: 'robota/agent_worktree_1',
      },
      worktreePath: '/workspace/.robota/worktrees/agent_worktree_1',
      branchName: 'robota/agent_worktree_1',
    });
  });

  it('should default to background mode and wait when background is omitted', async () => {
    const subagentManager = {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent_background_1',
        type: 'Explore',
        label: 'Explore',
        parentSessionId: 'session_parent',
        status: 'running',
        mode: 'background',
        depth: 1,
        cwd: '/workspace',
        promptPreview: 'Find files',
        updatedAt: '2026-04-30T00:00:00.000Z',
      }),
      wait: vi.fn().mockResolvedValue({
        jobId: 'agent_background_1',
        output: 'background output',
      }),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      shutdown: vi.fn(),
    };

    const tool = createAgentTool(
      makeDeps({
        cwd: '/workspace',
        parentSessionId: 'session_parent',
        subagentManager,
      }),
    );

    const toolResult = await tool.execute({
      prompt: 'Find files',
      subagent_type: 'Explore',
    });
    const result = parseToolResult(toolResult);

    expect(subagentManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Explore',
        mode: 'background',
        prompt: 'Find files',
      }),
    );
    expect(subagentManager.wait).toHaveBeenCalledWith('agent_background_1');
    expect(result).toEqual({
      success: true,
      output: 'background output',
      agentId: 'agent_background_1',
    });
  });

  it('should ignore undeclared background mode input and wait for terminal result', async () => {
    const subagentManager = {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent_background_2',
        type: 'Explore',
        label: 'Explore',
        parentSessionId: 'session_parent',
        status: 'running',
        mode: 'background',
        depth: 1,
        cwd: '/workspace',
        promptPreview: 'Find files',
        updatedAt: '2026-04-30T00:00:00.000Z',
      }),
      wait: vi.fn().mockResolvedValue({
        jobId: 'agent_background_2',
        output: 'explicit background output',
      }),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      shutdown: vi.fn(),
    };

    const tool = createAgentTool(
      makeDeps({
        cwd: '/workspace',
        parentSessionId: 'session_parent',
        subagentManager,
      }),
    );

    const toolResult = await tool.execute({
      prompt: 'Find files',
      subagent_type: 'Explore',
      background: true,
    });
    const result = parseToolResult(toolResult);

    expect(subagentManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Explore',
        mode: 'background',
        prompt: 'Find files',
      }),
    );
    expect(subagentManager.wait).toHaveBeenCalledWith('agent_background_2');
    expect(result).toEqual({
      success: true,
      output: 'explicit background output',
      agentId: 'agent_background_2',
    });
  });

  it('should ignore undeclared detach input and wait for terminal result', async () => {
    const subagentManager = {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent_detached_1',
        type: 'Explore',
        label: 'Explore',
        parentSessionId: 'session_parent',
        status: 'running',
        mode: 'background',
        depth: 1,
        cwd: '/workspace',
        promptPreview: 'Find files',
        updatedAt: '2026-04-30T00:00:00.000Z',
      }),
      wait: vi.fn().mockResolvedValue({
        jobId: 'agent_detached_1',
        output: 'detached input still waited',
      }),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      shutdown: vi.fn(),
    };

    const tool = createAgentTool(
      makeDeps({
        cwd: '/workspace',
        parentSessionId: 'session_parent',
        subagentManager,
      }),
    );

    const toolResult = await tool.execute({
      prompt: 'Find files',
      subagent_type: 'Explore',
      detach: true,
    });
    const result = parseToolResult(toolResult);

    expect(subagentManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Explore',
        mode: 'background',
        prompt: 'Find files',
      }),
    );
    expect(subagentManager.wait).toHaveBeenCalledWith('agent_detached_1');
    expect(result).toEqual({
      success: true,
      output: 'detached input still waited',
      agentId: 'agent_detached_1',
    });
  });

  it('should return a failed terminal result when a background subagent times out', async () => {
    const subagentManager = {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent_timeout_1',
        type: 'Explore',
        label: 'Explore',
        parentSessionId: 'session_parent',
        status: 'running',
        mode: 'background',
        depth: 1,
        cwd: '/workspace',
        promptPreview: 'Find files',
        updatedAt: '2026-04-30T00:00:00.000Z',
      }),
      wait: vi
        .fn()
        .mockRejectedValue(new Error('Background agent produced no activity for 120000ms')),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      shutdown: vi.fn(),
    };

    const tool = createAgentTool(
      makeDeps({
        cwd: '/workspace',
        parentSessionId: 'session_parent',
        subagentManager,
      }),
    );

    const toolResult = await tool.execute({
      prompt: 'Find files',
      subagent_type: 'Explore',
    });
    const result = parseToolResult(toolResult);

    expect(subagentManager.wait).toHaveBeenCalledWith('agent_timeout_1');
    expect(result['success']).toBe(false);
    expect(result['agentId']).toBe('agent_timeout_1');
    expect(result['error']).toContain('Background agent produced no activity');
  });

  it('should return terminal results for parallel direct Agent tool calls including timeouts', async () => {
    const subagentManager = {
      spawn: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'agent_parallel_1',
          type: 'Explore',
          label: 'Explore',
          parentSessionId: 'session_parent',
          status: 'running',
          mode: 'background',
          depth: 1,
          cwd: '/workspace',
          promptPreview: 'Developer analysis',
          updatedAt: '2026-04-30T00:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'agent_parallel_2',
          type: 'Plan',
          label: 'Plan',
          parentSessionId: 'session_parent',
          status: 'running',
          mode: 'background',
          depth: 1,
          cwd: '/workspace',
          promptPreview: 'Designer analysis',
          updatedAt: '2026-04-30T00:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'agent_parallel_3',
          type: 'Explore',
          label: 'Explore',
          parentSessionId: 'session_parent',
          status: 'running',
          mode: 'background',
          depth: 1,
          cwd: '/workspace',
          promptPreview: 'Risk analysis',
          updatedAt: '2026-04-30T00:00:00.000Z',
        }),
      wait: vi
        .fn()
        .mockResolvedValueOnce({
          jobId: 'agent_parallel_1',
          output: 'developer complete',
        })
        .mockResolvedValueOnce({
          jobId: 'agent_parallel_2',
          output: 'designer complete',
        })
        .mockRejectedValueOnce(new Error('Background agent produced no activity for 120000ms')),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      shutdown: vi.fn(),
    };

    const tool = createAgentTool(
      makeDeps({
        cwd: '/workspace',
        parentSessionId: 'session_parent',
        subagentManager,
      }),
    );

    const [developerResult, designerResult, timeoutResult] = await Promise.all([
      tool.execute({
        prompt: 'Developer analysis',
        subagent_type: 'Explore',
      }),
      tool.execute({
        prompt: 'Designer analysis',
        subagent_type: 'Plan',
      }),
      tool.execute({
        prompt: 'Risk analysis',
        subagent_type: 'Explore',
      }),
    ]);

    expect(subagentManager.wait).toHaveBeenCalledTimes(3);
    expect(subagentManager.wait).toHaveBeenNthCalledWith(1, 'agent_parallel_1');
    expect(subagentManager.wait).toHaveBeenNthCalledWith(2, 'agent_parallel_2');
    expect(subagentManager.wait).toHaveBeenNthCalledWith(3, 'agent_parallel_3');
    expect(parseToolResult(developerResult)).toEqual({
      success: true,
      output: 'developer complete',
      agentId: 'agent_parallel_1',
    });
    expect(parseToolResult(designerResult)).toEqual({
      success: true,
      output: 'designer complete',
      agentId: 'agent_parallel_2',
    });
    const timedOut = parseToolResult(timeoutResult);
    expect(timedOut['success']).toBe(false);
    expect(timedOut['agentId']).toBe('agent_parallel_3');
    expect(timedOut['error']).toContain('Background agent produced no activity');
  });

  it('should ignore undeclared model-emitted orchestration hints without changing single-call execution', async () => {
    const subagentManager = {
      spawn: vi.fn().mockResolvedValue({
        id: 'agent_parallel_hint_1',
        type: 'Explore',
        label: 'Explore',
        parentSessionId: 'session_parent',
        status: 'running',
        mode: 'background',
        depth: 1,
        cwd: '/workspace',
        promptPreview: 'Explore in parallel',
        updatedAt: '2026-04-30T00:00:00.000Z',
      }),
      wait: vi.fn().mockResolvedValue({
        jobId: 'agent_parallel_hint_1',
        output: 'parallel hint complete',
      }),
      list: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
      shutdown: vi.fn(),
    };

    const tool = createAgentTool(
      makeDeps({
        cwd: '/workspace',
        parentSessionId: 'session_parent',
        subagentManager,
      }),
    );

    const toolResult = await tool.execute({
      prompt: 'Explore in parallel',
      subagent_type: 'Explore',
      parallel: true,
      background: true,
      detach: true,
    });

    expect(subagentManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Explore',
        mode: 'background',
        prompt: 'Explore in parallel',
      }),
    );
    expect(subagentManager.wait).toHaveBeenCalledWith('agent_parallel_hint_1');
    expect(parseToolResult(toolResult)).toEqual({
      success: true,
      output: 'parallel hint complete',
      agentId: 'agent_parallel_hint_1',
    });
  });

  it('should return error for unknown agent type', async () => {
    const tool = createAgentTool(makeDeps());

    const toolResult = await tool.execute({
      prompt: 'Do task',
      subagent_type: 'nonexistent',
    });
    const result = parseToolResult(toolResult);

    expect(result['success']).toBe(false);
    expect(result['error']).toContain('Unknown agent type');
    expect(result['error']).toContain('nonexistent');
  });

  it('should apply model override from tool args', async () => {
    const tool = createAgentTool(makeDeps());

    await tool.execute({
      prompt: 'Do task',
      subagent_type: 'general-purpose',
      model: 'haiku',
    });

    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinition: expect.objectContaining({
          name: 'general-purpose',
          model: 'haiku',
        }),
      }),
    );
  });

  it('should pass onTextDelta and onToolExecution callbacks', async () => {
    const onTextDelta = vi.fn();
    const onToolExecution = vi.fn();

    const tool = createAgentTool(
      makeDeps({
        onTextDelta,
        onToolExecution,
      }),
    );

    await tool.execute({ prompt: 'Do task' });

    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        onTextDelta: expect.any(Function),
        onToolExecution: expect.any(Function),
      }),
    );

    const sessionOptions = vi.mocked(createSubagentSession).mock.calls[0]?.[0];
    expect(sessionOptions).toBeDefined();
    if (!sessionOptions) throw new Error('Expected subagent session options');

    sessionOptions.onTextDelta?.('streamed chunk');
    sessionOptions.onToolExecution?.({
      type: 'start',
      toolName: 'Read',
      toolArgs: { file_path: 'README.md' },
    });

    expect(onTextDelta).toHaveBeenCalledWith('streamed chunk');
    expect(onToolExecution).toHaveBeenCalledWith({
      type: 'start',
      toolName: 'Read',
      toolArgs: { file_path: 'README.md' },
    });
  });

  it('should handle session.run error gracefully', async () => {
    mockRun.mockRejectedValueOnce(new Error('Provider timeout'));

    const tool = createAgentTool(makeDeps());

    const toolResult = await tool.execute({ prompt: 'Do task' });
    const result = parseToolResult(toolResult);

    expect(result['success']).toBe(false);
    expect(result['error']).toContain('Provider timeout');
    expect(result['agentId']).toBeDefined();
  });

  it('should use custom agent registry for non-built-in types', async () => {
    const customAgent: IAgentDefinition = {
      name: 'CustomWorker',
      description: 'A custom worker',
      systemPrompt: 'You are custom.',
    };
    const customRegistry = vi.fn().mockReturnValue(customAgent);

    const tool = createAgentTool(makeDeps({ customAgentRegistry: customRegistry }));

    await tool.execute({
      prompt: 'Custom task',
      subagent_type: 'CustomWorker',
    });

    expect(customRegistry).toHaveBeenCalledWith('CustomWorker');
    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinition: expect.objectContaining({ name: 'CustomWorker' }),
      }),
    );
  });

  it('should create independent tool instances per factory call', () => {
    const deps1 = makeDeps({ config: makeConfig({ defaultTrustLevel: 'moderate' }) });
    const deps2 = makeDeps({ config: makeConfig({ defaultTrustLevel: 'full' }) });

    const tool1 = createAgentTool(deps1);
    const tool2 = createAgentTool(deps2);

    // Both tools exist independently
    expect(tool1.getName()).toBe('Agent');
    expect(tool2.getName()).toBe('Agent');
    // They are distinct instances
    expect(tool1).not.toBe(tool2);
  });

  it('should handle session.run throwing a non-Error value', async () => {
    mockRun.mockRejectedValueOnce('string error without Error object');

    const tool = createAgentTool(makeDeps());

    const toolResult = await tool.execute({ prompt: 'Do task' });
    const result = parseToolResult(toolResult);

    expect(result['success']).toBe(false);
    expect(result['error']).toContain('string error without Error object');
    expect(result['agentId']).toBeDefined();
  });

  it('should return error when custom registry also returns undefined', async () => {
    const customRegistry = vi.fn().mockReturnValue(undefined);

    const tool = createAgentTool(makeDeps({ customAgentRegistry: customRegistry }));

    const toolResult = await tool.execute({
      prompt: 'Do task',
      subagent_type: 'totally-unknown',
    });
    const result = parseToolResult(toolResult);

    expect(result['success']).toBe(false);
    expect(result['error']).toContain('Unknown agent type: totally-unknown');
    expect(customRegistry).toHaveBeenCalledWith('totally-unknown');
  });

  it('should not override model when model arg is not provided', async () => {
    const tool = createAgentTool(makeDeps());

    await tool.execute({
      prompt: 'Do task',
      subagent_type: 'Explore',
      // no model arg
    });

    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinition: expect.objectContaining({
          name: 'Explore',
        }),
      }),
    );
    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinition: expect.not.objectContaining({
          model: expect.any(String),
        }),
      }),
    );
  });

  it('should prefer custom registry over built-in when both match', async () => {
    const customAgent: IAgentDefinition = {
      name: 'Explore',
      description: 'Custom explore',
      systemPrompt: 'Custom prompt.',
    };
    const customRegistry = vi.fn().mockReturnValue(customAgent);

    const tool = createAgentTool(makeDeps({ customAgentRegistry: customRegistry }));

    await tool.execute({
      prompt: 'Explore task',
      subagent_type: 'Explore',
    });

    expect(customRegistry).toHaveBeenCalledWith('Explore');
    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinition: expect.objectContaining({
          name: 'Explore',
          description: 'Custom explore',
        }),
      }),
    );
  });

  it('should generate unique agentIds across calls', async () => {
    const tool = createAgentTool(makeDeps());

    const result1 = parseToolResult(await tool.execute({ prompt: 'Task 1' }));
    const result2 = parseToolResult(await tool.execute({ prompt: 'Task 2' }));

    expect(result1['agentId']).not.toBe(result2['agentId']);
  });

  it('should not include agentId in error result for unknown agent type', async () => {
    const tool = createAgentTool(makeDeps());

    const toolResult = await tool.execute({
      prompt: 'Do task',
      subagent_type: 'nonexistent',
    });
    const result = parseToolResult(toolResult);

    // Unknown agent type error should NOT have agentId (happens before session creation)
    expect(result['agentId']).toBeUndefined();
  });

  it('should pass isForkWorker as undefined (not fork) to createSubagentSession', async () => {
    const tool = createAgentTool(makeDeps());

    await tool.execute({ prompt: 'Do task' });

    // Agent tool never sets isForkWorker (only useSubmitHandler fork runner does)
    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ isForkWorker: true }),
    );
  });
});
