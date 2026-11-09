/**
 * What the PARENT projects onto a child-process subagent's start payload.
 *
 * A child rebuilds its own tool surface in another process, so anything the parent's SESSION decided
 * — which assembly tiers it carried, which sandbox it holds — has to travel as data. This module is
 * the producer half of that contract; `worker-composition.ts` is the consumer half.
 *
 * It exists as its own file because a field declared on the
 * wire type and read by the worker while NOTHING writes it is easy to miss. Keeping the producer beside the
 * consumer's vocabulary, rather than inside a runner that is mostly about process lifecycle, is what
 * makes "who writes this field" answerable by looking.
 *
 * The whole payload builder lives here rather than in the runner's private method, for the same
 * reason: the boundary — a plain fork job's conversation never crosses this wire, and a
 * sealing parent's crosses only as the held-record token — is a property of THIS projection, and a
 * test can only pin it against the code that actually produces the payload. A fork job also carries
 * the nonce of the lease its record is lent under, in either mode, and nothing of the record with it.
 */

import { findProviderDefinition } from '@robota-sdk/agent-core';
import {
  BackgroundTaskError,
  connectionEnvironmentNames,
  findConnectionEnvironmentDivergence,
  sealConnectionEnvironment,
} from '@robota-sdk/agent-executor';

import { RESUME_HELD_MAX_CHARACTERS } from './child-process-subagent-ipc.js';
import { projectParentConfig } from './parent-config-projection.js';
import { projectParentContext } from './parent-context-projection.js';
import { encodeAgentDefinition, encodeParentContext } from './subagent-worker-start-dto.js';

import type { ISubagentWorkerStartPayload } from './child-process-subagent-ipc.js';
import type { ISandboxProjection, TParentSandboxSettings, TResumeStoreReference } from './worker-composition.js';
import type {
  IProviderDefinition,
  IProviderDefinitionConfig,
  TArtifactSealing,
} from '@robota-sdk/agent-core';
import type { IConnectionEnvironmentCheck, ISubagentJobStart } from '@robota-sdk/agent-executor';
import type { IAgentDefinition, IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';
import type { ISerializableProviderProfile } from '@robota-sdk/agent-interface/execution';

/** The parent-decided fields of a start payload, ready to spread onto it. */
export interface IProjectedParentState {
  sessionTiers?: IInProcessSubagentRunnerDeps['sessionTiers'];
  sandboxProjection?: ISandboxProjection;
}

/**
 * The parent's assembly tiers, verbatim.
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
 * `(type, snapshotId)` for the parent's sandbox, or nothing.
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
  /** The parent's provider registry: its defaults and the environment each provider reads. */
  readonly providerDefinitions: readonly IProviderDefinition[];
  readonly logsDir?: string;
  readonly keepProviderCredential?: true;
  /** The connection the runner already checked; projected here when absent. */
  readonly connection?: IProjectedConnection;
  /** The parent's sandbox settings as they stand now, read at this spawn. */
  readonly parentSandboxSettings?: TParentSandboxSettings;
  /** The parent seals, so its child does too: the grant its sealer issues when `start` is sent. */
  readonly writeGrant?: string;
  /** From {@link projectStartPayloadSealing}: a sealing parent's fork job's held record. */
  readonly resumeHeld?: string;
  /** A fork job's lease nonce, from the parent store's `lend`. */
  readonly resumeLease?: string;
  readonly resumeStore?: TResumeStoreReference;
}

/** What a sealing parent's fork job hands its child beside the grant; nothing otherwise. */
export interface IProjectedSealing {
  readonly resumeHeld?: string;
}

/** A sealing parent's fork job, as the parent itself goes on knowing it: never on the wire. */
export interface IProjectedFork {
  /** The fork record the job runs. */
  readonly sessionId: string;
  /** The copy handed over was the owner's when the parent wrote it for the fork. */
  readonly startedOwner: boolean;
}

/** {@link IProjectedSealing}, and what the parent keeps of a fork job it handed a record to. */
export interface IProjectedStartSealing {
  readonly payload: IProjectedSealing;
  readonly fork?: IProjectedFork;
}

/**
 * Whether the payload can carry what the parent's sealing needs, checked BEFORE anything is made for
 * the job (a worktree, a child) so that each refusal leaves nothing behind: a sealing parent whose
 * sealer cannot hand its sealing to another process, a fork job whose sealed record cannot be handed
 * over, and a record past the wire bound. It takes nothing and returns nothing: the fork record stays
 * where it is for {@link projectStartPayloadSealing}, so a job that fails before then (preparing its
 * worktree, the connection check) can simply be run again.
 */
