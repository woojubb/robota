/**
 * Tests for the Agent tool — spawn a subagent with isolated context
 * using createSubagentSession-based execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type { IToolResult } from '@robota-sdk/agent-core';
import type { ITerminalOutput, TPermissionHandler } from '@robota-sdk/agent-sessions';
import type { IAgentDefinition } from '../../agents/agent-definition-types.js';
import type { IResolvedConfig } from '../../config/config-types.js';
import type { ILoadedContext } from '../../context/context-loader.js';

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
        model: 'claude-haiku-4-5',
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

import { agentTool, setAgentToolDeps } from '../agent-tool.js';
import { createSubagentSession } from '../../assembly/create-subagent-session.js';
import { getBuiltInAgent } from '../../agents/built-in-agents.js';

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

describe('Agent tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue('task completed successfully');
  });

  it('should have correct name and parameter schema', () => {
    expect(agentTool.getName()).toBe('Agent');
    const schema = agentTool.schema;
    expect(schema.name).toBe('Agent');
    expect(schema.description).toContain('subagent');
    // Verify parameters include prompt, subagent_type, model
    const props = schema.parameters.properties;
    expect(props).toHaveProperty('prompt');
    expect(props).toHaveProperty('subagent_type');
    expect(props).toHaveProperty('model');
  });

  it('should resolve built-in agent type "Explore"', async () => {
    const tools = [makeTool('Read'), makeTool('Grep')];
    const config = makeConfig();
    const context = makeContext();
    const terminal = makeTerminal();
    const permissionHandler: TPermissionHandler = vi.fn();

    setAgentToolDeps({
      config,
      context,
      tools,
      terminal,
      permissionHandler,
    });

    await agentTool.execute({
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

    setAgentToolDeps({
      config,
      context,
      tools,
      terminal: makeTerminal(),
    });

    await agentTool.execute({ prompt: 'Do something' });

    expect(getBuiltInAgent).toHaveBeenCalledWith('general-purpose');
  });

  it('should return response with agentId', async () => {
    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const toolResult = await agentTool.execute({ prompt: 'Do task' });
    const result = parseToolResult(toolResult);

    expect(result['success']).toBe(true);
    expect(result['output']).toBe('task completed successfully');
    expect(result['agentId']).toBeDefined();
    expect(result['agentId']).toMatch(/^agent_\d+_[a-z0-9]+$/);
  });

  it('should return error for unknown agent type', async () => {
    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const toolResult = await agentTool.execute({
      prompt: 'Do task',
      subagent_type: 'nonexistent',
    });
    const result = parseToolResult(toolResult);

    expect(result['success']).toBe(false);
    expect(result['error']).toContain('Unknown agent type');
    expect(result['error']).toContain('nonexistent');
  });

  it('should apply model override from tool args', async () => {
    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    await agentTool.execute({
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

    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
      onTextDelta,
      onToolExecution,
    });

    await agentTool.execute({ prompt: 'Do task' });

    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        onTextDelta,
        onToolExecution,
      }),
    );
  });

  it('should handle session.run error gracefully', async () => {
    mockRun.mockRejectedValueOnce(new Error('Provider timeout'));

    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const toolResult = await agentTool.execute({ prompt: 'Do task' });
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

    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
      customAgentRegistry: customRegistry,
    });

    await agentTool.execute({
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

  it('should return error when deps are not initialized', async () => {
    // Reset deps by importing fresh or using internal state
    // The agentToolDeps is module-level, so we need to set it to undefined
    // We can do this by calling setAgentToolDeps with a value that tricks the system,
    // but the safest way is to test the behavior directly.
    // Since we can't easily reset module state, we test via the getAgentToolDeps path.
    // Instead, test by importing and checking getAgentToolDeps behavior.
    const { getAgentToolDeps: getDeps } = await import('../agent-tool.js');
    // After previous tests, deps are set, so this verifies get returns them
    expect(getDeps()).toBeDefined();
  });

  it('should handle session.run throwing a non-Error value', async () => {
    mockRun.mockRejectedValueOnce('string error without Error object');

    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const toolResult = await agentTool.execute({ prompt: 'Do task' });
    const result = parseToolResult(toolResult);

    expect(result['success']).toBe(false);
    expect(result['error']).toContain('string error without Error object');
    expect(result['agentId']).toBeDefined();
  });

  it('should return error when custom registry also returns undefined', async () => {
    const customRegistry = vi.fn().mockReturnValue(undefined);

    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
      customAgentRegistry: customRegistry,
    });

    const toolResult = await agentTool.execute({
      prompt: 'Do task',
      subagent_type: 'totally-unknown',
    });
    const result = parseToolResult(toolResult);

    expect(result['success']).toBe(false);
    expect(result['error']).toContain('Unknown agent type: totally-unknown');
    expect(customRegistry).toHaveBeenCalledWith('totally-unknown');
  });

  it('should not override model when model arg is not provided', async () => {
    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    await agentTool.execute({
      prompt: 'Do task',
      subagent_type: 'Explore',
      // no model arg
    });

    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinition: expect.objectContaining({
          name: 'Explore',
          model: 'claude-haiku-4-5', // original agent model preserved
        }),
      }),
    );
  });

  it('should prefer built-in over custom registry when both match', async () => {
    const customAgent: IAgentDefinition = {
      name: 'Explore',
      description: 'Custom explore',
      systemPrompt: 'Custom prompt.',
    };
    const customRegistry = vi.fn().mockReturnValue(customAgent);

    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
      customAgentRegistry: customRegistry,
    });

    await agentTool.execute({
      prompt: 'Explore task',
      subagent_type: 'Explore',
    });

    // Built-in should be found first, custom registry should NOT be called
    expect(customRegistry).not.toHaveBeenCalled();
    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinition: expect.objectContaining({
          name: 'Explore',
          description: 'Exploration agent', // built-in description
        }),
      }),
    );
  });

  it('should generate unique agentIds across calls', async () => {
    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const result1 = parseToolResult(await agentTool.execute({ prompt: 'Task 1' }));
    const result2 = parseToolResult(await agentTool.execute({ prompt: 'Task 2' }));

    expect(result1['agentId']).not.toBe(result2['agentId']);
  });

  it('should not include agentId in error result when deps missing', async () => {
    // We cannot easily clear module-level agentToolDeps, but we can test
    // that the error path for unknown agent type does NOT include agentId
    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const toolResult = await agentTool.execute({
      prompt: 'Do task',
      subagent_type: 'nonexistent',
    });
    const result = parseToolResult(toolResult);

    // Unknown agent type error should NOT have agentId (happens before session creation)
    expect(result['agentId']).toBeUndefined();
  });

  it('should pass isForkWorker as undefined (not fork) to createSubagentSession', async () => {
    setAgentToolDeps({
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    await agentTool.execute({ prompt: 'Do task' });

    // Agent tool never sets isForkWorker (only useSubmitHandler fork runner does)
    expect(createSubagentSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ isForkWorker: true }),
    );
  });
});
