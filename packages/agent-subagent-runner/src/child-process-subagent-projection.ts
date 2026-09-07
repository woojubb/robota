/**
 * What the PARENT projects onto a child-process subagent's start payload.
 *
 * A child rebuilds its own tool surface in another process, so anything the parent's SESSION decided
 * — which assembly tiers it carried, which sandbox it holds — has to travel as data. This module is
 * the producer half of that contract; `worker-composition.ts` is the consumer half.
 *
 * It exists as its own file because review of ARCH-033/ARCH-034 found both fields declared on the
 * wire type and read by the worker while NOTHING wrote them. Keeping the producer beside the
 * consumer's vocabulary, rather than inside a runner that is mostly about process lifecycle, is what
 * makes "who writes this field" answerable by looking.
 *
 * CLI-1994 moved the whole payload builder here from the runner's private method, for the same
 * reason: the ARCH-044 boundary — a fork job's conversation never crosses this wire — is a property
 * of THIS projection, and a test can only pin it against the code that actually produces the payload.
 */

import { BackgroundTaskError } from '@robota-sdk/agent-executor';

import { projectParentConfig } from './parent-config-projection.js';
import { projectParentContext } from './parent-context-projection.js';
import { encodeAgentDefinition, encodeParentContext } from './subagent-worker-start-dto.js';

