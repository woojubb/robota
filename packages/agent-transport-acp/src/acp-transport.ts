/**
 * ITransportAdapter that runs the attached session as an Agent Client Protocol (v1) agent, so an
 * editor that launches the process can create a session, prompt it, see streamed output and tool
 * calls, approve or reject permissions, and cancel a turn.
 *
 * The adapter owns the carrier's readiness and teardown; the product shell owns process policy
 * (stdout reservation, workspace trust, signals).
 */

import { Readable } from 'node:stream';

import { ndJsonStream } from '@agentclientprotocol/sdk';
import { attachStdioCarrier } from '@robota-sdk/agent-transport/node';

import { createAcpAgent } from './acp-agent.js';

import type { IAcpTransport, IAcpTransportOptions, IAcpTransportSession } from './acp-types.js';
import type { AgentConnection } from '@agentclientprotocol/sdk';
import type { Writable } from 'node:stream';
import type { ITransportLifecycleError } from '@robota-sdk/agent-interface-transport';
import type { IStdioCarrier } from '@robota-sdk/agent-transport/node';

/**
 * A Web sink over the process output. `Writable.toWeb` would leave its own listeners on a stream
 * the transport does not own, and destroy it if the SDK ever aborts the sink; this adds none.
 */
function outputSink(output: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write: (chunk) =>
      new Promise<void>((resolve, reject) => {
        output.write(chunk, (error) => (error ? reject(error) : resolve()));
      }),
  });
}

export function createAcpTransport(options: IAcpTransportOptions): IAcpTransport {
  let session: IAcpTransportSession | null = null;
  let running = false;
  let stopping: Promise<void> | null = null;
  let carrier: IStdioCarrier | null = null;
  let connection: AgentConnection | null = null;
  let cancelActive: (() => void) | null = null;
  let resolveClose: (() => void) | null = null;
  let rejectClose: ((error: Error) => void) | null = null;
  let closePromise: Promise<void> = Promise.resolve();
  const resetClose = (): void => {
    closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    // allow-fallback: waitForClose retains the rejection for the process owner; this observer only prevents an early unhandled-rejection warning.
    void closePromise.catch(() => undefined);
  };
  const release = (): void => {
    try {
      cancelActive?.();
      connection?.close();
    } finally {
      carrier?.release();
      carrier = null;
      connection = null;
      cancelActive = null;
    }
  };
  const lifecycleError = (code: ITransportLifecycleError['code']): ITransportLifecycleError =>
    Object.assign(new Error(`ACP transport ${code}.`), {
      name: 'TransportLifecycleError' as const,
      code,
      transportName: 'acp',
    });

  return {
    name: 'acp',
    lifecycle: Object.freeze({ kind: 'service' }),
    attach(s: IAcpTransportSession) {
      if (running || stopping) throw lifecycleError('already-started');
      session = s;
      resetClose();
    },
    async start() {
      if (!session) throw lifecycleError('not-attached');
      if (running || stopping) throw lifecycleError('already-started');
      running = true;
      try {
        const acpAgent = createAcpAgent(session, options);
        cancelActive = acpAgent.cancelActive;
        // The SDK destroys what it reads when its connection closes; it reads the bridge, never the
        // process input, and a closed or failed end ends the transport instead of leaving it idle.
        const attached = attachStdioCarrier(options.input, options.output, {
          onInputClose: () => resolveClose?.(),
          onOutputClose: () => resolveClose?.(),
          onOutputError: (error) => rejectClose?.(error),
        });
        carrier = attached;
        const opened = acpAgent.app.connect(
          ndJsonStream(
            outputSink(options.output),
            Readable.toWeb(attached.bridge) as ReadableStream<Uint8Array>,
          ),
        );
        connection = opened;
        void opened.closed.then(() => resolveClose?.());
      } catch (error) {
        // A start that failed serves nothing, so a retry must not be told it is already running.
        release();
        running = false;
        throw error;
      }
    },
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        try {
          release();
        } finally {
          session = null;
          running = false;
          resolveClose?.();
        }
      })().finally(() => {
        stopping = null;
      });
      return stopping;
    },
    waitForClose() {
      return closePromise;
    },
  };
}
