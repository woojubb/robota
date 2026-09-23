/**
 * MCP-004 §S3 — the tool-call handoff wrapper.
 *
 * Wraps ONE tool so a call that outruns `IToolCallHandoffPolicy.thresholdMs` is handed to a
 * `tool-invocation` background task instead of blocking the turn. Every other member delegates to
 * the inner tool unchanged (same name, schema, description, validation) — a caller holding the
 * wrapper cannot tell it apart from the tool it wraps except through `execute`'s race.
 *
 * OFF the package barrel by design: `buildToolCallHandoff` (`create-session-runtime.ts`) is this
 * module's one production caller, and `unwrapToolCallHandoff` is `createSubagentSession`'s. Neither
 * needs to be public — only the policy shape (`ICreateSessionOptions.toolCallHandoff`) does.
 *
 * The wrapper owns NO budget timer past the threshold and never reaches the MCP invoker: the
 * supervisor's `toolCallMs` (S2, `agent-mcp`) is the one enforcer. `budgetMs` here is informational —
 * it only sizes the spawned task's `maxRuntimeMs` for `/tasks`.
 */

import { randomUUID } from 'node:crypto';

import type { IToolCallHandoffProvenance } from './tool-call-handoff-types.js';
import type {
  IEventService,
  IParameterValidationResult,
  IToolExecutionContext,
  IToolResult,
  IToolSchema,
  IToolWithEventService,
  IUniversalObjectValue,
  TToolParameters,
  TUniversalValue,
} from '@robota-sdk/agent-core';
import type { IBackgroundTaskManager, IToolInvocationAdopter } from '@robota-sdk/agent-executor';
import type { IToolInvocationBackgroundTaskRequest } from '@robota-sdk/agent-interface-execution';
import type { ISessionLogger } from '@robota-sdk/agent-session';

/**
 * Per-call collaborators and policy the wrapper needs — everything `buildToolCallHandoff` resolves
 * once, at construction time, for one selected tool.
 */
export interface IToolCallHandoffDeps {
  readonly manager: IBackgroundTaskManager;
  /** The `tool-invocation` runner's adopter port — `'adopt' in runner` narrows it at build time. */
  readonly runner: IToolInvocationAdopter;
  readonly sessionId: string;
  readonly cwd: string;
  readonly thresholdMs: number;
  readonly budgetMs: number;
  readonly provenance: IToolCallHandoffProvenance;
  /**
   * The diagnostic sink for the one declared fallback (MCP-004 § Fallback: admission refused after
   * the threshold fired). An embedding host that supplied `ICreateSessionOptions.sessionLogger`
   * observes the refusal as a `sessionLogger.log(sessionId, 'tool_call_handoff_refused', …)` call —
   * the same seam `build-agent-runtime.ts` already uses to report `background_task_event`. Absent ⇒
   * the refusal still rides the returned `IToolResult.data.message`, just unreported to a second sink.
   */
  readonly sessionLogger?: ISessionLogger;
  /** Injectable clock — tests race the threshold deterministically under a fake clock. */
  readonly setTimeout?: typeof setTimeout;
  readonly clearTimeout?: typeof clearTimeout;
  /** Injectable adoption-token factory — tests assert release deterministically. */
  readonly createAdoptionToken?: () => string;
}

/**
 * Merges the refusal reason into the settled call's own result, per § Fallback: `success` keeps
 * whatever the inner call decided; `data` gains a `message` naming the refusal, wrapping a
 * non-object `data` (or absent `data`) rather than discarding it.
 */
function mergeHandoffRefusalMessage(result: IToolResult, reason: string): IToolResult {
  const message = `handoff refused: ${reason}`;
  const existing = result.data;
  const isPlainObject =
    existing !== undefined &&
    existing !== null &&
    typeof existing === 'object' &&
    !Array.isArray(existing) &&
    !(existing instanceof Date);
  const dataObject: IUniversalObjectValue = isPlainObject
    ? { ...(existing as IUniversalObjectValue) }
    : existing === undefined
      ? {}
      : { value: existing };
  return {
    ...result,
    data: { ...dataObject, message } as TUniversalValue,
  };
}

/**
 * Delegation wrapper around one tool. See the module doc for the full contract; `execute` is the
 * only member that is not a straight pass-through.
 */
export class ToolCallHandoffTool implements IToolWithEventService {
  constructor(
    private readonly inner: IToolWithEventService,
    private readonly deps: IToolCallHandoffDeps,
  ) {}

  get schema(): IToolSchema {
    return this.inner.schema;
  }

  getName(): string {
    return this.inner.getName();
  }

  getDescription(): string {
    return this.inner.getDescription();
  }

  validate(parameters: TToolParameters): boolean {
    return this.inner.validate(parameters);
  }

  validateParameters(parameters: TToolParameters): IParameterValidationResult {
    return this.inner.validateParameters(parameters);
  }

  setEventService(eventService: IEventService | undefined): void {
    this.inner.setEventService(eventService);
  }

  /** `unwrapToolCallHandoff` reads this. Never called for the inner tool's own benefit. */
  getInnerTool(): IToolWithEventService {
    return this.inner;
  }

  execute(parameters: TToolParameters, context?: IToolExecutionContext): Promise<IToolResult> {
    return executeToolCallHandoff(this.inner, this.deps, parameters, context);
  }
}

