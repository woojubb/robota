/**
 * Fork skill execution helpers for InteractiveSession.
 *
 * Standalone functions for running skills in forked agent sessions.
 */

import { getBuiltInAgent } from '../agents/built-in-agents.js';
import { createSubagentSession } from '../assembly/create-subagent-session.js';
import { retrieveAgentToolDeps } from '../tools/agent-tool.js';
import { parentConfigWithEffectiveRules } from '../subagents/in-process-subagent-runner.js';

import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { IForkExecutionOptions } from '../commands/index.js';
import type { Session } from '@robota-sdk/agent-session';

function resolveForkAgentDefinition(
  agentType: string,
  options: IForkExecutionOptions,
  parentSession: Session,
): IAgentDefinition {
  const deps = retrieveAgentToolDeps(parentSession);
  // NEUT-003: an injected built-in set replaces the module built-ins here too.
  const definition =
    deps?.customAgentRegistry?.(agentType) ??
    (deps?.builtInAgents
      ? deps.builtInAgents.find((agent) => agent.name === agentType)
      : getBuiltInAgent(agentType));
  if (!definition) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }
  const effort = options.effort ?? definition.effort ?? parentSession.getModelEffort();
  return {
    ...definition,
    ...(options.model ? { model: options.model } : {}),
    ...(options.allowedTools ? { tools: options.allowedTools } : {}),
    ...(effort !== 'auto' ? { effort } : {}),
  };
}

export async function runSkillInFork(
  content: string,
  options: IForkExecutionOptions,
  parentSession: Session,
): Promise<string> {
  const deps = retrieveAgentToolDeps(parentSession);
  if (!deps) {
    throw new Error('Fork execution is not available. Agent runtime deps may not be initialized.');
  }
  const agentType = options.agent ?? 'general-purpose';
  const agentDefinition = resolveForkAgentDefinition(agentType, options, parentSession);
  const forkSession = createSubagentSession({
    agentDefinition,
    // Issue #3081: the rules the parent's gate enforces now (presets included), not the settings file.
    parentConfig: parentConfigWithEffectiveRules(deps),
    parentContext: deps.context,
    parentTools: deps.tools,
    provider: deps.provider,
    terminal: deps.terminal,
    // ARCH-010: a fork continues the SAME conversation in the same place, so it inherits the parent
    // session's root rather than re-deriving one.
    cwd: parentSession.getCwd(),
    isForkWorker: true,
    permissionMode: deps.permissionMode,
    ...(deps.commandSemanticRoles ? { commandSemanticRoles: deps.commandSemanticRoles } : {}),
    ...(deps.modelCommandToolPrefix ? { modelCommandToolPrefix: deps.modelCommandToolPrefix } : {}),
    permissionHandler: deps.permissionHandler,
    hooks: deps.hooks,
    hookTypeExecutors: deps.hookTypeExecutors,
    onTextDelta: deps.onTextDelta,
    onToolExecution: deps.onToolExecution,
  });
  return forkSession.run(content);
}
