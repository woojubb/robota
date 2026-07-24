/**
 * Fork skill execution helpers for InteractiveSession.
 *
 * Standalone functions for running skills in forked agent sessions.
 */

import { getBuiltInAgent } from '../agents/built-in-agents.js';
import { createSubagentSession } from '../assembly/create-subagent-session.js';
import { retrieveAgentToolDeps } from '../tools/agent-tool.js';

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
  if (options.allowedTools) {
    return { ...definition, tools: options.allowedTools };
  }
  return definition;
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
    parentConfig: deps.config,
    parentContext: deps.context,
    parentTools: deps.tools,
    provider: deps.provider,
    terminal: deps.terminal,
    isForkWorker: true,
    permissionMode: deps.permissionMode,
    permissionHandler: deps.permissionHandler,
    hooks: deps.hooks,
    hookTypeExecutors: deps.hookTypeExecutors,
    onTextDelta: deps.onTextDelta,
    onToolExecution: deps.onToolExecution,
  });
  return forkSession.run(content);
}
