import { buildRuntimeSession } from '@robota-sdk/agent-framework';
import { createMcpTransport } from '@robota-sdk/agent-transport-mcp';

import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';
import type { Writable } from 'node:stream';

const SHUTDOWN_TIMEOUT_MS = 5000;

async function shutdownSession(session: ReturnType<typeof buildRuntimeSession>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      session.shutdown({ reason: 'other', message: 'MCP stdio carrier closed' }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('MCP session shutdown timed out')),
          SHUTDOWN_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One product session, one MCP carrier; process signals and exit policy belong to this shell. */
export async function runMcpServeMode(
  sessionOptions: TInteractiveSessionOptions,
  version: string,
  stdout: Writable,
): Promise<void> {
  const session = buildRuntimeSession(sessionOptions);
  const transport = createMcpTransport({ name: 'robota', version, stdout });
  transport.attach(session);
  let onStop: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    onStop = resolve;
  });
  const signal = (): void => onStop?.();
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    // A signal or peer close during async catalog validation must reach teardown immediately.
    // The transport's stop() cancels the pending startup rather than waiting for it.
    await Promise.race([transport.start(), transport.waitForClose(), stopped]);
    await Promise.race([transport.waitForClose(), stopped]);
  } finally {
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    try {
      await transport.stop();
    } finally {
      await shutdownSession(session);
    }
  }
}
