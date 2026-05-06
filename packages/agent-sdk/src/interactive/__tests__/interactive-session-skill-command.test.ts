import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IToolWithEventService, IAIProvider } from '@robota-sdk/agent-core';
import type { ITerminalOutput } from '@robota-sdk/agent-sessions';
import type { IResolvedConfig } from '../../config/config-types.js';
import type { ILoadedContext } from '../../context/context-loader.js';
import type { IAgentDefinition } from '../../agents/agent-definition-types.js';
import type { ICommand } from '../../command-api/types.js';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '../session-persistence.js';

const mocks = vi.hoisted(() => ({
  createSubagentSession: vi.fn(),
  forkRun: vi.fn(),
}));

vi.mock('../../assembly/create-subagent-session.js', () => ({
  createSubagentSession: mocks.createSubagentSession,
}));

import { InteractiveSession } from '../interactive-session.js';
import { storeAgentToolDeps } from '../../tools/agent-tool.js';

function makeParentSession() {
  return {
    run: vi.fn().mockResolvedValue('parent response'),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 10,
      usedTokens: 100,
      maxTokens: 1000,
    }),
    injectMessage: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('parent-session-id'),
    getSystemMessage: vi.fn().mockReturnValue('# system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
  };
}

function createTempSkill(cwd: string, name = 'audit'): void {
  const skillDir = join(cwd, '.agents', 'skills', name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    ['---', `name: ${name}`, 'description: Audit code', '---', 'Audit $ARGUMENTS'].join('\n'),
    'utf8',
  );
}

function makeTool(name: string): IToolWithEventService {
  return {
    getName: () => name,
    getDescription: () => `Mock ${name}`,
    schema: {
      name,
      description: `Mock ${name}`,
      parameters: { type: 'object', properties: {} },
    },
    execute: vi.fn(),
    validate: vi.fn(),
    validateParameters: vi.fn(),
    setEventService: vi.fn(),
  } as unknown as IToolWithEventService;
}

function makeConfig(): IResolvedConfig {
  return {
    defaultTrustLevel: 'moderate',
    provider: { name: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'test-key' },
    permissions: { allow: [], deny: [] },
    env: {},
  };
}

function makeContext(): ILoadedContext {
  return { agentsMd: '# AGENTS', claudeMd: '# CLAUDE' };
}

function makeTerminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    spinner: vi.fn(),
  } as unknown as ITerminalOutput;
}

function makeSkill(overrides?: Partial<ICommand>): ICommand {
  return {
    name: 'audit',
    description: 'Audit code',
    source: 'skill',
    skillContent: 'Audit $ARGUMENTS',
    ...overrides,
  };
}

describe('InteractiveSession.executeSkillCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.forkRun.mockResolvedValue('fork result');
    mocks.createSubagentSession.mockReturnValue({ run: mocks.forkRun });
  });

  it('submits non-fork skills into the parent session', async () => {
    const parentSession = makeParentSession();
    const session = new InteractiveSession({ session: parentSession as never });
    const skill = makeSkill();
    const skillActivation = vi.fn();
    session.on('skill_activation', skillActivation);

    await session.executeSkillCommand(
      skill,
      'src/index.ts',
      '/audit src/index.ts',
      '/audit src/index.ts',
    );

    expect(parentSession.run).toHaveBeenCalledWith(
      expect.stringContaining('Audit src/index.ts'),
      '/audit src/index.ts',
    );
    expect(skillActivation).toHaveBeenCalledTimes(2);
    expect(session.getSkillActivationEvents().map((event) => event.status)).toEqual([
      'started',
      'completed',
    ]);
    expect(session.getFullHistory()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'event',
          type: 'skill-activation',
          data: expect.objectContaining({
            skillName: 'audit',
            invocation: 'user-slash',
            status: 'started',
          }),
        }),
      ]),
    );
    expect(mocks.createSubagentSession).not.toHaveBeenCalled();
  });

  it('activates model-invocable skills through the SDK path without submitting a user turn', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-model-skill-'));
    createTempSkill(cwd);
    const parentSession = makeParentSession();
    const session = new InteractiveSession({ session: parentSession as never, cwd });

    const result = await session.executeModelSkillCommand('audit', 'src/index.ts');

    expect(result).toEqual({
      mode: 'inject',
      prompt: expect.stringContaining('Audit src/index.ts'),
    });
    expect(parentSession.run).not.toHaveBeenCalled();
    expect(session.getSkillActivationEvents().map((event) => event.invocation)).toEqual([
      'model-tool',
      'model-tool',
    ]);
    expect(session.getSkillActivationEvents().map((event) => event.status)).toEqual([
      'started',
      'completed',
    ]);
  });

  it('does not record skill activation for prompt-only skill references', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-prompt-only-skill-'));
    createTempSkill(cwd);
    const parentSession = makeParentSession();
    const session = new InteractiveSession({ session: parentSession as never, cwd });

    await session.submit('Use the audit skill by following the workflow in prose.');

    expect(parentSession.run).toHaveBeenCalledOnce();
    expect(session.getSkillActivationEvents()).toEqual([]);
    expect(session.getFullHistory().some((entry) => entry.type === 'skill-activation')).toBe(false);
  });

  it('persists skill activation events in the session record', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-persisted-skill-'));
    createTempSkill(cwd);
    const parentSession = makeParentSession();
    let savedRecord: IInteractiveSessionRecord | undefined;
    const sessionStore: IInteractiveSessionStore = {
      save: (record) => {
        savedRecord = record;
      },
      load: () => undefined,
      list: () => [],
      delete: vi.fn(),
    };
    const session = new InteractiveSession({
      session: parentSession as never,
      cwd,
      sessionStore,
    });

    await session.executeModelSkillCommand('audit', 'src/index.ts');

    expect(savedRecord?.skillActivationEvents?.map((event) => event.status)).toEqual([
      'started',
      'completed',
    ]);
  });

  it('runs context: fork skills through an isolated subagent session', async () => {
    const parentSession = makeParentSession();
    const session = new InteractiveSession({ session: parentSession as never });
    const exploreAgent: IAgentDefinition = {
      name: 'Explore',
      description: 'Read-only explorer',
      systemPrompt: 'Explore the codebase.',
      disallowedTools: ['Write', 'Edit'],
    };

    storeAgentToolDeps(parentSession, {
      config: makeConfig(),
      context: makeContext(),
      tools: [makeTool('Read'), makeTool('Write'), makeTool('Agent')],
      terminal: makeTerminal(),
      provider: {} as IAIProvider,
      customAgentRegistry: (name) => (name === 'Explore' ? exploreAgent : undefined),
    });

    const complete = vi.fn();
    session.on('complete', complete);

    const result = await session.executeSkillCommand(
      makeSkill({ context: 'fork', agent: 'Explore', allowedTools: ['Read'] }),
      'src/index.ts',
      '/audit src/index.ts',
      '/audit src/index.ts',
    );

    expect(result).toEqual({ mode: 'fork', result: 'fork result' });
    expect(parentSession.run).not.toHaveBeenCalled();
    expect(mocks.createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinition: expect.objectContaining({
          name: 'Explore',
          tools: ['Read'],
          disallowedTools: ['Write', 'Edit'],
        }),
        isForkWorker: true,
      }),
    );
    expect(mocks.forkRun).toHaveBeenCalledWith('Audit src/index.ts');
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ response: 'fork result' }));
    expect(session.getMessages().map((message) => message.content)).toContain(
      '/audit src/index.ts',
    );
    expect(session.getMessages().map((message) => message.content)).toContain('fork result');
  });
});
