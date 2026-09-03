import type { ISessionUsageTotals, TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import type {
  IAgentDefinition,
  IResolvedConfig,
  ISubagentParentContext,
} from '@robota-sdk/agent-framework';
import type {
  ISerializableProviderProfile,
  ISubagentSpawnRequest,
} from '@robota-sdk/agent-interface-execution';

export type TSubagentWorkerWireValue = string | number | boolean | null | undefined | object;

type TSubagentWorkerWireRecord = Record<string, TSubagentWorkerWireValue>;

import type { ISandboxProjection } from './worker-composition.js';

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
  agentDefinition: IAgentDefinition;
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
   * Issue #2317: the two context members the child reads, declared rather than indexed out of the
   * runtime type. It was `IInProcessSubagentRunnerDeps['context']` — the parent's whole
   * `ILoadedContext`, whose `agentsFileEntries` / `projectNotesFileEntries` carry the full text of
   * every AGENTS.md and CLAUDE.md the parent loaded — and the child read two of its seven members.
   * `projectParentContext` is what enforces it at runtime, for the same reason as `parentConfig`.
   */
  parentContext: ISubagentParentContext;
  providerProfile: ISerializableProviderProfile;
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
  permissionMode?: TPermissionMode;
  logsDir?: string;
}

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

export type TSubagentWorkerParentMessage =
  ISubagentWorkerStartMessage | ISubagentWorkerSendMessage | ISubagentWorkerCancelMessage;

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

export interface ISubagentWorkerResultMessage {
  type: 'result';
  output: string;
  /** ANALYTICS-001 (Phase 2): total token usage of the subagent run, forwarded to the parent. */
  usage?: ISessionUsageTotals;
}

export interface ISubagentWorkerErrorMessage {
  type: 'error';
  message: string;
}

export interface ISubagentWorkerCancelledMessage {
  type: 'cancelled';
  reason?: string;
}

export type TSubagentWorkerChildMessage =
  | ISubagentWorkerReadyMessage
  | ISubagentWorkerTextDeltaMessage
  | ISubagentWorkerToolStartMessage
  | ISubagentWorkerToolEndMessage
  | ISubagentWorkerResultMessage
  | ISubagentWorkerErrorMessage
  | ISubagentWorkerCancelledMessage;

function isRecord(value: TSubagentWorkerWireValue): value is TSubagentWorkerWireRecord {
  return typeof value === 'object' && value !== null;
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
  // …and `worktree.path` is the HIGHER-precedence carrier — `worktree?.path ?? request.cwd` — so
  // validating `cwd` alone leaves the winning branch unchecked. Before ARCH-031 the runner rewrote
  // `request.cwd` to the worktree, so one check covered both; now it does not.
  if (value.worktree !== undefined) {
    if (!isRecord(value.worktree)) return false;
    if (!hasString(value.worktree, 'path')) return false;
  }
  if (!isRecord(value.agentDefinition)) return false;
  if (!hasString(value.agentDefinition, 'name')) return false;
  if (!hasString(value.agentDefinition, 'systemPrompt')) return false;
  if (!isRecord(value.parentConfig)) return false;
  if (!isRecord(value.parentContext)) return false;
  if (!isRecord(value.providerProfile)) return false;
  if (!hasString(value.providerProfile, 'type')) return false;
  return hasString(value.providerProfile, 'model');
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
    default:
      return false;
  }
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
    case 'result':
      return hasString(value, 'output') && hasValidOptionalUsage(value);
    case 'error':
      return hasString(value, 'message');
    case 'cancelled':
      return value.reason === undefined || typeof value.reason === 'string';
    default:
      return false;
  }
}
