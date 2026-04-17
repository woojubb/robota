/**
 * Subagent integration tests — verify the full subagent flow works together:
 * agent definitions, tool filtering, session creation, and agent tool wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IAIProvider, IToolWithEventService } from '@robota-sdk/agent-core';
import type { ITerminalOutput } from '@robota-sdk/agent-sessions';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import { BUILT_IN_AGENTS, getBuiltInAgent } from '../agents/built-in-agents.js';
import { AgentDefinitionLoader } from '../agents/agent-definition-loader.js';

// Mock Session to capture constructor args
const mockSessionConstructor = vi.fn();
vi.mock('@robota-sdk/agent-sessions', () => ({
  Session: class MockSession {
    constructor(options: unknown) {
      mockSessionConstructor(options);
    }
    async run(_prompt: string): Promise<string> {
      return 'mock response';
    }
  },
  FileSessionLogger: class MockFileSessionLogger {
    constructor(public readonly logDir: string) {}
    log(): void {
      // no-op
    }
  },
  SilentSessionLogger: class MockSilentSessionLogger {
    log(): void {
      // no-op
    }
  },
}));

const mockProvider = {
  generateResponse: vi.fn(),
} as unknown as IAIProvider;

import { createSubagentSession } from '../assembly/create-subagent-session.js';
import { storeAgentToolDeps, retrieveAgentToolDeps } from '../tools/agent-tool.js';
import { createSubagentLogger, resolveSubagentLogDir } from '../assembly/subagent-logger.js';

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
    agentsMd: '# AGENTS.md',
    claudeMd: '# CLAUDE.md',
    ...overrides,
  };
}

describe('Subagent integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Agent tool resolves built-in agent and creates session', () => {
    const tools = [makeTool('Read'), makeTool('Write'), makeTool('Grep'), makeTool('Agent')];
    const config = makeParentConfig();
    const context = makeParentContext();
    const terminal = makeTerminal();

    const depsKey = {}; // opaque key for this test
    const agentToolDeps = {
      config,
      context,
      tools,
      terminal,
      provider: mockProvider,
    };
    storeAgentToolDeps(depsKey, agentToolDeps);

    const deps = retrieveAgentToolDeps(depsKey);
    expect(deps).toBeDefined();

    // Resolve the Explore agent definition
    const exploreDef = getBuiltInAgent('Explore');
    expect(exploreDef).toBeDefined();

    // Create session with that definition
    createSubagentSession({
      agentDefinition: exploreDef!,
      parentConfig: config,
      parentContext: context,
      parentTools: tools,
      provider: mockProvider,
      terminal,
    });

    expect(mockSessionConstructor).toHaveBeenCalledTimes(1);
    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    expect(passedOptions['model']).toBe('claude-haiku-4-5');
  });

  it('Explore agent has read-only tools (Write and Edit filtered out)', () => {
    const tools = [
      makeTool('Read'),
      makeTool('Write'),
      makeTool('Edit'),
      makeTool('Grep'),
      makeTool('Glob'),
      makeTool('Bash'),
      makeTool('Agent'),
    ];

    const exploreDef = getBuiltInAgent('Explore');
    expect(exploreDef).toBeDefined();
    expect(exploreDef!.disallowedTools).toEqual(['Write', 'Edit']);

    createSubagentSession({
      agentDefinition: exploreDef!,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: tools,
      provider: mockProvider,
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const passedTools = passedOptions['tools'] as IToolWithEventService[];
    const toolNames = passedTools.map((t) => t.getName());

    expect(toolNames).toContain('Read');
    expect(toolNames).toContain('Grep');
    expect(toolNames).toContain('Glob');
    expect(toolNames).toContain('Bash');
    expect(toolNames).not.toContain('Write');
    expect(toolNames).not.toContain('Edit');
    expect(toolNames).not.toContain('Agent');
  });

  it('general-purpose agent inherits all tools except Agent', () => {
    const tools = [
      makeTool('Read'),
      makeTool('Write'),
      makeTool('Edit'),
      makeTool('Grep'),
      makeTool('Glob'),
      makeTool('Bash'),
      makeTool('Agent'),
    ];

    const generalDef = getBuiltInAgent('general-purpose');
    expect(generalDef).toBeDefined();

    createSubagentSession({
      agentDefinition: generalDef!,
      parentConfig: makeParentConfig(),
      parentContext: makeParentContext(),
      parentTools: tools,
      provider: mockProvider,
      terminal: makeTerminal(),
    });

    const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
    const passedTools = passedOptions['tools'] as IToolWithEventService[];
    const toolNames = passedTools.map((t) => t.getName());

    expect(toolNames).toContain('Read');
    expect(toolNames).toContain('Write');
    expect(toolNames).toContain('Edit');
    expect(toolNames).toContain('Grep');
    expect(toolNames).toContain('Glob');
    expect(toolNames).toContain('Bash');
    expect(toolNames).not.toContain('Agent');
  });

  it('Agent tool is excluded from subagent tools for all agent types', () => {
    const tools = [makeTool('Read'), makeTool('Agent')];

    for (const agentDef of BUILT_IN_AGENTS) {
      vi.clearAllMocks();
      createSubagentSession({
        agentDefinition: agentDef,
        parentConfig: makeParentConfig(),
        parentContext: makeParentContext(),
        parentTools: tools,
        provider: mockProvider,
        terminal: makeTerminal(),
      });

      const passedOptions = mockSessionConstructor.mock.calls[0][0] as Record<string, unknown>;
      const passedTools = passedOptions['tools'] as IToolWithEventService[];
      const toolNames = passedTools.map((t) => t.getName());
      expect(toolNames).not.toContain('Agent');
    }
  });

  it('AgentDefinitionLoader finds built-in agents when dirs are empty', () => {
    const tmpDir = join(tmpdir(), `robota-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const loader = new AgentDefinitionLoader(tmpDir, tmpDir);
      const agents = loader.loadAll();

      expect(agents.length).toBe(BUILT_IN_AGENTS.length);

      const names = agents.map((a) => a.name);
      expect(names).toContain('general-purpose');
      expect(names).toContain('Explore');
      expect(names).toContain('Plan');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Custom agent overrides built-in', () => {
    const tmpDir = join(tmpdir(), `robota-test-${Date.now()}`);
    const agentsDir = join(tmpDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });

    // Create a custom Explore agent
    writeFileSync(
      join(agentsDir, 'Explore.md'),
      `---
name: Explore
description: Custom explore agent
model: opus
---

You are a custom explore agent with special capabilities.`,
    );

    try {
      const loader = new AgentDefinitionLoader(tmpDir, tmpDir);
      const exploreAgent = loader.getAgent('Explore');

      expect(exploreAgent).toBeDefined();
      expect(exploreAgent!.description).toBe('Custom explore agent');
      expect(exploreAgent!.model).toBe('opus');
      expect(exploreAgent!.systemPrompt).toContain('custom explore agent');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Plan agent has read-only tools like Explore', () => {
    const planDef = getBuiltInAgent('Plan');
    expect(planDef).toBeDefined();
    expect(planDef!.disallowedTools).toEqual(['Write', 'Edit']);
  });

  it('Built-in agents have required fields', () => {
    for (const agent of BUILT_IN_AGENTS) {
      expect(agent.name).toBeTruthy();
      expect(agent.description).toBeTruthy();
      expect(agent.systemPrompt).toBeTruthy();
    }
  });
});

describe('Subagent transcript logger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `robota-logger-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createSubagentLogger creates directory and returns logger', () => {
    const logger = createSubagentLogger('session-123', 'agent-abc', tmpDir);
    expect(logger).toBeDefined();

    // Verify the subagent directory was created
    const expectedDir = join(tmpDir, 'session-123', 'subagents');
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    expect(existsSync(expectedDir)).toBe(true);
  });

  it('resolveSubagentLogDir returns correct path without creating directory', () => {
    const dir = resolveSubagentLogDir('session-456', tmpDir);
    expect(dir).toBe(join(tmpDir, 'session-456', 'subagents'));

    // Directory should NOT be created
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    expect(existsSync(dir)).toBe(false);
  });
});