export function preflightStartPayloadSealing(
  job: ISubagentJobStart,
  deps: Pick<IInProcessSubagentRunnerDeps, 'resumeSessionStore'>,
  logSealing: TArtifactSealing,
): void {
  exportStartPayloadSealing(job, deps, logSealing, true);
  preflightForkRecordWriter(job, deps);
}

/**
 * Refuses, before anything is made for it, a fork job whose record the parent could not lend: the
 * parent keeps no session store, or the record has a writer already (another session or process has
 * it open). Only looks: the lend itself is made when the job starts.
 */
export function preflightForkRecordWriter(
  job: ISubagentJobStart,
  deps: Pick<IInProcessSubagentRunnerDeps, 'resumeSessionStore'>,
): void {
  const resumeSessionId = job.request.resumeSessionId;
  if (resumeSessionId === undefined) return;
  const store = deps.resumeSessionStore;
  if (store === undefined) {
    throw new BackgroundTaskError(
      'validation',
      `Session ${resumeSessionId} cannot be handed to a subagent: this session keeps no session ` +
        'store to lend it from. The subagent was not started.',
    );
  }
  if (store.hasWriter(resumeSessionId)) {
    throw new BackgroundTaskError(
      'validation',
      `Session ${resumeSessionId} already has a writer — another session or process has it open — ` +
        'so it cannot be handed to a subagent. The subagent was not started.',
    );
  }
}

/**
 * What the payload carries for how the parent keeps its subagent logs, with the sealing refusals of
 * {@link preflightStartPayloadSealing}.
 *
 * A plain parent adds nothing: its child keeps its log plain and reads a fork record from the store
 * itself. A sealing parent's sealer must issue a write grant, which is read here
 * only to see that it can: the payload carries the grant as it stands when `start` is sent. For a
 * fork job it hands over the record its store holds (`exportHeld`), since a child never holds the
 * keys that open a sealed one — only once every refusal above has been checked on a look that takes
 * nothing. Exporting hands over a fork record `/fork` just wrote once, so this is called only once the
 * child exists, and a job that fails after this point needs a fresh `/fork` while the keys are locked.
 */
export function projectStartPayloadSealing(
  job: ISubagentJobStart,
  deps: Pick<IInProcessSubagentRunnerDeps, 'resumeSessionStore'>,
  logSealing: TArtifactSealing,
): IProjectedStartSealing {
  return exportStartPayloadSealing(job, deps, logSealing, false);
}

/**
 * Both of the above; `keep` leaves the fork record where it is for a later export.
 *
 * Only the copy a handoff save left is handed over (`handoffOnly`), never a record opened from the
 * file, which anyone with the public key could have sealed: when that copy is gone the job needs a
 * fresh fork. Whose that copy was is read in the same turn as the export, as a probe of the copy the
 * export hands over, so the parent knows whether the job started from the owner's content.
 */
function exportStartPayloadSealing(
  job: ISubagentJobStart,
  deps: Pick<IInProcessSubagentRunnerDeps, 'resumeSessionStore'>,
  logSealing: TArtifactSealing,
  keep: boolean,
): IProjectedStartSealing {
  if (logSealing === 'plain') return { payload: {} };
  const sealer = logSealing.sealer;
  if (sealer.writeGrant === undefined) {
    throw new BackgroundTaskError(
      'validation',
      'This session seals its logs, but its sealer cannot hand its sealing to a subagent; the ' +
        'subagent was not started.',
    );
  }
  sealer.writeGrant();
  const resumeSessionId = job.request.resumeSessionId;
  if (resumeSessionId === undefined) return { payload: {} };
  const store = deps.resumeSessionStore;
  // Every check is made on a look that takes nothing; the record is handed over only once nothing
  // can refuse the job any more, since the copy `/fork` left is handed over once.
  const looked = store?.exportHeld?.(resumeSessionId, { keep: true, handoffOnly: true });
  if (looked === undefined) {
    throw new BackgroundTaskError('validation', unhandedRecordMessage(resumeSessionId, store));
  }
  if (looked.length > RESUME_HELD_MAX_CHARACTERS) {
    throw new BackgroundTaskError(
      'validation',
      `Session ${resumeSessionId} is too large to hand to a subagent (the limit is 32 MiB); the ` +
        'subagent was not started.',
    );
  }
  if (keep) return { payload: { resumeHeld: looked } };
  const written = store?.load(resumeSessionId);
  const resumeHeld = store?.exportHeld?.(resumeSessionId, { handoffOnly: true });
  if (resumeHeld === undefined) {
    throw new BackgroundTaskError('validation', unhandedRecordMessage(resumeSessionId, store));
  }
  const startedOwner =
    written?.status === 'valid' && written.authorship === 'verified' && written.diverged !== true;
  return {
    payload: { resumeHeld },
    fork: { sessionId: resumeSessionId, startedOwner },
  };
}

