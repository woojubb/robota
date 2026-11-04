import { sumHistoryUsage } from '@robota-sdk/agent-core';
import { processEnvResolver } from '@robota-sdk/agent-core/node';
import {
  createProviderFromExactProfile,
  subagentExecutionRoot,
  verifyConnectionEnvironment,
} from '@robota-sdk/agent-executor';
import { createSubagentSession } from '@robota-sdk/agent-framework';
import {
  createSubagentLogger,
  resolveSubagentLogSessionId,
} from '@robota-sdk/agent-framework/node';

import {
  isSubagentWorkerParentMessage,
  type ISubagentWorkerStartPayload,
  type TSubagentWorkerChildMessage,
  type TSubagentWorkerPermissionResult,
  type TSubagentWorkerWireValue,
} from './child-process-subagent-ipc.js';
import { reportRecordSaves } from './child-process-subagent-record-saves.js';
import {
  claimRequestedRecord,
  openResumeSessionStore,
  resumeRequestedRecord,
} from './child-process-subagent-resume.js';
import { restoreAgentDefinition, restoreParentContext } from './subagent-worker-start-dto.js';
import { restoreProjectedSandbox } from './worker-composition.js';
import { withholdProviderCredential } from './worker-credential.js';

import type { IRecordSaveReporter } from './child-process-subagent-record-saves.js';
import type { IClaimedResumeRecord } from './child-process-subagent-resume.js';
import type {
  ISubagentComposedSandbox,
  ISubagentWorkerComposition,
  TParentSandboxSettings,
} from './worker-composition.js';
import type { ITerminalOutput, TArtifactSealing, TToolArgs } from '@robota-sdk/agent-core';

const CANCEL_EXIT_CODE = 130;
/** DIST-006: worker mode reached without an IPC channel — a misuse, not a run that failed. */
const WORKER_MISUSE_EXIT_CODE = 2;
/** Force-exit fallback if the IPC flush callback never fires (broken channel). */
const FLUSH_EXIT_FALLBACK_MS = 2000;

const NOOP_TERMINAL: ITerminalOutput = {
  write: (): void => {},
  writeLine: (): void => {},
  writeMarkdown: (): void => {},
  writeError: (): void => {},
  prompt: (): Promise<string> => Promise.resolve(''),
  select: (): Promise<number> => Promise.resolve(0),
  spinner: () => ({ stop: (): void => {}, update: (): void => {} }),
};

type TSubagentSessionToolEvent = Parameters<
  NonNullable<Parameters<typeof createSubagentSession>[0]['onToolExecution']>
>[0];

let session: ReturnType<typeof createSubagentSession> | null = null;
let cancelled = false;
/** Issue #3288 §1: requests awaiting the parent's answer, by the id this child minted for them. */
const pendingPermissionRequests = new Map<
  string,
  (result: TSubagentWorkerPermissionResult) => void
>();
let permissionRequestSequence = 0;
/** The parent's sandbox settings most recently sent after a change, newer than the start payload's. */
let latestParentSandboxSettings: TParentSandboxSettings | undefined;
let composedSandbox: ISubagentComposedSandbox | undefined;
/** Why a change the parent sent after `start` could not be taken; the job then ends with it. */
let parentChangeFailure: string | undefined;
/** The parent's write grant most recently sent after a change, newer than the start payload's. */
let latestWriteGrant: string | undefined;
/** Whether this child bound its parent's grant at start, so a newer one is taken as it comes. */
let sealingBound = false;
let running: Promise<void> = Promise.resolve();
/** Prompts the parent sent that are waiting for their turn, in the order they came. */
const followUps: string[] = [];
/**
 * The job has run its last turn, or failed, or was cancelled: it takes no more prompts. Set in the same
 * step that finds none queued, so a prompt is either queued before it and run, or refused after it.
 */
let finishing = false;
/** A sealing parent handed this child a record: what has been seen of its saves. */
let recordSaves: IRecordSaveReporter | undefined;
/** The claim this child holds, under its parent's lease, on the record it resumes. */
let claimedRecord: IClaimedResumeRecord | undefined;

/**
 * Ends this child's claim on the record it resumes, removing its writer marker; every way out of the
 * process runs it, after the session's last save. Idempotent.
 */
