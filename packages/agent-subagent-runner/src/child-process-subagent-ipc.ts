import {
  decodeAgentDefinitionDto,
  decodeParentContextDto,
  type ISubagentWorkerAgentDefinitionDto,
  type ISubagentWorkerParentContextDto,
} from './subagent-worker-start-dto.js';

import type { ISandboxProjection, TParentSandboxSettings } from './worker-composition.js';
import type { ISessionUsageTotals, TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import type { IConnectionEnvironmentCheck } from '@robota-sdk/agent-executor';
import type { IResolvedConfig } from '@robota-sdk/agent-framework';
import type {
  ISerializableProviderProfile,
  ISubagentSpawnRequest,
} from '@robota-sdk/agent-interface-execution';

export type TSubagentWorkerWireValue = string | number | boolean | null | undefined | object;

type TSubagentWorkerWireRecord = Record<string, TSubagentWorkerWireValue>;

/** ARCH-044: the four config members the child reads. See `projectParentConfig`. */
export interface ISubagentWorkerParentConfig {
  readonly provider: { readonly model: string };
  readonly permissions: IResolvedConfig['permissions'];
  readonly defaultTrustLevel: IResolvedConfig['defaultTrustLevel'];
  readonly hooks?: IResolvedConfig['hooks'];
}

export interface ISubagentWorkerStartPayload {
  taskId: string;
  request: ISubagentSpawnRequest;
  /**
   * ARCH-031: the worktree the parent's runner prepared, carried across the fork so the child can
   * answer `subagentExecutionRoot` the same way the parent would. Runner-produced, so it rides beside
   * the request rather than on it.
   *
   * `branch` crosses the fork too, even though nothing reads it here yet: dropping it at the IPC
   * boundary would make the child's view of its own isolated run poorer than the parent's, for no
   * reason other than the absence of a present-day consumer.
   */
  worktree?: { readonly path: string; readonly branch?: string };
  /** ARCH-044 (issue #2047): a JSON-safe DTO owned here, projected from `IAgentDefinition` by the parent. */
  agentDefinition: ISubagentWorkerAgentDefinitionDto;
  /**
   * ARCH-044 (issue #2047): the config members the child reads, declared here rather than indexed
   * out of the runtime type.
   *
   * It was `IInProcessSubagentRunnerDeps['config']`, so the wire shape was the in-process shape and
   * grew with it — which put the parent's resolved `provider.apiKey` and its `env` map into a second
   * process where nothing read either. Declaring the members means a new field on `IResolvedConfig`
   * does not reach the child by default; `projectParentConfig` is what enforces it at runtime,
   * because structural typing would accept the whole config here.
   */
  parentConfig: ISubagentWorkerParentConfig;
  /**
   * ARCH-044 (issue #2047): a JSON-safe DTO owned here, decoded totally on the child side. The parent
   * fills it from `projectParentContext` (issue #2317): the two context members the child reads —
   * `agentsMd` and `projectNotesMd` — and never the parent's whole `ILoadedContext`, whose file
   * entries carry the full text of every AGENTS.md and CLAUDE.md the parent loaded.
   */
  parentContext: ISubagentWorkerParentContextDto;
  providerProfile: ISerializableProviderProfile;
  /**
   * The destination-deciding environment the parent checked before spawning, sealed so the child can
   * repeat the check before it builds a provider. Values never travel; only a keyed digest does.
   */
  connectionCheck: IConnectionEnvironmentCheck;
  /**
   * ARCH-033: how the child rebuilds the parent's sandbox, as `(type, snapshotId)`.
   *
   * The live client cannot cross a process boundary — it is an open session against a remote machine.
   * This pair can: the type selects a factory the composition root registered, and the snapshot is a
   * provider-owned reference the parent's `snapshot()` returned. Both halves are required, because a
   * snapshot with no registry is a reference nothing opens and a registry with no snapshot rebuilds
   * an EMPTY sandbox — a child that looks sandboxed while sharing none of the parent's state.
   *
   * Absent ⇒ the parent holds no sandbox, which is every product that has not registered one.
   */
  sandboxProjection?: ISandboxProjection;
  /**
   * ARCH-034: which session-assembly tiers the parent's surface carried.
   *
   * A property of the parent's SESSION rather than of the child's root, so it rides on the payload
   * beside the request instead of being derived at the child. Absent ⇒ the parent had none.
   */
  sessionTiers?: { readonly includeGoalTool?: boolean };
  /**
   * The parent's sandbox settings as they stand at spawn, including a change made this session.
   * Opaque here: the composition root produced it and its `createSandbox` reads it, so the child
   * confines and approves as the parent does now, not as its root's settings files say.
   */
  parentSandboxSettings?: TParentSandboxSettings;
  permissionMode?: TPermissionMode;
  logsDir?: string;
  /** The owner opted the provider credential variable in for commands; the worker keeps it. */
  keepProviderCredential?: true;
  /**
   * The parent seals: its sealer's write grant, which the child binds before it builds anything and
   * seals its log (and a resumed record) with. Not a secret — it seals and opens nothing — and the
   * child never reads a keyring of its own. Absent ⇒ the parent keeps its logs plain.
   */
  writeGrant?: string;
  /**
   * A sealing parent's fork job: the record the parent holds for `request.resumeSessionId`, as the
   * opaque token its store exported. It crosses because a child never holds the keys that open a
   * sealed record; it carries the conversation, so only here and never on the request, and at most
   * {@link RESUME_HELD_MAX_CHARACTERS} characters.
   */
  resumeHeld?: string;
  /**
   * A fork job, in either mode: the nonce of the lease the parent lent `request.resumeSessionId`
   * under. The child claims the record with it, taking the parent's writer marker over, so the record
   * has one writer while the child runs. Not the conversation; it rides only beside the id it resumes.
   */
  resumeLease?: string;
}

/** The most token characters a held record may take on the wire; a larger one fails the job before spawning. */
export const RESUME_HELD_MAX_CHARACTERS = 32 * 1024 * 1024;

export interface ISubagentWorkerStartMessage {
  type: 'start';
  payload: ISubagentWorkerStartPayload;
}

export interface ISubagentWorkerSendMessage {
  type: 'send';
  prompt: string;
}

export interface ISubagentWorkerCancelMessage {
  type: 'cancel';
  reason?: string;
}

/** The parent's sandbox settings changed while the child runs (`/sandbox`); the child follows. */
export interface ISubagentWorkerSandboxSettingsMessage {
  type: 'sandbox_settings';
  settings: TParentSandboxSettings;
}

/**
 * The key a sealing parent seals to was verified or changed while the child runs (its first unlock
 * found the key the child was started with to be another): the child seals to the new grant's key
 * from now on.
 */
export interface ISubagentWorkerSealingKeyMessage {
  type: 'sealing_key';
  grant: string;
}

/**
 * Issue #3288 §1: the three-way answer a permission ask can receive — the same shape
 * `@robota-sdk/agent-session`'s `TPermissionResult` allows, inlined here so this wire module does not
 * need that package as a dependency for one literal union.
 */
export type TSubagentWorkerPermissionResult = boolean | 'allow-session' | 'allow-project';

/**
 * Issue #3288 §1: the parent's answer to a `permission_request` the child raised, correlated by
 * `requestId`. `false` when the parent has no approver attached (print mode) — the fail-closed
 * default, not a special case the child has to know about.
 */
export interface ISubagentWorkerPermissionResponseMessage {
  type: 'permission_response';
  requestId: string;
  result: TSubagentWorkerPermissionResult;
}

export type TSubagentWorkerParentMessage =
  | ISubagentWorkerStartMessage
  | ISubagentWorkerSendMessage
  | ISubagentWorkerCancelMessage
  | ISubagentWorkerSandboxSettingsMessage
  | ISubagentWorkerSealingKeyMessage
  | ISubagentWorkerPermissionResponseMessage;

export interface ISubagentWorkerReadyMessage {
  type: 'ready';
  /**
   * ARCH-021: the tool names the child actually composed, so "the child has the product's surface"
   * is VERIFIED per run rather than assumed by construction. Names only — the tools themselves are
   * code and do not cross this boundary; that is the whole point of the composition port.
   *
   * Enumerated at the worker's own cwd before any job arrives, which is sound because a pack's tool
   * NAMES do not depend on the root (the root binds the path guard, not the name set).
   */
  composedToolNames?: readonly string[];
}

export interface ISubagentWorkerTextDeltaMessage {
  type: 'text_delta';
  delta: string;
}

export interface ISubagentWorkerToolStartMessage {
  type: 'tool_start';
  toolName: string;
  toolArgs?: TToolArgs;
}

export interface ISubagentWorkerToolEndMessage {
  type: 'tool_end';
  toolName: string;
  success: boolean;
}

/**
 * Issue #3288 §1: a tool call inside the child needs a human's approval. `requestId` correlates this
 * with the parent's eventual `permission_response`; the child parks the call until it arrives (or
 * until its own turn is cancelled, which the enforcer's existing signal race already denies).
 */
export interface ISubagentWorkerPermissionRequestMessage {
  type: 'permission_request';
  requestId: string;
  toolName: string;
  toolArgs?: TToolArgs;
}

export interface ISubagentWorkerResultMessage {
  type: 'result';
  output: string;
  /** ANALYTICS-001 (Phase 2): total token usage of the subagent run, forwarded to the parent. */
  usage?: ISessionUsageTotals;
  /**
   * A save of the fork record this job was handed was refused, because something the child cannot
   * verify changed the file. Sent only by a child that was handed a record (`resumeHeld`).
   */
  recordSaveRefused?: true;
}

export interface ISubagentWorkerErrorMessage {
  type: 'error';
  message: string;
  /** As on {@link ISubagentWorkerResultMessage}: the job ended after a save of its fork record was refused. */
  recordSaveRefused?: true;
}

export interface ISubagentWorkerCancelledMessage {
  type: 'cancelled';
  reason?: string;
}

/**
 * #3679: a child handed a sealed record (`resumeHeld`) says, after each save of it, which stored bytes
 * it wrote — the only bytes its parent may then vouch for as the owner's, once the child is gone. A
 * parent that handed no record over takes it as a message it did not ask for.
 */
export interface ISubagentWorkerRecordSavedMessage {
  type: 'record_saved';
  sessionId: string;
  /** The SHA-256 (lowercase hex) of the stored bytes the save wrote. */
  sha256: string;
}

export type TSubagentWorkerChildMessage =
  | ISubagentWorkerReadyMessage
  | ISubagentWorkerTextDeltaMessage
  | ISubagentWorkerToolStartMessage
  | ISubagentWorkerToolEndMessage
  | ISubagentWorkerPermissionRequestMessage
  | ISubagentWorkerResultMessage
  | ISubagentWorkerErrorMessage
  | ISubagentWorkerCancelledMessage
  | ISubagentWorkerRecordSavedMessage;

function isRecord(value: TSubagentWorkerWireValue): value is TSubagentWorkerWireRecord {
  return typeof value === 'object' && value !== null;
}

/** A sealed connection check: names, a nonce and a digest, all strings. */
function isConnectionCheck(value: TSubagentWorkerWireValue): boolean {
  if (!isRecord(value)) return false;
  if (!hasString(value, 'nonce') || !hasString(value, 'digest')) return false;
  const names = value.names;
  return Array.isArray(names) && names.every((name) => typeof name === 'string');
}

/**
 * ARCH-031: `key` is `string`, so a renamed contract field compiles clean here and then rejects every
 * payload at runtime — which is exactly what a `type` → `agentType` rename would have done, silently.
 * The typed overloads below make the next rename a compile error instead.
 */
function hasString(value: TSubagentWorkerWireRecord, key: string): boolean {
  return typeof value[key] === 'string';
}

/** Assert a key that must exist on the spawn request, so a contract rename is compiler-found. */
function hasRequestString(
  value: TSubagentWorkerWireRecord,
  key: keyof ISubagentSpawnRequest & string,
): boolean {
  return hasString(value, key);
}

/** Assert a key that must exist on the worker start payload, for the same reason. */
function hasPayloadString(
  value: TSubagentWorkerWireRecord,
  key: keyof ISubagentWorkerStartPayload & string,
): boolean {
  return hasString(value, key);
}

/** An OPTIONAL request key: absent is valid, present must be a string — typed against the request. */
function hasOptionalRequestString(
  value: TSubagentWorkerWireRecord,
  key: keyof ISubagentSpawnRequest & string,
): boolean {
  return value[key] === undefined || typeof value[key] === 'string';
}

/**
 * CORE-024 (RUNTIME-47): validate the optional `usage` payload on a `result` message so a
 * malformed object cannot be spread verbatim into the parent's token/cost accounting. Absent is
 * valid (usage is optional); present must be an `ISessionUsageTotals` with three numeric fields.
 */
function hasValidOptionalUsage(value: TSubagentWorkerWireRecord): boolean {
  if (value.usage === undefined) return true;
  const usage = value.usage;
  if (!isRecord(usage)) return false;
  return (
    typeof usage.promptTokens === 'number' &&
    typeof usage.completionTokens === 'number' &&
    typeof usage.totalTokens === 'number'
  );
}

/**
 * ARCH-021: validate the optional parity declaration for the same reason CORE-024 (RUNTIME-47) added
 * `hasValidOptionalUsage` beside it — the guard asserts a typed shape, so an unvalidated optional
 * field hands a consumer a `readonly string[]` type over whatever the wire carried. Absent is valid;
 * present must be an array of strings.
 */
function hasValidOptionalComposedToolNames(value: TSubagentWorkerWireRecord): boolean {
  if (value.composedToolNames === undefined) return true;
  const names = value.composedToolNames;
  if (!Array.isArray(names)) return false;
  return names.every((name) => typeof name === 'string');
}

/** A present string member must be a non-empty one. */
function hasOptionalNonEmptyString(value: TSubagentWorkerWireRecord, key: string): boolean {
  const member = value[key];
  return member === undefined || (typeof member === 'string' && member.length > 0);
}

/**
 * #3679: the grant is a non-empty string; a fork job carries the lease it claims its record with,
 * and only a fork job does; and a held record is one within its bound that rides only beside the id
 * it resumes — a record with no id to resume is a payload that put the conversation where nothing
 * reads it, and the worker must not guess.
 */
function hasValidSealingFields(value: TSubagentWorkerWireRecord): boolean {
  if (!hasOptionalNonEmptyString(value, 'writeGrant')) return false;
  if (!hasOptionalNonEmptyString(value, 'resumeLease')) return false;
  const resumes = isRecord(value.request) && hasRequestString(value.request, 'resumeSessionId');
  if ((value.resumeLease !== undefined) !== resumes) return false;
  if (value.resumeHeld === undefined) return true;
  if (!hasOptionalNonEmptyString(value, 'resumeHeld')) return false;
  if ((value.resumeHeld as string).length > RESUME_HELD_MAX_CHARACTERS) return false;
  return isRecord(value.request) && hasRequestString(value.request, 'resumeSessionId');
}

function isStartPayload(value: TSubagentWorkerWireValue): value is ISubagentWorkerStartPayload {
  if (!isRecord(value)) return false;
  if (!hasPayloadString(value, 'taskId')) return false;
  if (!isRecord(value.request)) return false;
  if (!hasRequestString(value.request, 'agentType')) return false;
  if (!hasRequestString(value.request, 'prompt')) return false;
  // ARCH-031: required at the spawn boundary, so the guard asserts it too. Without this a payload
  // missing the policy passes, and the worker's conditional spread then silently omits it — which is
  // how CORE-025 lost this exact field once already.
  if (!hasRequestString(value.request, 'permissionPolicy')) return false;
  // ARCH-010/ARCH-031: `cwd` is the fallback carrier of the execution root — with no `worktree` on
  // the payload, `subagentExecutionRoot` returns it verbatim. A payload without it gives the child's
  // tools `undefined` as their containment root, which is the breach this rule exists to prevent.
  if (!hasRequestString(value.request, 'cwd')) return false;
  // CLI-1994: a fork job names the record it resumes — an id, never the conversation. A non-string
  // here is a payload that put something else where the id goes, and the worker must not guess.
  if (!hasOptionalRequestString(value.request, 'resumeSessionId')) return false;
  // …and `worktree.path` is the HIGHER-precedence carrier — `worktree?.path ?? request.cwd` — so
  // validating `cwd` alone leaves the winning branch unchecked. Before ARCH-031 the runner rewrote
  // `request.cwd` to the worktree, so one check covered both; now it does not.
  if (value.worktree !== undefined) {
    if (!isRecord(value.worktree)) return false;
    if (!hasString(value.worktree, 'path')) return false;
  }
  // ARCH-044 (issue #2047): both DTOs are decoded totally — every declared field, arrays rejected
  // where a record is required — instead of being accepted as any `object`.
  if (!decodeAgentDefinitionDto(value.agentDefinition).ok) return false;
  if (!isRecord(value.parentConfig)) return false;
  if (!decodeParentContextDto(value.parentContext).ok) return false;
  if (!isRecord(value.providerProfile)) return false;
  if (!hasString(value.providerProfile, 'type')) return false;
  if (!hasString(value.providerProfile, 'model')) return false;
  if (value.parentSandboxSettings !== undefined && !isRecord(value.parentSandboxSettings)) {
    return false;
  }
  if (!hasValidSealingFields(value)) return false;
  return isConnectionCheck(value.connectionCheck);
}

export function isSubagentWorkerParentMessage(
  value: TSubagentWorkerWireValue,
): value is TSubagentWorkerParentMessage {
  if (!isRecord(value) || !hasString(value, 'type')) return false;
  switch (value.type) {
    case 'start':
      return isStartPayload(value.payload);
    case 'send':
      return hasString(value, 'prompt');
    case 'cancel':
      return value.reason === undefined || typeof value.reason === 'string';
    case 'sandbox_settings':
      return isRecord(value.settings);
    case 'sealing_key':
      return hasString(value, 'grant') && (value.grant as string).length > 0;
    case 'permission_response':
      return hasString(value, 'requestId') && isPermissionResult(value.result);
    default:
      return false;
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const RECORD_SAVED_KEYS = ['sessionId', 'sha256', 'type'];

/** Exactly a {@link ISubagentWorkerRecordSavedMessage}: these three members and nothing else. */
function isRecordSavedMessage(value: TSubagentWorkerWireRecord): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === RECORD_SAVED_KEYS.length &&
    keys.every((key, index) => key === RECORD_SAVED_KEYS[index]) &&
    hasString(value, 'sessionId') &&
    (value.sessionId as string).length > 0 &&
    typeof value.sha256 === 'string' &&
    SHA256_HEX.test(value.sha256)
  );
}

/** `recordSaveRefused` is absent or exactly `true`. */
function hasValidRefusalFlag(value: TSubagentWorkerWireRecord): boolean {
  return value.recordSaveRefused === undefined || value.recordSaveRefused === true;
}

/** A `TSubagentWorkerPermissionResult`: the same three-way answer the session layer allows. */
function isPermissionResult(value: TSubagentWorkerWireValue): boolean {
  return typeof value === 'boolean' || value === 'allow-session' || value === 'allow-project';
}

export function isSubagentWorkerChildMessage(
  value: TSubagentWorkerWireValue,
): value is TSubagentWorkerChildMessage {
  if (!isRecord(value) || !hasString(value, 'type')) return false;
  switch (value.type) {
    case 'ready':
      return hasValidOptionalComposedToolNames(value);
    case 'text_delta':
      return hasString(value, 'delta');
    case 'tool_start':
      return hasString(value, 'toolName');
    case 'tool_end':
      return hasString(value, 'toolName') && typeof value.success === 'boolean';
    case 'permission_request':
      return hasString(value, 'requestId') && hasString(value, 'toolName');
    case 'result':
      return (
        hasString(value, 'output') && hasValidOptionalUsage(value) && hasValidRefusalFlag(value)
      );
    case 'error':
      return hasString(value, 'message') && hasValidRefusalFlag(value);
    case 'cancelled':
      return value.reason === undefined || typeof value.reason === 'string';
    case 'record_saved':
      return isRecordSavedMessage(value);
    default:
      return false;
  }
}