/**
 * Why a fork record could not be handed over, from what the store says of it now — a probe, which
 * remembers nothing. Only locked keys are something an unlock fixes; a record that is missing, does
 * not open, was written by another build or was never sealed stays that way, so its message does not
 * send anyone to unlock.
 */
function unhandedRecordMessage(
  resumeSessionId: string,
  store: IInProcessSubagentRunnerDeps['resumeSessionStore'],
): string {
  const outcome = store?.load(resumeSessionId);
  if (outcome?.status === 'locked' && outcome.reason === undefined) {
    return (
      `Session ${resumeSessionId} is sealed and could not be handed to its subagent: the keys ` +
      'are locked and this session no longer holds the record. Unlock, then run /fork again.'
    );
  }
  if (outcome?.status === 'valid' || outcome?.status === 'locked') {
    return (
      `Session ${resumeSessionId} could not be handed to its subagent: this session no longer ` +
      'holds the copy /fork wrote for it, or the file changed since. The subagent was not ' +
      'started; run /fork again.'
    );
  }
  return (
    `Session ${resumeSessionId} could not be handed to its subagent: its saved record is missing, ` +
    'does not open, or is not sealed, so this session has nothing to hand over. The subagent was ' +
    'not started; run /fork again.'
  );
}

/** The provider connection a child is given, and the check it repeats before using it. */
export interface IProjectedConnection {
  readonly providerProfile: ISerializableProviderProfile;
  readonly connectionCheck: IConnectionEnvironmentCheck;
}

/**
 * The parent's provider connection, checked against the environment the child will run in.
 *
 * Throws, naming the variable and never its value, when the child's environment would decide the
 * destination or the credential differently from the parent's — before anything is spawned or sent,
 * so the credential never reaches a process that would use it elsewhere.
 */
export function projectProviderConnection(
  job: ISubagentJobStart,
  deps: IInProcessSubagentRunnerDeps,
  options: Pick<IStartPayloadOptions, 'providerConfig' | 'providerDefinitions'>,
  parentEnv: NodeJS.ProcessEnv,
  childEnv: NodeJS.ProcessEnv,
): IProjectedConnection {
  const definitions = options.providerDefinitions;
  const type = (options.providerConfig ?? deps.config.provider).name;
  // Fail closed: without the provider's definition the parent can neither complete the connection
  // nor know which environment its client reads, and the child builds exactly what it is given.
  if (findProviderDefinition(definitions, type) === undefined) {
    throw new BackgroundTaskError(
      'validation',
      `No provider definition for "${type}" was given to the subagent runner, so the connection a ` +
        'child would make cannot be checked; the subagent was not started.',
    );
  }
  const providerProfile = createProviderProfile(options.providerConfig, deps, job, definitions);
  const names = connectionEnvironmentNames(providerProfile, definitions);
  const diverging = findConnectionEnvironmentDivergence(names, parentEnv, childEnv);
  if (diverging !== undefined) {
    throw new BackgroundTaskError(
      'validation',
      `The subagent's environment sets ${diverging} differently from this session, which would ` +
        'change where its provider connects or which credential it sends; the subagent was not started.',
    );
  }
  return { providerProfile, connectionCheck: sealConnectionEnvironment(names, childEnv) };
}