function releaseClaimedRecord(): void {
  claimedRecord?.release();
}

function sendChildMessage(message: TSubagentWorkerChildMessage): void {
  if (process.send) {
    process.send(message);
  }
}

/**
 * The job's terminal message with what a parent that handed a record over is told of a refused
 * one: a result says it beside the answer, and an error says it first, in fixed words, since the
 * refusal is why the run could not save.
 */
function withRecordSaveRefusal(
  message: TSubagentWorkerChildMessage,
  payload: ISubagentWorkerStartPayload,
): TSubagentWorkerChildMessage {
  if (recordSaves?.refused() !== true) return message;
  if (message.type === 'result') return { ...message, recordSaveRefused: true };
  if (message.type !== 'error') return message;
  return {
    type: 'error',
    message:
      `Session ${payload.request.resumeSessionId ?? payload.taskId} was changed on disk by ` +
      `something this subagent cannot verify, so its turns from then on were not saved to it. ` +
      message.message,
    recordSaveRefused: true,
  };
}

/**
 * CORE-024 (RUNTIME-20): send the terminal message and exit ONLY after the IPC write has drained.
 * `process.send` is asynchronous; exiting from a `finally` before the write flushes made the
 * parent's `onExit` fire before the `result` arrived — a successful run was misreported as a crash
 * and its `usage` payload was lost. Exit from the flush callback; a fallback timer guards a broken
 * channel so the worker never hangs.
 */
function sendTerminalMessageAndExit(message: TSubagentWorkerChildMessage, exitCode: number): void {
  let exited = false;
  const exitOnce = (): void => {
    if (exited) return;
    exited = true;
    releaseClaimedRecord();
    process.exit(exitCode);
  };
  if (process.send) {
    const fallback = setTimeout(exitOnce, FLUSH_EXIT_FALLBACK_MS);
    fallback.unref?.();
    process.send(message, undefined, undefined, () => {
      clearTimeout(fallback);
      exitOnce();
    });
  } else {
    exitOnce();
  }
}

/** Best-effort total token usage of the finished subagent session; never throws. */
function readSessionUsage(
  finishedSession: ReturnType<typeof createSubagentSession>,
): ReturnType<typeof sumHistoryUsage> {
  try {
    return sumHistoryUsage(finishedSession.getFullHistory());
  } catch {
    // allow-fallback: usage capture is auxiliary — history read failure must not fail the subagent run
    return undefined;
  }
}

/** What a child says when it cannot follow its parent's new key: it stops rather than seal to the old one. */
const SEALING_KEY_NOT_FOLLOWED =
  'subagent worker: the parent now seals to another key and this subagent could not seal to it, ' +
  'so it stopped rather than go on sealing to the key its parent replaced.';

/**
 * A change the parent sent while this child was being built, and that it could not take, stops the
 * job before its run starts: the run would otherwise write under what the parent has replaced.
 */
function throwIfParentChangeFailed(): void {
  if (parentChangeFailure !== undefined) throw new Error(parentChangeFailure);
}

/** Whether `sealing` seals to exactly the key `grant` names: never plain, and its own grant is `grant`. */
function sealsTo(sealing: TArtifactSealing, grant: string): boolean {
  return sealing !== 'plain' && sealing.sealer.writeGrant?.() === grant;
}

/**
 * How this child seals, as its parent decided: plain when the payload carries no grant, else the
 * sealing the composition binds from the grant — before anything is built, so every store the
 * composition opens afterwards seals the same way. A composition that cannot bind one, or binds one
 * that is plain or seals to another key, fails the job: a child whose parent seals never writes plain
 * or to a key its parent did not hand it.
 */
function bindParentSealing(
  payload: ISubagentWorkerStartPayload,
  composition: ISubagentWorkerComposition,
): TArtifactSealing {
  if (payload.writeGrant === undefined) return 'plain';
  if (composition.bindWriteGrant === undefined) {
    throw new Error(
      `subagent worker: job ${payload.taskId} must seal what it writes, but this composition ` +
        'cannot seal. Register ISubagentWorkerComposition.bindWriteGrant at the composition ' +
        'root. The subagent was not started.',
    );
  }
  const grant = latestWriteGrant ?? payload.writeGrant;
  const sealing = composition.bindWriteGrant(grant);
  if (!sealsTo(sealing, grant)) {
    throw new Error(
      `subagent worker: job ${payload.taskId} must seal to the key its parent handed it, but this ` +
        "composition's bindWriteGrant returned a sealing that does not. The subagent was not started.",
    );
  }
  sealingBound = true;
  return sealing;
}

