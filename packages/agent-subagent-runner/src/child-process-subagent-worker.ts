import { sumHistoryUsage } from '@robota-sdk/agent-core';
import { createProviderFromProfile, subagentExecutionRoot } from '@robota-sdk/agent-executor';
import { createSubagentLogger, createSubagentSession } from '@robota-sdk/agent-framework';

import {
  isSubagentWorkerParentMessage,
  type ISubagentWorkerStartPayload,
  type TSubagentWorkerChildMessage,
  type TSubagentWorkerWireValue,
} from './child-process-subagent-ipc.js';

import type { ISubagentWorkerComposition } from './worker-composition.js';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

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
let running: Promise<void> = Promise.resolve();

function sendChildMessage(message: TSubagentWorkerChildMessage): void {
  if (process.send) {
    process.send(message);
  }
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

async function runInitialPrompt(
  payload: ISubagentWorkerStartPayload,
  composition: ISubagentWorkerComposition,
): Promise<void> {
  try {
    // ARCH-021: the PRODUCT's registry, not an imported six-vendor default. A custom provider type
    // used to throw `Unknown provider` here while the parent ran on it perfectly well.
    const provider = createProviderFromProfile(
      payload.providerProfile,
      payload.request.model,
      composition.providerDefinitions,
    );
    const sessionLogger = payload.logsDir
      ? createSubagentLogger(payload.request.parentSessionId, payload.taskId, payload.logsDir)
      : undefined;
    session = createSubagentSession({
      agentDefinition: payload.agentDefinition,
      parentConfig: payload.parentConfig,
      parentContext: payload.parentContext,
      // ARCH-010: the spawn request already carries the root; this call simply never passed it, so
      // every tool the child built was unconfined. Same reader as the session root below — the tools
      // and the session being told DIFFERENT roots is the same class of defect as neither being told
      // one.
      // ARCH-021: the product's tool surface, built at THIS child's execution root. Previously
      // `createDefaultTools(...)`, which meant dropping a pack did not drop its tools from a
      // child-process subagent — ARCH-006's invariant was true in the parent and false here.
      parentTools: composition.createTools({ cwd: subagentExecutionRoot(payload) }),
      cwd: subagentExecutionRoot(payload),
      provider,
      terminal: NOOP_TERMINAL,
      sessionId: payload.taskId,
      ...(sessionLogger ? { sessionLogger } : {}),
      permissionMode: payload.permissionMode,
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
      onTextDelta: (delta) => sendChildMessage({ type: 'text_delta', delta }),
      onToolExecution: forwardToolExecution,
    });
    const output = await session.run(payload.request.prompt);
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
    sendTerminalMessageAndExit({ type: 'result', output, ...(usage ? { usage } : {}) }, 0);
  } catch (error) {
    // allow-fallback: child process must report errors to parent via IPC, not crash silently; exit follows the IPC flush (CORE-024 RUNTIME-20)
    if (cancelled) {
      sendTerminalMessageAndExit(
        { type: 'cancelled', reason: 'Subagent worker cancelled' },
        CANCEL_EXIT_CODE,
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    sendTerminalMessageAndExit({ type: 'error', message }, 0);
  }
}

function forwardToolExecution(event: TSubagentSessionToolEvent): void {
  if (event.type === 'start') {
    sendChildMessage({ type: 'tool_start', toolName: event.toolName, toolArgs: event.toolArgs });
    return;
  }
  sendChildMessage({ type: 'tool_end', toolName: event.toolName, success: event.success ?? true });
}

function runFollowUp(prompt: string): void {
  if (session === null) {
    sendChildMessage({ type: 'error', message: 'Subagent worker has not started' });
    return;
  }
  running = running.then(async () => {
    try {
      // allow-fallback: child process must report errors to parent via IPC, not crash silently
      await session?.run(prompt);
    } catch (error) {
      // allow-fallback: child process must report errors to parent via IPC, not crash silently
      const message = error instanceof Error ? error.message : String(error);
      sendChildMessage({ type: 'error', message });
    }
  });
}

async function cancelWorker(reason?: string): Promise<void> {
  cancelled = true;
  session?.abort();
  sendChildMessage({ type: 'cancelled', reason });
  await session?.shutdown({ reason: 'other' }).catch(() => undefined); // allow-fallback: shutdown during cancel — process will exit regardless
  setTimeout(() => process.exit(CANCEL_EXIT_CODE), 0);
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
/**
 * The names the composition yields at this process's own cwd. Failure to enumerate must not stop the
 * worker — the declaration is verification, not the run itself — but it must not be silent either.
 */
function composedToolNames(composition: ISubagentWorkerComposition): readonly string[] {
  try {
    return composition.createTools({ cwd: process.cwd() }).map((tool) => tool.schema.name);
  } catch (error) {
    // allow-fallback: a parity declaration must never take the subagent down with it.
    process.stderr.write(
      `robota: could not enumerate the composed tool surface: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return [];
  }
}

export function runSubagentWorkerMain(composition: ISubagentWorkerComposition): void {
  if (process.send === undefined) {
    // "Silence is not success": a worker without an IPC channel can never report anything, so it
    // must fail where someone can see it rather than sit there looking started.
    process.stderr.write(
      'robota: subagent worker mode requires an IPC channel; it is started by the agent runtime, not by hand.\n',
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
        runFollowUp(message.prompt);
        break;
      case 'cancel':
        void cancelWorker(message.reason);
        break;
      default:
        sendChildMessage({ type: 'error', message: 'Unhandled subagent worker parent message' });
    }
  });

  process.on('disconnect', () => {
    cancelled = true;
    session?.abort();
    void session?.shutdown({ reason: 'other' }).catch(() => undefined); // allow-fallback: cleanup on disconnect — process will exit regardless
  });

  // ARCH-021: declare what this child composed. The runner and the built-binary test read it, which
  // turns "equivalent by construction" into "verified per run" — worth having at a seam where two
  // findings have already landed.
  sendChildMessage({
    type: 'ready',
    composedToolNames: composedToolNames(composition),
  });
}