/** True only for a wrapper this module produced — never for the tool it wraps. */
export function isToolCallHandoff(tool: IToolWithEventService): tool is ToolCallHandoffTool {
  return tool instanceof ToolCallHandoffTool;
}

/**
 * The inner tool for a wrapper, the tool itself otherwise.
 *
 * `createSubagentSession`'s `filterTools` maps every parent tool through this before the deny/allow
 * steps, so in-process subagents and forks — the two callers of that one derivation point — never
 * hold a wrapper (MCP-004 § Decision: "Subagents: rejected by construction").
 */
export function unwrapToolCallHandoff(tool: IToolWithEventService): IToolWithEventService {
  return isToolCallHandoff(tool) ? tool.getInnerTool() : tool;
}

/**
 * The per-call race: settle vs. threshold, then either path, exactly once.
 *
 * - Settles first → the inner result (or rejection) returned unchanged; the threshold timer is
 *   cleared; `manager.spawn` is never called.
 * - Threshold first → commits to the background path (adopt, then spawn) even if `settled` resolves
 *   while `spawn` is still pending — the runner completes at once from the already-settled promise.
 * - `spawn` refuses → the ONE declared fallback: the token is released, the turn-signal link is left
 *   in place, and the SAME in-flight call keeps running in the foreground; nothing is retried or
 *   re-sent.
 */
async function executeToolCallHandoff(
  inner: IToolWithEventService,
  deps: IToolCallHandoffDeps,
  parameters: TToolParameters,
  context?: IToolExecutionContext,
): Promise<IToolResult> {
  const scheduleTimeout = deps.setTimeout ?? setTimeout;
  const clearScheduledTimeout = deps.clearTimeout ?? clearTimeout;
  const toolName = inner.getName();
  const turnSignal = context?.signal;

  // The LINKED controller: aborted by the turn claim (context.signal) until a successful `spawn`.
  // After that, only the manager's cancel/shutdown can reach the call (through the adopter's
  // `abort`), never this controller again — unlinking below is what makes that true.
  const controller = new AbortController();
  const onTurnAbort = (): void => controller.abort(turnSignal?.reason);
  let turnLinkActive = false;
  if (turnSignal) {
    if (turnSignal.aborted) {
      controller.abort(turnSignal.reason);
    } else {
      turnSignal.addEventListener('abort', onTurnAbort, { once: true });
      turnLinkActive = true;
    }
  }
  const unlinkTurnSignal = (): void => {
    if (!turnLinkActive) return;
    turnLinkActive = false;
    turnSignal?.removeEventListener('abort', onTurnAbort);
  };

  const startedAt = Date.now();
  const innerContext: IToolExecutionContext = {
    toolName,
    parameters,
    ...context,
    signal: controller.signal,
  };
  // Deferred by one microtask so a synchronous throw inside `inner.execute` becomes a rejection of
  // this promise rather than a synchronous throw out of this function.
  const settled = Promise.resolve().then(() => inner.execute(parameters, innerContext));
  // The race below attaches a rejection handler to `settled` synchronously, in the same tick it is
  // created — no window exists in which a rejection could go unhandled. Every later reader (the
  // adopter, the foreground continuation on refusal, the caller of this function) shares that same
  // already-handled promise.
  const outcome = await new Promise<'settled' | 'threshold'>((resolve) => {
    const timer = scheduleTimeout(() => resolve('threshold'), deps.thresholdMs);
    settled.then(
      () => {
        clearScheduledTimeout(timer);
        resolve('settled');
      },
      () => {
        clearScheduledTimeout(timer);
        resolve('settled');
      },
    );
  });

  if (outcome === 'settled') {
    return settled;
  }

  // Threshold won the race: commit to the background path. Nothing above this line runs again for
  // this call — a `settled` resolution from here on is read by the runner, not by this function.
  const token = (deps.createAdoptionToken ?? randomUUID)();
  const release = deps.runner.adopt(token, {
    settled,
    abort: (reason: string) => controller.abort(reason),
  });

  const elapsed = Date.now() - startedAt;
  const request: IToolInvocationBackgroundTaskRequest = {
    kind: 'tool-invocation',
    label: toolName,
    mode: 'background',
    parentSessionId: deps.sessionId,
    depth: 0,
    cwd: deps.cwd,
    maxRuntimeMs: deps.budgetMs - elapsed,
    toolName,
    adoptionToken: token,
    provenanceOwner: 'mcp',
    serverId: deps.provenance.serverId,
    sourceName: deps.provenance.sourceName,
    securityIdentity: deps.provenance.securityIdentity,
    permissionMode: deps.provenance.permissionMode,
  };

  try {
    const task = await deps.manager.spawn(request);
    // Only AFTER a successful spawn: unlink. A later turn-claim abort must not reach (and
    // misreport as failed) a call that is now the manager's to cancel.
    unlinkTurnSignal();
    return {
      success: true,
      data: {
        backgroundTaskId: task.id,
        status: 'running',
        serverId: deps.provenance.serverId,
        toolName,
        message: `Handed to background task ${task.id}; the text result arrives as a task notification.`,
      },
    };
  } catch (spawnError) {
    // allow-fallback: admission refused — continue the in-flight call in the foreground and report the refusal (MCP-004 § Fallback)
    release();
    const reason = spawnError instanceof Error ? spawnError.message : String(spawnError);
    deps.sessionLogger?.log(deps.sessionId, 'tool_call_handoff_refused', { toolName, reason });
    const result = await settled;
    return mergeHandoffRefusalMessage(result, reason);
  }
}