async function runInitialPrompt(
  payload: ISubagentWorkerStartPayload,
  composition: ISubagentWorkerComposition,
): Promise<void> {
  try {
    const sealing = bindParentSealing(payload, composition);
    // The parent compared this environment before spawning; repeat it before anything is built, so
    // a change between spawn and start cannot send the parent's credential elsewhere.
    if (!verifyConnectionEnvironment(payload.connectionCheck, process.env)) {
      throw new Error(
        'The provider connection environment changed after the parent checked it; the subagent was not started.',
      );
    }
    // ARCH-021: the PRODUCT's registry, not an imported six-vendor default. A custom provider type
    // used to throw `Unknown provider` here while the parent ran on it perfectly well.
    const restoredSandbox = await restoreProjectedSandbox(
      payload.sandboxProjection,
      composition.sandboxFactories,
    );
    throwIfParentChangeFailed();
    // Exactly as the parent resolved it: no defaults from this process's own registry.
    const provider = createProviderFromExactProfile(
      payload.providerProfile,
      payload.request.model,
      composition.providerDefinitions,
      processEnvResolver,
    );
    withholdProviderCredential(payload.providerProfile, payload.keepProviderCredential === true);
    // The session id names the log and binds a sealed one, by the rule the parent reads it with.
    const sessionId = resolveSubagentLogSessionId(payload.request, payload.taskId);
    const sessionLogger = payload.logsDir
      ? createSubagentLogger(payload.request.parentSessionId, payload.taskId, payload.logsDir, {
          sealing,
        })
      : undefined;
    const openedStore = openResumeSessionStore(payload, composition);
    const resumeSessionId = payload.request.resumeSessionId;
    // The record is this child's to write only under the lease its parent lent it: claimed before
    // anything reads it, released on every way out of the process.
    claimedRecord = claimRequestedRecord(payload, openedStore);
    if (claimedRecord !== undefined) process.once('exit', releaseClaimedRecord);
    const claimedStore = claimedRecord?.store ?? openedStore;
    // A sealing parent that handed a record over hears of each save of it, to vouch for it.
    recordSaves =
      claimedStore !== undefined &&
      payload.resumeHeld !== undefined &&
      resumeSessionId !== undefined
        ? reportRecordSaves(claimedStore, resumeSessionId, sendChildMessage)
        : undefined;
    const resumeSessionStore = recordSaves?.store ?? claimedStore;
    // A sandbox restored from the parent's snapshot, or else one the child composes at its own root.
    // Only a composed sandbox approves commands, from the instance its tools run under; a restored one
    // approves none, so the child asks where the parent might not: stricter, never looser.
    const parentSettings = latestParentSandboxSettings ?? payload.parentSandboxSettings;
    composedSandbox =
      restoredSandbox === undefined
        ? composition.createSandbox?.({
            cwd: subagentExecutionRoot(payload),
            ...(parentSettings !== undefined ? { parentSettings } : {}),
          })
        : undefined;
    const toolSandbox = restoredSandbox ?? composedSandbox?.client;
    session = createSubagentSession({
      host: composition.host,
      // ARCH-044 (issue #2047): explicit restore from the wire DTOs into the runtime models.
      agentDefinition: restoreAgentDefinition(payload.agentDefinition),
      parentConfig: payload.parentConfig,
      parentContext: restoreParentContext(payload.parentContext),
      // ARCH-010: the spawn request already carries the root; this call simply never passed it, so
      // every tool the child built was unconfined. Same reader as the session root below — the tools
      // and the session being told DIFFERENT roots is the same class of defect as neither being told
      // one.
      // ARCH-021: the product's tool surface, built at THIS child's execution root. Previously
      // `createDefaultTools(...)`, which meant dropping a pack did not drop its tools from a
      // child-process subagent — ARCH-006's invariant was true in the parent and false here.
      // ARCH-033: restore the parent's sandbox before building tools, so the child acts where the
      // parent acts. An unregistered type throws here rather than degrading to host tools — a child
      // that was told it is sandboxed and quietly is not is ARCH-010's shape.
      // ARCH-034: the session tiers cross too, so the runner choice stays a packaging decision
      // rather than a capability one. `includeGoalTool` rides on the payload because it is a property
      // of the PARENT'S session, not of this child's root.
      parentTools: composition.createTools({
        cwd: subagentExecutionRoot(payload),
        ...(toolSandbox !== undefined ? { sandboxClient: toolSandbox } : {}),
        ...(payload.sessionTiers !== undefined ? { sessionTiers: payload.sessionTiers } : {}),
      }),
      cwd: subagentExecutionRoot(payload),
      provider,
      terminal: NOOP_TERMINAL,
      sessionId,
      ...(resumeSessionStore !== undefined ? { sessionStore: resumeSessionStore } : {}),
      ...(sessionLogger ? { sessionLogger } : {}),
      permissionMode: payload.permissionMode,
      ...(composedSandbox?.commandSandbox !== undefined
        ? { commandSandbox: composedSandbox.commandSandbox }
        : {}),
      // CORE-025: enforce the task's permission policy in the child-process subagent too.
      ...(payload.request.permissionPolicy !== undefined
        ? { permissionPolicy: payload.request.permissionPolicy }
        : {}),
      ...(payload.request.allowedTools !== undefined
        ? { taskAllowedTools: payload.request.allowedTools }
        : {}),
      ...(payload.request.disallowedTools !== undefined
        ? { taskDisallowedTools: payload.request.disallowedTools }
        : {}),
      hooks: payload.parentConfig.hooks,
      ...(composition.createHookTypeExecutors !== undefined
        ? {
            hookTypeExecutors: composition.createHookTypeExecutors({
              cwd: subagentExecutionRoot(payload),
              ...(toolSandbox !== undefined ? { sandboxClient: toolSandbox } : {}),
            }),
          }
        : {}),
      onTextDelta: (delta) => sendChildMessage({ type: 'text_delta', delta }),
      onToolExecution: forwardToolExecution,
      // Issue #3288 §1: without this, a call needing human approval had no approver in this process
      // at all, and the enforcer's own fail-closed default denied it silently — the parent's session
      // never learned it was asked.
      permissionHandler: requestParentPermission,
    });
    resumeRequestedRecord(payload, session, resumeSessionStore, claimedRecord);
    recordSaves?.restored();
    throwIfParentChangeFailed();
    const output = await runTurns(session, payload.request.prompt);
    if (parentChangeFailure !== undefined) {
      sendTerminalMessageAndExit({ type: 'error', message: parentChangeFailure }, 0);
      return;
    }
    if (cancelled) {
      sendTerminalMessageAndExit(
        { type: 'cancelled', reason: 'Subagent worker cancelled' },
        CANCEL_EXIT_CODE,
      );
      return;
    }
    // ANALYTICS-001 (Phase 2): forward the subagent's total token usage so the parent log can
    // attribute it to this agent as a source. Best-effort — usage capture must never fail the run.
    const usage = readSessionUsage(session);
    // CORE-024 (RUNTIME-20): exit only after this result (with usage) has flushed over IPC, so the
    // parent settles on the result instead of racing a crash-projection from an early exit.
    sendTerminalMessageAndExit(
      withRecordSaveRefusal({ type: 'result', output, ...(usage ? { usage } : {}) }, payload),
      0,
    );
  } catch (error) {
    finishing = true;
    followUps.length = 0;
    // allow-fallback: child process must report errors to parent via IPC, not crash silently; exit follows the IPC flush (CORE-024 RUNTIME-20)
    if (parentChangeFailure !== undefined) {
      sendTerminalMessageAndExit({ type: 'error', message: parentChangeFailure }, 0);
      return;
    }
    if (cancelled) {
      sendTerminalMessageAndExit(
        { type: 'cancelled', reason: 'Subagent worker cancelled' },
        CANCEL_EXIT_CODE,
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    sendTerminalMessageAndExit(withRecordSaveRefusal({ type: 'error', message }, payload), 0);
  }
}

/**
 * Issue #3288 §1: forward a tool call needing approval to the parent, and wait for its answer.
 *
 * Wired as this child session's own `permissionHandler`, so the enforcer's existing session-allow-list
 * → custom-handler → fail-closed path reaches it exactly where it used to reach nothing — a spawn with
 * no `permissionHandler` at all, which fails closed with no approver even when the parent's own session
 * had one. Requests never expire on the child's own initiative: if this child's turn is cancelled, the
 * enforcer's existing signal race denies the call regardless of whether the parent ever answers, so this
 * function stays a simple park-and-wait.
 */
function requestParentPermission(
  toolName: string,
  toolArgs: TToolArgs,
): Promise<TSubagentWorkerPermissionResult> {
  const requestId = `perm_${++permissionRequestSequence}`;
  return new Promise((resolve) => {
    pendingPermissionRequests.set(requestId, resolve);
    sendChildMessage({ type: 'permission_request', requestId, toolName, toolArgs });
  });
}

/** The parent answered a still-pending request; a response for one already settled is a no-op. */
function resolvePendingPermissionRequest(
  requestId: string,
  result: TSubagentWorkerPermissionResult,
): void {
  const resolve = pendingPermissionRequests.get(requestId);
  if (resolve === undefined) return;
  pendingPermissionRequests.delete(requestId);
  resolve(result);
}

function forwardToolExecution(event: TSubagentSessionToolEvent): void {
  if (event.type === 'start') {
    sendChildMessage({ type: 'tool_start', toolName: event.toolName, toolArgs: event.toolArgs });
    return;
  }
  sendChildMessage({ type: 'tool_end', toolName: event.toolName, success: event.success ?? true });
}

/**
 * The job's turns: the initial prompt, then each follow-up the parent sent meanwhile, one at a time.
 * The job's result is the last turn's output, and it is sent only once none is left — a follow-up
 * queued behind a turn in flight would otherwise be cut off by the exit that follows the result.
 */
async function runTurns(
  turnSession: { run(prompt: string): Promise<string> },
  firstPrompt: string,
): Promise<string> {
  let output = await turnSession.run(firstPrompt);
  for (let next = followUps.shift(); next !== undefined; next = followUps.shift()) {
    output = await turnSession.run(next);
  }
  // The check that found nothing queued and this assignment are one step: no message runs between.
  finishing = true;
  return output;
}

/** A follow-up prompt from the parent: queued for the next turn, or refused once the job is finishing. */
function takeFollowUp(prompt: string, sendId: number): void {
  if (finishing) {
    sendChildMessage({ type: 'send_refused', sendId });
    return;
  }
  followUps.push(prompt);
  sendChildMessage({ type: 'send_accepted', sendId });
}

async function cancelWorker(reason?: string): Promise<void> {
  cancelled = true;
  finishing = true;
  followUps.length = 0;
  session?.abort();
  sendChildMessage({ type: 'cancelled', reason });
  await session?.shutdown({ reason: 'other' }).catch(() => undefined); // allow-fallback: shutdown during cancel — process will exit regardless
  releaseClaimedRecord();
  setTimeout(() => process.exit(CANCEL_EXIT_CODE), 0);
}

/**
 * The names the composition yields at this process's own cwd. Failure to enumerate must not stop the
 * worker — the declaration is verification, not the run itself — but it must not be silent either.
 */
function composedToolNames(composition: ISubagentWorkerComposition): readonly string[] | undefined {
  try {
    return composition.createTools({ cwd: process.cwd() }).map((tool) => tool.getName());
  } catch (error) {
    // allow-fallback: a parity declaration must never take the subagent down with it. But it must
    // not lie either — `[]` would read as "this product composed no tools", which is the one
    // confusion a parity channel cannot afford. `undefined` says "could not enumerate".
    process.stderr.write(
      `agent: could not enumerate the composed tool surface: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return undefined;
  }
}

/**
 * The parent changed its sandbox settings (`/sandbox`) while this child runs. A sandbox not composed
 * yet is built from them; a composed one takes them through `applyParentSettings`. One that throws
 * stops the run, since running on settings the user has replaced is what this message prevents. The
 * run is aborted rather than the process exited here: a command already running finishes and cleans
 * up, and `runInitialPrompt` then reports the failure as the run's one terminal message.
 */
function followParentSandboxSettings(settings: TParentSandboxSettings): void {
  latestParentSandboxSettings = settings;
  try {
    composedSandbox?.applyParentSettings?.(settings);
  } catch (error) {
    parentChangeFailure ??= error instanceof Error ? error.message : String(error);
    session?.abort();
  }
}

/**
 * The key the parent seals to was verified or changed while this child runs: everything it seals
 * from now on goes to the new grant's key. A grant not bound yet is taken at start; a child its
 * parent started plain stays plain. One the composition cannot take — it throws, or what it binds
 * does not seal to the new grant's key — stops the job with fixed text (before its run, when the
 * child is still being built), since sealing on to a key the parent has replaced is what this
 * message prevents.
 */
function followParentSealingKey(grant: string, composition: ISubagentWorkerComposition): void {
  latestWriteGrant = grant;
  if (!sealingBound) return;
  let followed = false;
  try {
    followed = sealsTo(composition.bindWriteGrant?.(grant) ?? 'plain', grant);
  } catch {
    // allow-fallback: the composition's own reason is not what the parent is told; the run stops below.
  }
  if (followed) return;
  parentChangeFailure ??= SEALING_KEY_NOT_FOLLOWED;
  session?.abort();
}

/**
 * DIST-006: worker mode is ENTERED, not implied by loading this module.
 *
 * These handlers used to run as module top-level side effects, which is what forced the worker to
 * be a separate file that something had to locate on disk. As a function, the composition root's
 * own entry can become the worker — so there is no second artifact and no path to get wrong.
 *
 * ARCH-021: `composition` is REQUIRED, deliberately. An optional parameter falling back to imported
 * defaults would reinstate the exact defect this seam removes — and at this line conventions have a
 * measured failure rate of 100% (ARCH-010 and ARCH-006 are both findings here).
 */
export function runSubagentWorkerMain(composition: ISubagentWorkerComposition): void {
  if (process.send === undefined) {
    // "Silence is not success": a worker without an IPC channel can never report anything, so it
    // must fail where someone can see it rather than sit there looking started.
    process.stderr.write(
      'agent: subagent worker mode requires an IPC channel; it is started by the agent runtime, not by hand.\n',
    );
    process.exit(WORKER_MISUSE_EXIT_CODE);
  }

  process.on('message', (message: TSubagentWorkerWireValue) => {
    if (!isSubagentWorkerParentMessage(message)) {
      sendChildMessage({ type: 'error', message: 'Malformed subagent worker parent message' });
      return;
    }

    switch (message.type) {
      case 'start':
        running = running.then(() => runInitialPrompt(message.payload, composition));
        break;
      case 'send':
        takeFollowUp(message.prompt, message.sendId);
        break;
      case 'cancel':
        void cancelWorker(message.reason);
        break;
      case 'sandbox_settings':
        followParentSandboxSettings(message.settings);
        break;
      case 'sealing_key':
        followParentSealingKey(message.grant, composition);
        break;
      case 'permission_response':
        resolvePendingPermissionRequest(message.requestId, message.result);
        break;
      default:
        sendChildMessage({ type: 'error', message: 'Unhandled subagent worker parent message' });
    }
  });

  process.on('disconnect', () => {
    cancelled = true;
    session?.abort();
    void (session?.shutdown({ reason: 'other' }) ?? Promise.resolve())
      .catch(() => undefined) // allow-fallback: cleanup on disconnect — process will exit regardless
      .then(releaseClaimedRecord);
  });

  // ARCH-021: declare what this child composed. This is a VERIFICATION channel — the built-binary
  // test and the port-level test read it; no production consumer does, and saying otherwise would
  // stop the next reader asking whether this public wire field has one. It turns "equivalent by
  // construction" into "verified per run" at a seam where two findings have already landed.
  const names = composedToolNames(composition);
  sendChildMessage({
    type: 'ready',
    ...(names ? { composedToolNames: names } : {}),
  });
}
