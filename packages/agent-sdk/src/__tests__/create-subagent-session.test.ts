/**
 * Tests for createSubagentSession — assembles an isolated child Session
 * for subagent execution with tool filtering, model resolution, and prompt assembly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IAIProvider, IToolWithEventService } from '@robota-sdk/agent-core';
import type { ITerminalOutput } from '@robota-sdk/agent-sessions';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';

// Mock Session to capture constructor args
const mockSessionConstructor = vi.fn();
vi.mock('@robota-sdk/agent-sessions', () => ({
  Session: class MockSession {
    constructor(options: unknown) {
      mockSessionConstructor(options);
    }
  },
}));

// Mock createProvider
const mockProvider = {
  generateResponse: vi.fn(),
} as unknown as IAIProvider;
vi.mock('../assembly/create-provider.js', () => ({
  createProvider: vi.fn(() => mockProvider),
}));

import { createSubagentSession } from '../assembly/create-subagent-session.js';
import { createProvider } from '../assembly/create-provider.js';

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

function makeParentConfig(overrides?: Partial<IResolvedConfig>): IResolvedConfig {
  return {
    defaultTrustLevel: 'moderate',
    provider: {
      name: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'test-key',
    },
    permissions: { allow: [], deny: [] },
    env: {},
    ...overrides,
  };
}

function makeParentContext(overrides?: Partial<ILoadedContext>): ILoadedContext {
  return {
    agentsMd: '# AGENTS.md content',
    claudeMd: '# CLAUDE.md content',
    ...overrides,
  };
}

function makeAgentDef(overrides?: Partial<IAgentDefinition>): IAgentDefinition {
  return {
    name: 'TestAgent',
    description: 'A test agent',
    systemPrompt: 'You are a test agent.',
    ...overrides,
  };
}

describe('createSubagentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should filter out disallowed tools', () => {
    const tools = [makeTool('Read'), makeTool('Write'), makeTool('Edit'), makeTool('Grep')];
    const agent = makeAgentDef({ disallowedTools: ['Write', 'Edit'] });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: tools,
      terminal: makeTerminal(),
    });

    expect(mockSessionConstructor).toHaveBeenCalledTimes(1);
    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const passedTools = passedOptions['tools'] as IToolWithEventService[];
    const toolNames = passedTools.map((t) => t.getName());
    expect(toolNames).toEqual(['Read', 'Grep']);
  });

  it('should filter to allowlist when tools specified', () => {
    const tools = [makeTool('Read'), makeTool('Write'), makeTool('Edit'), makeTool('Grep')];
    const agent = makeAgentDef({ tools: ['Read', 'Grep'] });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: tools,
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const passedTools = passedOptions['tools'] as IToolWithEventService[];
    const toolNames = passedTools.map((t) => t.getName());
    expect(toolNames).toEqual(['Read', 'Grep']);
  });

  it('should always exclude Agent tool', () => {
    const tools = [makeTool('Read'), makeTool('Agent'), makeTool('Grep')];
    const agent = makeAgentDef();

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: tools,
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const passedTools = passedOptions['tools'] as IToolWithEventService[];
    const toolNames = passedTools.map((t) => t.getName());
    expect(toolNames).toEqual(['Read', 'Grep']);
    expect(toolNames).not.toContain('Agent');
  });

  it('should resolve model shortcut "haiku"', () => {
    const agent = makeAgentDef({ model: 'haiku' });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['model']).toBe('claude-haiku-4-5');
  });

  it('should resolve model shortcut "sonnet"', () => {
    const agent = makeAgentDef({ model: 'sonnet' });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['model']).toBe('claude-sonnet-4-6');
  });

  it('should resolve model shortcut "opus"', () => {
    const agent = makeAgentDef({ model: 'opus' });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['model']).toBe('claude-opus-4-6');
  });

  it('should use full model ID as-is', () => {
    const agent = makeAgentDef({ model: 'claude-3-5-haiku-20241022' });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['model']).toBe('claude-3-5-haiku-20241022');
  });

  it('should inherit parent model when no override', () => {
    const agent = makeAgentDef(); // no model field

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig({
        provider: { name: 'anthropic', model: 'claude-opus-4-6', apiKey: 'key' },
      }),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['model']).toBe('claude-opus-4-6');
  });

  it('should assemble system prompt with standard suffix', () => {
    const agent = makeAgentDef({ systemPrompt: 'You are a code explorer.' });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext({ claudeMd: 'claude content', agentsMd: 'agents content' }),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const systemMessage = passedOptions['systemMessage'] as string;
    expect(systemMessage).toContain('You are a code explorer.');
    expect(systemMessage).toContain('claude content');
    expect(systemMessage).toContain('agents content');
    expect(systemMessage).toContain('concise report');
    expect(systemMessage).not.toContain('500 words');
  });

  it('should use fork worker suffix when isForkWorker is true', () => {
    const agent = makeAgentDef({ systemPrompt: 'You are a worker.' });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
      isForkWorker: true,
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const systemMessage = passedOptions['systemMessage'] as string;
    expect(systemMessage).toContain('500 words');
  });

  it('should pass maxTurns from agent definition', () => {
    const agent = makeAgentDef({ maxTurns: 5 });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['maxTurns']).toBe(5);
  });

  it('should pass permissionHandler through', () => {
    const handler = vi.fn();
    const agent = makeAgentDef();

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
      permissionHandler: handler,
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['permissionHandler']).toBe(handler);
  });

  it('should pass onTextDelta and onToolExecution through', () => {
    const onTextDelta = vi.fn();
    const onToolExecution = vi.fn();
    const agent = makeAgentDef();

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
      onTextDelta,
      onToolExecution,
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['onTextDelta']).toBe(onTextDelta);
    expect(passedOptions['onToolExecution']).toBe(onToolExecution);
  });

  it('should create provider from parentConfig', () => {
    const config = makeParentConfig();
    const agent = makeAgentDef();

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: config,
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    expect(createProvider).toHaveBeenCalledWith(config);
  });

  it('should apply disallowedTools before allowlist tools', () => {
    // Both specified: disallowedTools removes first, then tools filters
    const tools = [makeTool('Read'), makeTool('Write'), makeTool('Edit'), makeTool('Grep')];
    const agent = makeAgentDef({
      disallowedTools: ['Write'],
      tools: ['Read', 'Write', 'Grep'], // Write already removed by denylist
    });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: tools,
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const passedTools = passedOptions['tools'] as IToolWithEventService[];
    const toolNames = passedTools.map((t) => t.getName());
    // Write was removed by denylist, so allowlist of [Read, Write, Grep] yields [Read, Grep]
    expect(toolNames).toEqual(['Read', 'Grep']);
  });

  it('should pass parent permissions to session', () => {
    const config = makeParentConfig({
      permissions: { allow: ['Read(**)'], deny: ['Write(/etc/**)'] },
    });
    const agent = makeAgentDef();

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: config,
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const permissions = passedOptions['permissions'] as { allow: string[]; deny: string[] };
    expect(permissions.allow).toContain('Read(**)');
    expect(permissions.deny).toContain('Write(/etc/**)');
  });

  it('should result in empty tools when allowlist contains no matching tools', () => {
    const tools = [makeTool('Read'), makeTool('Write'), makeTool('Grep')];
    const agent = makeAgentDef({ tools: ['NonExistent', 'AlsoMissing'] });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: tools,
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const passedTools = passedOptions['tools'] as IToolWithEventService[];
    expect(passedTools).toHaveLength(0);
  });

  it('should pass through unknown model strings as-is (no shortcut match)', () => {
    const agent = makeAgentDef({ model: 'gpt-4o-mini' });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['model']).toBe('gpt-4o-mini');
  });

  it('should remove Agent tool even when it is in the allowlist', () => {
    const tools = [makeTool('Read'), makeTool('Agent'), makeTool('Grep')];
    const agent = makeAgentDef({ tools: ['Read', 'Agent', 'Grep'] });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: tools,
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const passedTools = passedOptions['tools'] as IToolWithEventService[];
    const toolNames = passedTools.map((t) => t.getName());
    expect(toolNames).toEqual(['Read', 'Grep']);
    expect(toolNames).not.toContain('Agent');
  });

  it('should handle empty parent tools', () => {
    const agent = makeAgentDef();

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const passedTools = passedOptions['tools'] as IToolWithEventService[];
    expect(passedTools).toHaveLength(0);
  });

  it('should default isForkWorker to false (standard suffix)', () => {
    const agent = makeAgentDef({ systemPrompt: 'Test prompt.' });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
      // isForkWorker not specified
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const systemMessage = passedOptions['systemMessage'] as string;
    expect(systemMessage).toContain('concise report');
    expect(systemMessage).not.toContain('500 words');
  });

  it('should pass defaultTrustLevel from parent config', () => {
    const config = makeParentConfig({ defaultTrustLevel: 'trusted' });
    const agent = makeAgentDef();

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: config,
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['defaultTrustLevel']).toBe('trusted');
  });

  it('should handle no context (empty claudeMd and agentsMd)', () => {
    const agent = makeAgentDef({ systemPrompt: 'Agent prompt.' });

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext({ claudeMd: undefined, agentsMd: undefined }),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const systemMessage = passedOptions['systemMessage'] as string;
    expect(systemMessage).toContain('Agent prompt.');
    expect(systemMessage).toContain('concise report');
  });

  it('should pass undefined maxTurns when agent definition has none', () => {
    const agent = makeAgentDef(); // no maxTurns

    createSubagentSession({
      agentDefinition: agent,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: [makeTool('Read')],
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['maxTurns']).toBeUndefined();
  });
});
