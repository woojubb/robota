import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import {
  DuplicateSystemCommandSemanticRoleError,
  InteractiveSession,
  SystemCommandExecutor,
  createContributionSourcesForProjectAccess,
  createSubagentSession,
  deriveContextCapacityHint,
  type ICommandModule,
  type ISystemCommand,
  type ISystemCommandSemanticRoles,
  type ITrustedWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';

import { config, terminal } from './semantic-command-role-project-access.js';

export type TSubagentSession = ReturnType<typeof createSubagentSession>;

export function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function command(
  name: string,
  semanticRole?: ISystemCommand['semanticRole'],
): ISystemCommand {
  return {
    name,
    ...(semanticRole ? { semanticRole } : {}),
    description: name,
    modelInvocable: true,
    execute: () => ({ success: true, message: '' }),
  };
}

export function createTrackedSubagent(
  cwd: string,
  projectedSpawnTool: FunctionTool,
  sessions: TSubagentSession[],
  commandSemanticRoles?: ISystemCommandSemanticRoles,
): TSubagentSession {
  const session = createSubagentSession({
    agentDefinition: { name: 'worker', description: 'Worker', systemPrompt: 'Work' },
    parentConfig: config,
    parentContext: { agentsMd: '', projectNotesMd: '' },
    parentTools: [projectedSpawnTool],
    provider: createScriptedProvider([]).provider,
    terminal: terminal as never,
    cwd,
    ...(commandSemanticRoles ? { commandSemanticRoles } : {}),
  });
  sessions.push(session);
  return session;
}

export function hasProjectedSpawnTool(session: TSubagentSession): boolean {
  return session
    .getToolSchemas()
    .some((schema) => schema.name === 'robota_command_spawn-subagent-alt');
}

export function verifyDuplicateRoleRejections(): {
  constructor: boolean;
  register: boolean;
  replace: boolean;
  preservedCommands: boolean;
} {
  const original = command('original', 'subagentSpawn');
  const duplicate = command('duplicate', 'subagentSpawn');
  const executor = new SystemCommandExecutor([original]);
  const result = { constructor: false, register: false, replace: false };
  try {
    new SystemCommandExecutor([original, duplicate]);
  } catch (error) {
    result.constructor = error instanceof DuplicateSystemCommandSemanticRoleError;
  }
  try {
    executor.register(duplicate);
  } catch (error) {
    result.register = error instanceof DuplicateSystemCommandSemanticRoleError;
  }
  const registerPreserved = hasExactOriginalProjection(executor);
  try {
    executor.replaceCommands([original, duplicate]);
  } catch (error) {
    result.replace = error instanceof DuplicateSystemCommandSemanticRoleError;
  }
  const replacePreserved = hasExactOriginalProjection(executor);
  const preservedCommands = registerPreserved && replacePreserved;
  assertCondition(
    Object.values(result).every(Boolean) && preservedCommands,
    'duplicate rejection was untyped or mutated the selected set',
  );
  return { ...result, preservedCommands };
}

function hasExactOriginalProjection(executor: SystemCommandExecutor): boolean {
  return (
    JSON.stringify(executor.listCommands().map(({ name }) => name)) ===
      JSON.stringify(['original']) &&
    JSON.stringify(executor.getSemanticRoles()) === JSON.stringify({ subagentSpawn: 'original' })
  );
}

export async function verifyOmissionBehaviors(options: {
  cwd: string;
  projectAccess: ITrustedWorkspaceProjectAccess;
  alternate: readonly ISystemCommand[];
  injectedSession: object;
  projectedSpawnTool: FunctionTool;
  subagentSessions: TSubagentSession[];
}): Promise<{
  unannotatedCoincidentalNames: Record<string, boolean>;
  singleRoleOmission: Record<string, Record<string, boolean>>;
}> {
  const { cwd, projectAccess, alternate, projectedSpawnTool, subagentSessions } = options;
  const omissionRoles = {
    skillActivation: new SystemCommandExecutor(alternate.slice(1)).getSemanticRoles(),
    contextReduction: new SystemCommandExecutor([alternate[0]!, alternate[2]!]).getSemanticRoles(),
    subagentSpawn: new SystemCommandExecutor(alternate.slice(0, 2)).getSemanticRoles(),
  };
  const omissionSubagents = {
    skillActivation: createTrackedSubagent(
      cwd,
      projectedSpawnTool,
      subagentSessions,
      omissionRoles.skillActivation,
    ),
    contextReduction: createTrackedSubagent(
      cwd,
      projectedSpawnTool,
      subagentSessions,
      omissionRoles.contextReduction,
    ),
    subagentSpawn: createTrackedSubagent(
      cwd,
      projectedSpawnTool,
      subagentSessions,
      omissionRoles.subagentSpawn,
    ),
  };
  const singleRoleOmission = {
    skillActivation: {
      contextReductionActive:
        deriveContextCapacityHint(omissionRoles.skillActivation.contextReduction) ===
        'Run /reduce-context-alt and retry.',
      subagentSpawnActive: !hasProjectedSpawnTool(omissionSubagents.skillActivation),
    },
    contextReduction: {
      omitted:
        deriveContextCapacityHint(omissionRoles.contextReduction.contextReduction) === undefined,
      subagentSpawnActive: !hasProjectedSpawnTool(omissionSubagents.contextReduction),
    },
    subagentSpawn: {
      contextReductionActive:
        deriveContextCapacityHint(omissionRoles.subagentSpawn.contextReduction) ===
        'Run /reduce-context-alt and retry.',
      omitted: hasProjectedSpawnTool(omissionSubagents.subagentSpawn),
    },
  };
  assertCondition(
    Object.values(singleRoleOmission).every((entry) => Object.values(entry).every(Boolean)),
    'single-role omission did not preserve the other two behaviors',
  );

  const unannotatedCommands = [command('skills'), command('compact'), command('agent')];
  const unannotatedRoles = new SystemCommandExecutor(unannotatedCommands).getSemanticRoles();
  assertCondition(Object.keys(unannotatedRoles).length === 0, 'coincidental names gained roles');
  const unannotatedModule: ICommandModule = {
    name: 'unannotated-coincidental-names',
    systemCommands: unannotatedCommands,
  };
  const unannotatedInteractive = new InteractiveSession({
    session: options.injectedSession as never,
    cwd,
    projectAccess,
    commandModules: [unannotatedModule],
  });
  let unannotatedSkillFallback: Awaited<ReturnType<InteractiveSession['executeCommand']>>;
  try {
    unannotatedSkillFallback = await unannotatedInteractive.executeCommand('audit', 'src/index.ts');
  } finally {
    await unannotatedInteractive.shutdown();
  }
  const unannotatedSubagent = createTrackedSubagent(
    cwd,
    projectedSpawnTool,
    subagentSessions,
    unannotatedRoles,
  );
  const unannotatedCoincidentalNames = {
    skills: unannotatedSkillFallback === null,
    compact: deriveContextCapacityHint(unannotatedRoles.contextReduction) === undefined,
    agent: hasProjectedSpawnTool(unannotatedSubagent),
  };
  assertCondition(
    Object.values(unannotatedCoincidentalNames).every(Boolean),
    'an unannotated coincidental command name gained semantic behavior',
  );

  return {
    unannotatedCoincidentalNames,
    singleRoleOmission,
  };
}
