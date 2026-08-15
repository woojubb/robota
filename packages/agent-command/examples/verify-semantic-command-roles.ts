import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { FunctionTool } from '@robota-sdk/agent-core';
import {
  DuplicateSystemCommandSemanticRoleError,
  InteractiveSession,
  SystemCommandExecutor,
  createSession,
  createSubagentSession,
  deriveContextCapacityHint,
  storeAgentToolDeps,
  type ICommandModule,
  type IResolvedConfig,
  type ISystemCommand,
} from '@robota-sdk/agent-framework';

import {
  createAgentCommandModule,
  createCompactCommandModule,
  createSkillsCommandModule,
} from '../src/index.js';

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function command(name: string, semanticRole?: ISystemCommand['semanticRole']): ISystemCommand {
  return {
    name,
    ...(semanticRole ? { semanticRole } : {}),
    description: name,
    modelInvocable: true,
    execute: () => ({ success: true, message: '' }),
  };
}

const config: IResolvedConfig = {
  defaultTrustLevel: 'moderate',
  provider: { name: 'scripted-test-provider', apiKey: 'offline', model: 'scripted' },
  permissions: { allow: [], deny: [] },
  language: 'en',
  env: {},
};

const terminal = {
  write: () => {},
  writeLine: () => {},
  spinner: () => ({ stop: () => {} }),
};