import type { ISubagentWorkerStartPayload } from './child-process-subagent-ipc.js';
import type { ISandboxProjection } from './worker-composition.js';
import type { IProviderDefinitionConfig } from '@robota-sdk/agent-core';
import type { ISubagentJobStart } from '@robota-sdk/agent-executor';
import type { IAgentDefinition, IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';
import type { ISerializableProviderProfile } from '@robota-sdk/agent-interface-execution';

/** The parent-decided fields of a start payload, ready to spread onto it. */
export interface IProjectedParentState {
  sessionTiers?: IInProcessSubagentRunnerDeps['sessionTiers'];
  sandboxProjection?: ISandboxProjection;
}

/**
 * ARCH-034: the parent's assembly tiers, verbatim.
 *
 * `{ includeGoalTool: false }` and "the parent said nothing" are DIFFERENT states and are kept
 * apart: folding them together would make the tier unreadable in exactly the case a product turns it
 * off deliberately.
 */
function projectSessionTiers(
  deps: Pick<IInProcessSubagentRunnerDeps, 'sessionTiers'>,
): Pick<IProjectedParentState, 'sessionTiers'> {
  return deps.sessionTiers === undefined ? {} : { sessionTiers: deps.sessionTiers };
}

/**
 * ARCH-033: `(type, snapshotId)` for the parent's sandbox, or nothing.
 *
 * BOTH halves are required to produce either. A snapshot with no registered type is a reference
 * nothing on the worker side opens; a type with no snapshot rebuilds an EMPTY sandbox, which is a
 * child that looks sandboxed while sharing none of the parent's state. Silence here is the honest
 * answer for a half-configured composition — `assertChildProcessSubagentsCanReproduce` is what
 * REFUSES it, at the composition root, where it can name the missing piece.
 *
 * A `snapshot()` that throws propagates: the alternative is a child that starts with no sandbox
 * after its parent was asked for one, which is the silent half-capability this exists to prevent.
 */
async function projectSandbox(
  deps: Pick<IInProcessSubagentRunnerDeps, 'sandboxClient' | 'sandboxType'>,
): Promise<Pick<IProjectedParentState, 'sandboxProjection'>> {
  const { sandboxClient, sandboxType } = deps;
  if (sandboxClient?.snapshot === undefined || sandboxType === undefined) return {};
  return { sandboxProjection: { type: sandboxType, snapshotId: await sandboxClient.snapshot() } };
}

/** The runner-owned inputs the payload carries beside the parent's deps. */
export interface IStartPayloadOptions {
  readonly providerConfig?: IProviderDefinitionConfig;
  readonly logsDir?: string;
}

/**
 * The payload the child is started with — ASYNC, because projecting the parent's sandbox means
 * asking it for a snapshot and `snapshot()` returns a promise.
 *
 * NOT an `async` function, deliberately. `resolveAgentDefinition` throws for an unknown agent type,
 * and `start()` has always surfaced that SYNCHRONOUSLY — an `async` body would turn it into a
 * rejected result promise, which is a contract change no caller asked for and which the ARCH-036
 * cases caught immediately. Everything that can be known now is computed now; only the sandbox half
 * waits.
 *
 * CLI-1994 / ARCH-044: `request` crosses VERBATIM — for a fork job that means `resumeSessionId` and
 * nothing more. The conversation the id names stays in the session store on the far side; nothing
 * here reads it, so nothing here can put it on the wire. `subagent-worker-start-dto.test.ts` TC-06
 * pins the key set.
 */
export function projectStartPayload(
  job: ISubagentJobStart,
  deps: IInProcessSubagentRunnerDeps,
  options: IStartPayloadOptions,
): Promise<ISubagentWorkerStartPayload> {
  const definition = resolveAgentDefinition(
    job.request.agentType,
    deps.customAgentRegistry,
    deps.builtInAgents,
    deps.agentDefinitions,
  );
  const base: ISubagentWorkerStartPayload = {
    taskId: job.taskId,
    request: job.request,
    ...(job.worktree ? { worktree: job.worktree } : {}),
    agentDefinition: encodeAgentDefinition(applyRequestOverrides(definition, job)),
    parentConfig: projectParentConfig(deps.config),
    // Issue #2317 narrows to the two members the child reads; ARCH-044 (issue #2047) encodes them.
    parentContext: encodeParentContext(projectParentContext(deps.context)),
    providerProfile: createProviderProfile(options.providerConfig, deps, job),
    permissionMode: deps.permissionMode,
    ...projectSessionTiers(deps),
    ...(options.logsDir ? { logsDir: options.logsDir } : {}),
  };
  return projectSandbox(deps).then((sandbox) => ({ ...base, ...sandbox }));
}

/**
 * ARCH-036: `builtInAgents` is threaded through because NEUT-003 made an injected set REPLACE the
 * module built-ins — an empty array removes them entirely — and the in-process sibling already
 * honours it (`agent-framework/src/subagents/in-process-subagent-runner.ts`). Reading only
 * `customAgentRegistry` here meant the composition root's choice reached one runner and not the
 * other, so selecting a runner for isolation silently also selected a capability.
 */
function resolveAgentDefinition(
  agentType: string,
  customRegistry?: (name: string) => IAgentDefinition | undefined,
  builtInAgents?: readonly IAgentDefinition[],
  agentDefinitions?: readonly IAgentDefinition[],
): IAgentDefinition {
  const definition =
    customRegistry?.(agentType) ??
    builtInAgents?.find((agent) => agent.name === agentType) ??
    agentDefinitions?.find((agent) => agent.name === agentType);
  if (!definition) {
    throw new BackgroundTaskError('validation', `Unknown agent type: ${agentType}`);
  }
  return definition;
}

function applyRequestOverrides(
  definition: IAgentDefinition,
  job: ISubagentJobStart,
): IAgentDefinition {
  return {
    ...definition,
    ...(job.request.model ? { model: job.request.model } : {}),
    ...(job.request.allowedTools ? { tools: job.request.allowedTools } : {}),
    ...(job.request.disallowedTools ? { disallowedTools: job.request.disallowedTools } : {}),
  };
}

function createProviderProfile(
  providerConfig: IProviderDefinitionConfig | undefined,
  deps: IInProcessSubagentRunnerDeps,
  job: ISubagentJobStart,
): ISerializableProviderProfile {
  const provider = providerConfig ?? deps.config.provider;
  // SEC-009: carry the REFERENCE, not the secret. Config loading resolves a `$ENV:` value into the
  // credential itself, so copying `apiKey` here put plaintext into a structured-clone IPC message —
  // a second copy of the secret, in a second process, reachable by anything observing the channel.
  // The child already inherits this process's environment (`env:` at the spawn in the runner), and
  // `resolveProfileApiKey` already reads `apiKeyEnv`, so the reference resolves on the far side with
  // no new plumbing. When no reference was recorded the config genuinely holds a literal and the
  // literal is all there is to send.
  // allow-fallback: a profile storing a plaintext credential has no reference to carry; the
  // org policy `requireApiKeyFromEnv` is the documented way to forbid that storage form.
  const credential = provider.apiKeyEnv
    ? { apiKeyEnv: provider.apiKeyEnv }
    : { apiKey: provider.apiKey };
  return {
    profileName: deps.config.currentProvider,
    type: provider.name,
    model: job.request.model ?? provider.model,
    ...credential,
    baseURL: provider.baseURL,
    timeout: provider.timeout,
    options: provider.options,
  };
}
