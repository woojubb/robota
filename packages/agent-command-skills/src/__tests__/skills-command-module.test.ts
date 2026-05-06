import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InteractiveSession, SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import type { ICommandHostContext } from '@robota-sdk/agent-sdk';
import { createSkillsCommandModule } from '../skills-command-module.js';

function createTempSkill(cwd: string): void {
  const skillDir = join(cwd, '.agents', 'skills', 'audit');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    ['---', 'name: audit', 'description: Audit code', '---', 'Audit $ARGUMENTS'].join('\n'),
    'utf8',
  );
}

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

function createMockContext(overrides?: Partial<ICommandHostContext>): ICommandHostContext {
  return {
    getSession: vi.fn(),
    getContextState: vi.fn(),
    getAutoCompactThreshold: vi.fn().mockReturnValue(0.835),
    compactContext: vi.fn(),
    getCwd: vi.fn().mockReturnValue('/workspace'),
    listEditCheckpoints: vi.fn().mockReturnValue([]),
    restoreEditCheckpoint: vi.fn(),
    rollbackEditCheckpoint: vi.fn(),
    getUsedMemoryReferences: vi.fn().mockReturnValue([]),
    recordMemoryEvent: vi.fn(),
    listBackgroundTasks: vi.fn().mockReturnValue([]),
    readBackgroundTaskLog: vi.fn(),
    cancelBackgroundTask: vi.fn(),
    closeBackgroundTask: vi.fn(),
    ...overrides,
  } as ICommandHostContext;
}

describe('createSkillsCommandModule', () => {
  it('exposes skills as a normal model-invocable command module', () => {
    const module = createSkillsCommandModule({ cwd: '/workspace' });
    const command = module.systemCommands?.[0];

    expect(module.name).toBe('agent-command-skills');
    expect(module.commandSources?.[0]?.getCommands().map((entry) => entry.name)).toEqual([
      'skills',
    ]);
    expect(command).toMatchObject({
      name: 'skills',
      userInvocable: true,
      modelInvocable: true,
      lifecycle: 'inline',
      argumentHint: '[list | <skill-name> [args]]',
      safety: 'read-only',
    });
    expect(command?.description).toContain('ExecuteCommand with command "skills"');
  });

  it('lists skill metadata from the SDK host context', async () => {
    const executor = new SystemCommandExecutor([
      ...(createSkillsCommandModule({ cwd: '/workspace' }).systemCommands ?? []),
    ]);

    const result = await executor.execute(
      'skills',
      createMockContext({
        listSkills: vi.fn().mockReturnValue([
          {
            name: 'repo-writing',
            description: 'Repository writing rules',
            source: 'skill',
            modelInvocable: true,
            userInvocable: true,
          },
        ]),
      }),
      '',
    );

    expect(result?.message).toContain('repo-writing: Repository writing rules');
    expect(result?.message).toContain('Use /skills <skill-name> [args]');
    expect(result?.data?.['activationContract']).toMatchObject({
      activateWith: '/skills <skill-name> [args]',
      activationRequiredBeforeWorkflow: true,
    });
  });

  it('activates skills through the SDK host skill activation API', async () => {
    const executeSkillCommandByName = vi.fn().mockResolvedValue({
      success: true,
      message: 'Skill activated: repo-writing',
      data: { skill: 'repo-writing' },
    });
    const executor = new SystemCommandExecutor([
      ...(createSkillsCommandModule({ cwd: '/workspace' }).systemCommands ?? []),
    ]);

    const result = await executor.execute(
      'skills',
      createMockContext({
        getCommandInvocationSource: vi.fn().mockReturnValue('model'),
        executeSkillCommandByName,
      }),
      'repo-writing update docs',
    );

    expect(executeSkillCommandByName).toHaveBeenCalledWith('repo-writing', 'update docs', {
      invocationSource: 'model',
      displayInput: '/repo-writing update docs',
      rawInput: '/repo-writing update docs',
    });
    expect(result?.message).toBe('Skill activated: repo-writing');
  });

  it('lets the SDK normalize virtual /skill-name commands into the composed skills command', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-skills-command-module-'));
    createTempSkill(cwd);
    const parentSession = makeParentSession();
    const session = new InteractiveSession({
      session: parentSession as never,
      cwd,
      commandModules: [createSkillsCommandModule({ cwd })],
    });

    const result = await session.executeCommand('audit', 'src/index.ts');

    expect(result).toMatchObject({
      success: true,
      data: expect.objectContaining({
        skill: 'audit',
        sessionExecution: true,
      }),
      effects: [{ type: 'session-execution-started' }],
    });
    expect(parentSession.run).toHaveBeenCalledWith(
      expect.stringContaining('Audit src/index.ts'),
      '/audit src/index.ts',
    );
  });
});
