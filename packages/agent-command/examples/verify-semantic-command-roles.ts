import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { FunctionTool } from '@robota-sdk/agent-core';
import {
  InteractiveSession,
  SystemCommandExecutor,
  deriveContextCapacityHint,
  storeAgentToolDeps,
  type ICommandModule,
} from '@robota-sdk/agent-framework';

import {
  assertCondition,
  command,
  createTrackedSubagent,
  hasProjectedSpawnTool,
  readSystemMessage,
  verifyDuplicateRoleRejections,
  verifyOmissionBehaviors,
  type TDirectSession,
  type TSubagentSession,
} from './semantic-command-role-scenario-helpers.js';
import { createScenarioProjectAccess } from './semantic-command-role-project-access.js';

import {
  createAgentCommandModule,
  createCompactCommandModule,
  createSkillsCommandModule,
} from '../src/index.js';

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-024-semantic-roles-'));
  let cleanupRemoved = false;
  let interactive: InteractiveSession | undefined;
  const directSessions: TDirectSession[] = [];
  const subagentSessions: TSubagentSession[] = [];
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
      const projectAccess = await createScenarioProjectAccess(cwd);

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
        projectAccess,
        commandModules: [fallbackModule],
      });
      const emptyFallbackResult = await interactive.executeCommand('audit', 'src/index.ts');
      assertCondition(
        emptyFallbackResult?.success === true && emptyFallbackResult.message === '',
        'empty successful fallback result was treated as absence',
      );
      let agentJobCommandProvenance: string | undefined;
      storeAgentToolDeps(injectedSession, {
        backgroundTaskManager: { subscribe: () => () => {}, shutdown: async () => {} },
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

      const alternatePrompt = await readSystemMessage(
        cwd,
        'activate-skill-alt',
        directSessions,
        projectAccess,
        { skillActivation: 'activate-skill-alt' },
      );
      const coincidentalPrompt = await readSystemMessage(
        cwd,
        'skills',
        directSessions,
        projectAccess,
      );
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
      const subagent = createTrackedSubagent(cwd, projectedSpawnTool, subagentSessions, roles);
      assertCondition(
        subagent
          .getToolSchemas()
          .every((schema) => schema.name !== 'robota_command_spawn-subagent-alt'),
        'alternate spawn command was not filtered',
      );

      const duplicateRoleRejections = verifyDuplicateRoleRejections();

      const ownerDeclarations = {
        skills: createSkillsCommandModule({ contributionSources: [] }).systemCommands?.[0]
          ?.semanticRole,
        compact: createCompactCommandModule().systemCommands?.[0]?.semanticRole,
        agent: createAgentCommandModule().systemCommands?.[0]?.semanticRole,
      };
      assertCondition(
        ownerDeclarations.skills === 'skillActivation' &&
          ownerDeclarations.compact === 'contextReduction' &&
          ownerDeclarations.agent === 'subagentSpawn',
        'shipped owner declarations were incomplete',
      );

      const { unannotatedCoincidentalNames, singleRoleOmission, directCreateSessionOmission } =
        await verifyOmissionBehaviors({
          cwd,
          projectAccess,
          alternate,
          injectedSession,
          projectedSpawnTool,
          directSessions,
          subagentSessions,
          directPromptWithoutRoles: coincidentalPrompt,
        });

      const alternateBehaviors = {
        skillFallback: true,
        modelVisibleSkillEnrichment: alternatePrompt.includes('## Skills'),
        contextCapacityHint:
          deriveContextCapacityHint(roles.contextReduction) ===
          'Run /reduce-context-alt and retry.',
        agentJobCommandProvenance: agentJobCommandProvenance === 'spawn-subagent-alt',
        subagentSpawnCommandFiltering: !hasProjectedSpawnTool(subagent),
        emptyCommandResultIsPresent:
          emptyFallbackResult?.success === true && emptyFallbackResult.message === '',
      };
      assertCondition(
        Object.values(alternateBehaviors).every(Boolean),
        'an alternate semantic role did not drive its behavior',
      );
      scenarioResult = {
        alternateRoleIds: roles,
        alternateBehaviors,
        unannotatedCoincidentalNames,
        singleRoleOmission,
        directCreateSessionOmission,
        duplicateRoleRejections,
        ownerDeclarations,
      };
    } finally {
      await interactive?.shutdown();
      for (const session of [...subagentSessions, ...directSessions].reverse()) {
        await session.shutdown();
      }
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
