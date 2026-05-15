/**
 * Agent job helpers for InteractiveSession.
 *
 * Pure functions for spawning, waiting, sending, cancelling, and closing
 * agent jobs. The class delegates to these with thin wrappers.
 */

import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import { retrieveAgentToolDeps } from '../tools/agent-tool.js';
import type { ISubagentJobResult, ISubagentJobState } from '../subagents/index.js';
import type { Session } from '@robota-sdk/agent-sessions';
import type { TBackgroundTaskIsolation } from '../background-tasks/index.js';
import { createExecutionOriginMetadata } from '../background-tasks/index.js';
import type { TCommandInvocationSource } from '../commands/index.js';

/** Retrieve agent tool deps or throw. */
export function getAgentToolDepsOrThrow(
  session: Session,
): NonNullable<ReturnType<typeof retrieveAgentToolDeps>> {
  const deps = retrieveAgentToolDeps(session);
  if (!deps) throw new Error('Agent runtime dependencies are not available for this session.');
  if (!deps.backgroundTaskManager)
    throw new Error('Background task manager is not available for this session.');
  return deps;
}

/** Retrieve subagent manager or throw. */
export function getSubagentManagerOrThrow(session: Session) {
  const deps = getAgentToolDepsOrThrow(session);
  if (!deps.subagentManager) throw new Error('Subagent manager is not available for this session.');
  return deps.subagentManager;
}

/** Resolve an agent definition by type or throw. */
export function resolveAgentDefinition(
  agentType: string,
  deps: NonNullable<ReturnType<typeof retrieveAgentToolDeps>>,
): IAgentDefinition {
  const definition = deps.customAgentRegistry?.(agentType);
  if (!definition) throw new Error(`Unknown agent type: ${agentType}`);
  return definition;
}

/** List agent definitions available in the session. */
export function listAgentDefinitionsFromSession(
  session: Session,
): Array<{ name: string; description: string }> {
  const deps = retrieveAgentToolDeps(session);
  return (deps?.agentDefinitions ?? []).map((agent) => ({
    name: agent.name,
    description: agent.description,
  }));
}

export interface ISpawnAgentJobInput {
  agentType: string;
  label: string;
  mode: 'foreground' | 'background';
  prompt: string;
  model?: string;
  isolation?: TBackgroundTaskIsolation;
}

/** Spawn a new agent job with the given parameters. */
export async function spawnAgentJobFromSession(
  session: Session,
  input: ISpawnAgentJobInput,
  cwd: string | undefined,
  invocationSource: TCommandInvocationSource,
): Promise<ISubagentJobState> {
  const deps = getAgentToolDepsOrThrow(session);
  const definition = resolveAgentDefinition(input.agentType, deps);
  const sessionId = session.getSessionId();
  const manager = getSubagentManagerOrThrow(session);
  return manager.spawn({
    type: input.agentType,
    label: input.label,
    parentSessionId: sessionId,
    mode: input.mode,
    depth: (deps.subagentDepth ?? 0) + 1,
    cwd: deps.cwd ?? cwd ?? process.cwd(),
    prompt: input.prompt,
    model: input.model ?? definition.model,
    isolation: input.isolation,
    allowedTools: definition.tools,
    disallowedTools: definition.disallowedTools,
    metadata: createExecutionOriginMetadata({
      kind: invocationSource === 'model' ? 'model_command' : 'slash_command',
      sessionId,
      commandName: 'agent',
      label: input.label,
    }),
  });
}

/** Wait for an agent job to complete and return its result. */
export async function waitAgentJobFromSession(
  session: Session,
  jobId: string,
): Promise<ISubagentJobResult> {
  return getSubagentManagerOrThrow(session).wait(jobId);
}

/** Send a prompt to a running agent job. */
export async function sendAgentJobFromSession(
  session: Session,
  jobId: string,
  prompt: string,
): Promise<void> {
  await getSubagentManagerOrThrow(session).send(jobId, prompt);
}

/** Cancel a running agent job. */
export async function cancelAgentJobFromSession(
  session: Session,
  jobId: string,
  reason?: string,
): Promise<void> {
  await getSubagentManagerOrThrow(session).cancel(jobId, reason);
}

/** Close a completed or failed agent job. */
export async function closeAgentJobFromSession(session: Session, jobId: string): Promise<void> {
  await getSubagentManagerOrThrow(session).close(jobId);
}

/** List all agent jobs in the session. */
export function listAgentJobsFromSession(session: Session): ISubagentJobState[] {
  return getSubagentManagerOrThrow(session).list();
}
