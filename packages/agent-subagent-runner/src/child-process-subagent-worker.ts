import { sumHistoryUsage } from '@robota-sdk/agent-core';
import { createProviderFromProfile } from '@robota-sdk/agent-executor';
import {
  createDefaultTools,
  createSubagentLogger,
  createSubagentSession,
} from '@robota-sdk/agent-framework';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider';

import {
  isSubagentWorkerParentMessage,
  type ISubagentWorkerStartPayload,
  type TSubagentWorkerChildMessage,
  type TSubagentWorkerWireValue,
} from './child-process-subagent-ipc.js';

import type { ITerminalOutput } from '@robota-sdk/agent-core';

const CANCEL_EXIT_CODE = 130;

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

async function runInitialPrompt(payload: ISubagentWorkerStartPayload): Promise<void> {
  try {
    const provider = createProviderFromProfile(
      payload.providerProfile,
      payload.request.model,
      createDefaultProviderDefinitions(),
    );
    const sessionLogger = payload.logsDir
      ? createSubagentLogger(payload.request.parentSessionId, payload.jobId, payload.logsDir)
      : undefined;
    session = createSubagentSession({
      agentDefinition: payload.agentDefinition,
      parentConfig: payload.parentConfig,
      parentContext: payload.parentContext,
      parentTools: createDefaultTools(),
      provider,
      terminal: NOOP_TERMINAL,
      sessionId: payload.jobId,
      ...(sessionLogger ? { sessionLogger } : {}),
      permissionMode: payload.permissionMode,
      hooks: payload.parentConfig.hooks,
      onTextDelta: (delta) => sendChildMessage({ type: 'text_delta', delta }),
      onToolExecution: forwardToolExecution,
    });
    const output = await session.run(payload.request.prompt);
    if (cancelled) {
      sendChildMessage({ type: 'cancelled', reason: 'Subagent worker cancelled' });
      return;
    }
    // ANALYTICS-001 (Phase 2): forward the subagent's total token usage so the parent log can
    // attribute it to this agent as a source. Best-effort — usage capture must never fail the run.
    const usage = readSessionUsage(session);
    sendChildMessage({ type: 'result', output, ...(usage ? { usage } : {}) });
  } catch (error) {
    // allow-fallback: child process must report errors to parent via IPC, not crash silently
    if (cancelled) {
      sendChildMessage({ type: 'cancelled', reason: 'Subagent worker cancelled' });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    sendChildMessage({ type: 'error', message });
  } finally {
    setImmediate(() => process.exit(cancelled ? CANCEL_EXIT_CODE : 0));
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

process.on('message', (message: TSubagentWorkerWireValue) => {
  if (!isSubagentWorkerParentMessage(message)) {
    sendChildMessage({ type: 'error', message: 'Malformed subagent worker parent message' });
    return;
  }

  switch (message.type) {
    case 'start':
      running = running.then(() => runInitialPrompt(message.payload));
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

sendChildMessage({ type: 'ready' });
