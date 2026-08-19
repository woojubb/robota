import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import {
  DuplicateSystemCommandSemanticRoleError,
  InteractiveSession,
  SystemCommandExecutor,
  createSession,
  createSubagentSession,
  deriveContextCapacityHint,
  type ICommandModule,
  type IResolvedConfig,
  type ISystemCommand,
  type ISystemCommandSemanticRoles,
} from '@robota-sdk/agent-framework';

export type TDirectSession = ReturnType<typeof createSession>['session'];
export type TSubagentSession = ReturnType<typeof createSubagentSession>;

export const config: IResolvedConfig = {
  defaultTrustLevel: 'moderate',
  provider: { name: 'scripted-test-provider', apiKey: 'offline', model: 'scripted' },
  permissions: { allow: [], deny: [] },
  language: 'en',
  env: {},
};

export const terminal = {
  write: () => {},
  writeLine: () => {},
  spinner: () => ({ stop: () => {} }),
};

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

/**
 * ARCH-035 made `createSession` async. This helper is `async` for that reason alone — awaiting the
 * result is not a style choice here: `created.session` on an unawaited promise is `undefined`, and
 * the failure surfaces two frames away as a missing method on the session.
 */
export async function readSystemMessage(
  cwd: string,
  commandName: string,
  sessions: TDirectSession[],
  commandSemanticRoles?: ISystemCommandSemanticRoles,
): Promise<string> {
  const created = await createSession({
    config,
    cwd,
    context: { agentsMd: '', projectNotesMd: '' },
    terminal: terminal as never,
    provider: createScriptedProvider([]).provider,
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
  sessions.push(created.session);
  return created.session.getSystemMessage();
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
  alternate: readonly ISystemCommand[];
  injectedSession: object;
  projectedSpawnTool: FunctionTool;
  directSessions: TDirectSession[];
  subagentSessions: TSubagentSession[];
  directPromptWithoutRoles: string;
}): Promise<{
  unannotatedCoincidentalNames: Record<string, boolean>;
  singleRoleOmission: Record<string, Record<string, boolean>>;
  directCreateSessionOmission: { allRolesAbsent: boolean };
}> {
  const { cwd, alternate, projectedSpawnTool, directSessions, subagentSessions } = options;
  const omissionRoles = {
    skillActivation: new SystemCommandExecutor(alternate.slice(1)).getSemanticRoles(),
    contextReduction: new SystemCommandExecutor([alternate[0]!, alternate[2]!]).getSemanticRoles(),
    subagentSpawn: new SystemCommandExecutor(alternate.slice(0, 2)).getSemanticRoles(),
  };
  const prompts = {
    skillActivation: await readSystemMessage(
      cwd,
      'activate-skill-alt',
      directSessions,
      omissionRoles.skillActivation,
    ),
    contextReduction: await readSystemMessage(
      cwd,
      'activate-skill-alt',
      directSessions,
      omissionRoles.contextReduction,
    ),
    subagentSpawn: await readSystemMessage(
      cwd,
      'activate-skill-alt',
      directSessions,
      omissionRoles.subagentSpawn,
    ),
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
      omitted: !prompts.skillActivation.includes('## Skills'),
      contextReductionActive:
        deriveContextCapacityHint(omissionRoles.skillActivation.contextReduction) ===
        'Run /reduce-context-alt and retry.',
      subagentSpawnActive: !hasProjectedSpawnTool(omissionSubagents.skillActivation),
    },
    contextReduction: {
      skillActivationActive: prompts.contextReduction.includes('## Skills'),
      omitted:
        deriveContextCapacityHint(omissionRoles.contextReduction.contextReduction) === undefined,
      subagentSpawnActive: !hasProjectedSpawnTool(omissionSubagents.contextReduction),
    },
    subagentSpawn: {
      skillActivationActive: prompts.subagentSpawn.includes('## Skills'),
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
    commandModules: [unannotatedModule],
  });
  let unannotatedSkillFallback: Awaited<ReturnType<InteractiveSession['executeCommand']>>;
  try {
    unannotatedSkillFallback = await unannotatedInteractive.executeCommand('audit', 'src/index.ts');
  } finally {
    await unannotatedInteractive.shutdown();
  }
  const unannotatedPrompt = await readSystemMessage(
    cwd,
    'skills',
    directSessions,
    unannotatedRoles,
  );
  const unannotatedSubagent = createTrackedSubagent(
    cwd,
    projectedSpawnTool,
    subagentSessions,
    unannotatedRoles,
  );
  const unannotatedCoincidentalNames = {
    skills: unannotatedSkillFallback === null && !unannotatedPrompt.includes('## Skills'),
    compact: deriveContextCapacityHint(unannotatedRoles.contextReduction) === undefined,
    agent: hasProjectedSpawnTool(unannotatedSubagent),
  };
  assertCondition(
    Object.values(unannotatedCoincidentalNames).every(Boolean),
    'an unannotated coincidental command name gained semantic behavior',
  );

  const directSubagent = createTrackedSubagent(cwd, projectedSpawnTool, subagentSessions);
  const directOmissionBehavior = {
    skillActivationAbsent: !options.directPromptWithoutRoles.includes('## Skills'),
    contextReductionAbsent: deriveContextCapacityHint(undefined) === undefined,
    subagentSpawnAbsent: hasProjectedSpawnTool(directSubagent),
  };
  assertCondition(
    Object.values(directOmissionBehavior).every(Boolean),
    'direct session creation without roles gained semantic behavior',
  );
  return {
    unannotatedCoincidentalNames,
    singleRoleOmission,
    directCreateSessionOmission: {
      allRolesAbsent: Object.values(directOmissionBehavior).every(Boolean),
    },
  };
}