/**
 * The payload the child is started with — ASYNC, because projecting the parent's sandbox means
 * asking it for a snapshot and `snapshot()` returns a promise.
 *
 * NOT an `async` function, deliberately. `resolveAgentDefinition` throws for an unknown agent type,
 * and `start()` has always surfaced that SYNCHRONOUSLY — an `async` body would turn it into a
 * rejected result promise, which is a contract change no caller asked for and which the synchronous-throw
 * cases catch immediately. Everything that can be known now is computed now; only the sandbox half
 * waits.
 *
 * `request` crosses VERBATIM — for a fork job that means `resumeSessionId` and
 * nothing more. For a plain parent the conversation the id names stays in the session store on the
 * far side; nothing here reads it, so nothing here can put it on the wire. A sealing parent's record
 * arrives already exported, as `options.resumeHeld`, and is placed at the top level only.
 * `subagent-worker-start-dto.test.ts` pins the key set.
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
    // The rules the parent's gate enforces now, not its settings file's.
    parentConfig: projectParentConfig(
      deps.getParentPermissionRules === undefined
        ? deps.config
        : { ...deps.config, permissions: deps.getParentPermissionRules() },
    ),
    // Narrows to the two members the child reads, then encodes them.
    parentContext: encodeParentContext(projectParentContext(deps.context)),
    ...(options.connection ??
      projectProviderConnection(job, deps, options, process.env, process.env)),
    permissionMode: deps.getParentPermissionMode?.() ?? deps.permissionMode,
    ...projectSessionTiers(deps),
    ...(options.parentSandboxSettings !== undefined
      ? { parentSandboxSettings: options.parentSandboxSettings }
      : {}),
    ...(options.logsDir ? { logsDir: options.logsDir } : {}),
    ...(options.keepProviderCredential ? { keepProviderCredential: true as const } : {}),
    ...(options.writeGrant !== undefined ? { writeGrant: options.writeGrant } : {}),
    ...(options.resumeHeld !== undefined ? { resumeHeld: options.resumeHeld } : {}),
    ...(options.resumeLease !== undefined ? { resumeLease: options.resumeLease } : {}),
    ...(job.request.resumeSessionId !== undefined && options.resumeStore !== undefined
      ? {
          resumeStore:
            options.resumeStore.scope === 'user'
              ? { scope: 'user' as const }
              : {
                  scope: 'project' as const,
                  repositoryKey: options.resumeStore.repositoryKey,
                  worktreeRoot: options.resumeStore.worktreeRoot,
                },
        }
      : {}),
  };
  return projectSandbox(deps).then((sandbox) => ({ ...base, ...sandbox }));
}

/**
 * `builtInAgents` is threaded through because an injected set REPLACES the
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
    ...(job.request.effort !== undefined ? { effort: job.request.effort } : {}),
    ...(job.request.allowedTools ? { tools: job.request.allowedTools } : {}),
    ...(job.request.disallowedTools ? { disallowedTools: job.request.disallowedTools } : {}),
  };
}

const ENV_REFERENCE_PREFIX = '$ENV:';

/**
 * The credential the child resolves: the profile's own, or else its definition's default — sent as
 * the variable it names, so the child reads the same variable and the check compares it.
 */
function projectCredential(
  provider: IProviderDefinitionConfig,
  defaultApiKey: string | undefined,
): Pick<ISerializableProviderProfile, 'apiKey' | 'apiKeyEnv' | 'apiKeyRef'> {
  if (provider.apiKeyRef !== undefined) return { apiKeyRef: provider.apiKeyRef };
  if (provider.apiKeyEnv !== undefined) return { apiKeyEnv: provider.apiKeyEnv };
  if (provider.apiKey !== undefined) return { apiKey: provider.apiKey };
  if (defaultApiKey === undefined) return {};
  return defaultApiKey.startsWith(ENV_REFERENCE_PREFIX)
    ? { apiKeyEnv: defaultApiKey.slice(ENV_REFERENCE_PREFIX.length) }
    : { apiKey: defaultApiKey };
}

function createProviderProfile(
  providerConfig: IProviderDefinitionConfig | undefined,
  deps: IInProcessSubagentRunnerDeps,
  job: ISubagentJobStart,
  providerDefinitions: readonly IProviderDefinition[],
): ISerializableProviderProfile {
  const provider = providerConfig ?? deps.config.provider;
  // The EFFECTIVE connection: the child builds it exactly, never filling a gap from its own
  // registry's defaults, so the parent's defaults are applied here.
  const defaults = findProviderDefinition(providerDefinitions, provider.name)?.defaults ?? {};
  const baseURL = provider.baseURL ?? defaults.baseURL;
  const options = provider.options ?? defaults.options;
  // Carry the REFERENCE, not the secret. Config loading resolves a `$ENV:` value into the
  // credential itself, so copying `apiKey` here put plaintext into a structured-clone IPC message —
  // a second copy of the secret, in a second process, reachable by anything observing the channel.
  // The host supplies the referenced variable in the worker environment, and
  // `resolveProfileApiKey` reads `apiKeyEnv` there. No credential value crosses IPC.
  // allow-fallback: a profile storing a plaintext credential has no reference to carry; the
  // org policy `requireApiKeyFromEnv` is the documented way to forbid that storage form.
  const credential = projectCredential(provider, defaults.apiKey);
  return {
    // Named only when it names THIS connection. A runner-supplied config may come from a different
    // profile (`--provider`) than the settings' current one.
    ...(providerConfig === undefined && deps.config.currentProvider !== undefined
      ? { profileName: deps.config.currentProvider }
      : {}),
    type: provider.name,
    model: job.request.model ?? provider.model,
    ...credential,
    ...(baseURL !== undefined ? { baseURL } : {}),
    ...(provider.timeout !== undefined ? { timeout: provider.timeout } : {}),
    ...(options !== undefined ? { options } : {}),
  };
}
