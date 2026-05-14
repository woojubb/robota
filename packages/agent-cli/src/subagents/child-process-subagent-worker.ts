import {
  createDefaultTools,
  createSubagentLogger,
  createSubagentSession,
} from '@robota-sdk/agent-sdk';
import { createProviderFromProfile } from '@robota-sdk/agent-runtime';
import {
  isSubagentWorkerParentMessage,
  type ISubagentWorkerStartPayload,
  type TSubagentWorkerChildMessage,
  type TSubagentWorkerWireValue,
} from '@robota-sdk/agent-sdk';
import type { ITerminalOutput } from '../types.js';
import { DEFAULT_PROVIDER_DEFINITIONS } from '../utils/provider-default-definitions.js';

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

async function runInitialPrompt(payload: ISubagentWorkerStartPayload): Promise<void> {
  try {
    const provider = createProviderFromProfile(
      payload.providerProfile,
      payload.request.model,
      DEFAULT_PROVIDER_DEFINITIONS,
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
    sendChildMessage({ type: 'result', output });
  } catch (error) {
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
      await session?.run(prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendChildMessage({ type: 'error', message });
    }
  });
}

async function cancelWorker(reason?: string): Promise<void> {
  cancelled = true;
  session?.abort();
  sendChildMessage({ type: 'cancelled', reason });
  await session?.shutdown({ reason: 'other' }).catch(() => undefined);
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
  void session?.shutdown({ reason: 'other' }).catch(() => undefined);
});

sendChildMessage({ type: 'ready' });