function readSystemMessage(
  cwd: string,
  commandName: string,
  commandSemanticRoles?: { skillActivation?: string },
): string {
  const scripted = createScriptedProvider([]);
  const created = createSession({
    config,
    cwd,
    context: { agentsMd: '', projectNotesMd: '' },
    terminal: terminal as never,
    provider: scripted.provider,
    commandDescriptors: [
      {
        name: commandName,
        kind: 'builtin-command',
        description: 'Activate a skill',
        modelInvocable: true,
      },
    ],
    ...(commandSemanticRoles ? { commandSemanticRoles } : {}),
  });
  return created.session.getSystemMessage();
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-024-semantic-roles-'));
  let cleanupRemoved = false;
  let interactive: InteractiveSession | undefined;
  let subagent: ReturnType<typeof createSubagentSession> | undefined;
  let scenarioResult: Record<string, unknown> | undefined;
  try {
    try {
      const skillDirectory = join(cwd, '.agents', 'skills', 'audit');
      mkdirSync(skillDirectory, { recursive: true });
      writeFileSync(
        join(skillDirectory, 'SKILL.md'),
        ['---', 'name: audit', 'description: Audit code', '---', 'Audit'].join('\n'),
        'utf8',
      );

      const alternate = [
        command('activate-skill-alt', 'skillActivation'),
        command('reduce-context-alt', 'contextReduction'),
        command('spawn-subagent-alt', 'subagentSpawn'),
      ];
      const executor = new SystemCommandExecutor(alternate);
      const roles = executor.getSemanticRoles();
      assertCondition(
        roles.skillActivation === 'activate-skill-alt' &&
          roles.contextReduction === 'reduce-context-alt' &&
          roles.subagentSpawn === 'spawn-subagent-alt',
        'alternate ids were not projected',
      );

      const injectedSession = {
        getCwd: () => cwd,
        getSessionId: () => 'scenario-parent',
        getHistory: () => [],
        getFullHistory: () => [],
        getContextState: () => ({ usedTokens: 0, maxTokens: 1, usedPercentage: 0 }),
        getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
        getSystemMessage: () => '',
        getToolSchemas: () => [],
        abort: () => {},
        shutdown: async () => {},
      };
      const fallbackModule: ICommandModule = {
        name: 'alternate-semantic-roles',
        systemCommands: alternate,
      };
      interactive = new InteractiveSession({
        session: injectedSession as never,
        cwd,
        commandModules: [fallbackModule],
      });
      const emptyFallbackResult = await interactive.executeCommand('audit', 'src/index.ts');
      assertCondition(
        emptyFallbackResult?.success === true && emptyFallbackResult.message === '',
        'empty successful fallback result was treated as absence',
      );
      let agentJobCommandProvenance: string | undefined;
      storeAgentToolDeps(injectedSession, {
        backgroundTaskManager: { shutdown: async () => {} },
        subagentManager: {
          spawn: async (request: { metadata?: Record<string, unknown> }) => {
            agentJobCommandProvenance = request.metadata?.['executionOriginCommandName'] as
              string | undefined;
            return { id: 'scenario-job' };
          },
        },
        customAgentRegistry: () => ({
          name: 'worker',
          description: 'Worker',
          systemPrompt: 'Work',
        }),
      } as never);
      await interactive.spawnAgentJob({
        agentType: 'worker',
        label: 'Worker',
        mode: 'background',
        prompt: 'Verify provenance',
      });
      assertCondition(
        agentJobCommandProvenance === 'spawn-subagent-alt',
        'agent job provenance omitted the alternate semantic command id',
      );

      const alternatePrompt = readSystemMessage(cwd, 'activate-skill-alt', {
        skillActivation: 'activate-skill-alt',
      });
      const coincidentalPrompt = readSystemMessage(cwd, 'skills');
      assertCondition(
        alternatePrompt.includes('## Skills'),
        'alternate role omitted skill metadata',
      );
      assertCondition(
        !coincidentalPrompt.includes('## Skills'),
        'coincidental name gained semantics',
      );

      const projectedSpawnTool = new FunctionTool(
        {
          name: 'robota_command_spawn-subagent-alt',
          description: 'Projected alternate spawn command',
          parameters: { type: 'object', properties: {} },
        },
        async () => ({ success: true }),
      );
      subagent = createSubagentSession({
        agentDefinition: { name: 'worker', description: 'Worker', systemPrompt: 'Work' },
        parentConfig: config,
        parentContext: { agentsMd: '', projectNotesMd: '' },
        parentTools: [projectedSpawnTool],
        provider: createScriptedProvider([]).provider,
        terminal: terminal as never,
        cwd,
        commandSemanticRoles: roles,
      });
      assertCondition(
        subagent
          .getToolSchemas()
          .every((schema) => schema.name !== 'robota_command_spawn-subagent-alt'),
        'alternate spawn command was not filtered',
      );

      const original = command('original', 'subagentSpawn');
      const atomicExecutor = new SystemCommandExecutor([original]);
      const duplicate = command('duplicate', 'subagentSpawn');
      const duplicateRoleRejections = { constructor: false, register: false, replace: false };
      try {
        new SystemCommandExecutor([original, duplicate]);
      } catch (error) {
        duplicateRoleRejections.constructor =
          error instanceof DuplicateSystemCommandSemanticRoleError;
      }
      try {
        atomicExecutor.register(duplicate);
      } catch (error) {
        duplicateRoleRejections.register = error instanceof DuplicateSystemCommandSemanticRoleError;
      }
      try {
        atomicExecutor.replaceCommands([original, duplicate]);
      } catch (error) {
        duplicateRoleRejections.replace = error instanceof DuplicateSystemCommandSemanticRoleError;
      }
      assertCondition(
        Object.values(duplicateRoleRejections).every(Boolean) &&
          atomicExecutor.listCommands()[0]?.name === 'original',
        'duplicate rejection was untyped or mutated the selected set',
      );

      const ownerDeclarations = {
        skills: createSkillsCommandModule({ cwd }).systemCommands?.[0]?.semanticRole,
        compact: createCompactCommandModule().systemCommands?.[0]?.semanticRole,
        agent: createAgentCommandModule().systemCommands?.[0]?.semanticRole,
      };
      assertCondition(
        ownerDeclarations.skills === 'skillActivation' &&
          ownerDeclarations.compact === 'contextReduction' &&
          ownerDeclarations.agent === 'subagentSpawn',
        'shipped owner declarations were incomplete',
      );

      const singleRoleOmission = {
        skillActivation: new SystemCommandExecutor(alternate.slice(1)).getSemanticRoles(),
        contextReduction: new SystemCommandExecutor([
          alternate[0]!,
          alternate[2]!,
        ]).getSemanticRoles(),
        subagentSpawn: new SystemCommandExecutor(alternate.slice(0, 2)).getSemanticRoles(),
      };
      assertCondition(
        singleRoleOmission.skillActivation.skillActivation === undefined &&
          singleRoleOmission.skillActivation.contextReduction === 'reduce-context-alt' &&
          singleRoleOmission.skillActivation.subagentSpawn === 'spawn-subagent-alt' &&
          singleRoleOmission.contextReduction.skillActivation === 'activate-skill-alt' &&
          singleRoleOmission.contextReduction.contextReduction === undefined &&
          singleRoleOmission.contextReduction.subagentSpawn === 'spawn-subagent-alt' &&
          singleRoleOmission.subagentSpawn.skillActivation === 'activate-skill-alt' &&
          singleRoleOmission.subagentSpawn.contextReduction === 'reduce-context-alt' &&
          singleRoleOmission.subagentSpawn.subagentSpawn === undefined,
        'omitting one role changed another role or retained the omitted role',
      );
      scenarioResult = {
        alternateRoleIds: roles,
        alternateBehaviors: {
          skillFallback: true,
          modelVisibleSkillEnrichment: true,
          contextCapacityHint:
            deriveContextCapacityHint(roles.contextReduction) ===
            'Run /reduce-context-alt and retry.',
          agentJobCommandProvenance: agentJobCommandProvenance === 'spawn-subagent-alt',
          subagentSpawnCommandFiltering: true,
          emptyCommandResultIsPresent: true,
        },
        unannotatedCoincidentalNames: {
          skills: !coincidentalPrompt.includes('## Skills'),
          compact: deriveContextCapacityHint(undefined) === undefined,
          agent:
            new SystemCommandExecutor([command('agent')]).getSemanticRoles().subagentSpawn ===
            undefined,
        },
        singleRoleOmission,
        directCreateSessionOmission: { allRolesAbsent: !coincidentalPrompt.includes('## Skills') },
        duplicateRoleRejections: { ...duplicateRoleRejections, preservedCommands: true },
        ownerDeclarations,
      };
    } finally {
      await interactive?.shutdown();
      subagent?.abort();
      rmSync(cwd, { recursive: true, force: true });
      cleanupRemoved = !existsSync(cwd);
    }
    assertCondition(cleanupRemoved, 'temporary scenario directory was not removed');
    assertCondition(scenarioResult !== undefined, 'scenario produced no result');

    process.stdout.write(`${JSON.stringify({ ...scenarioResult, cleanupRemoved })}\n`);
  } catch (error) {
    rmSync(cwd, { recursive: true, force: true });
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

void main();
