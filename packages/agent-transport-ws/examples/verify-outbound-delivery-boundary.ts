/**
 * ARCH-030 user-execution scenario — a reply that resolves AFTER the carrier disconnected is
 * reported through the carrier's delivery boundary, not thrown into the void.
 *
 * Two phases, both over this package's public barrel exports:
 *
 * - **Phase A — real carrier.** A real `WsTransport` binds a loopback port, a real `ws` client
 *   connects, and a remote `command` is held open by a gate the scenario controls. The client
 *   disconnects, the command resolves, and the reply is delivered into a socket that is gone.
 *   Observables: the command still committed (it wrote its marker file), the carrier's protocol
 *   cleanup ran exactly once (the session's `on`/`off` listener balance), and NO unhandled rejection
 *   escaped.
 *
 * - **Phase B — observable carrier.** `createWsTransport` takes `send`/`onDeliveryError` as public
 *   options, so the delivery-error count and the latch are directly observable — `WsSessionDelivery`
 *   is package-internal by design (that IS the fix), so phase A cannot read them.
 *
 * Before ARCH-030 this printed `unhandledRejections: 1` for phase A and `deliveryErrors: []` with
 * `latchThrew: "WebSocket is not open"` for phase B. Run it with:
 *
 *     pnpm scenario:verify
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';
import { WebSocket } from 'ws';

import { createWsTransport, WsTransport } from '@robota-sdk/agent-transport-ws';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

const SCENARIO_PORT = 43117;
const SCENARIO_MAX_RETRIES = 25;

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** A session whose one command is held open until the scenario releases it. */
function createGatedSession(markerPath: string): {
  session: IInteractiveSession;
  release: () => void;
  listenerCount: () => number;
} {
  const listeners = new Set<string>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = createTestInteractiveSession({
    on: ((event: string) => {
      listeners.add(event);
    }) as IInteractiveSession['on'],
    off: ((event: string) => {
      listeners.delete(event);
    }) as IInteractiveSession['off'],
    executeCommand: (name: string) =>
      gate.then(() => {
        // The committed operation: it happens whether or not its reply can be delivered.
        writeFileSync(markerPath, `${name} committed\n`, 'utf8');
        return { success: true, message: 'committed' };
      }),
  } as Partial<IInteractiveSession>);
  return { session, release, listenerCount: () => listeners.size };
}

/** Phase A — the real `ws` server, the real client socket, the real `WsSessionDelivery`. */
async function runRealCarrierPhase(markerPath: string): Promise<Record<string, unknown>> {
  const rejections: unknown[] = [];
  const collect = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', collect);

  const gated = createGatedSession(markerPath);
  const transport = new WsTransport({ port: SCENARIO_PORT, maxRetries: SCENARIO_MAX_RETRIES });
  transport.attach(gated.session);
  let client: WebSocket | undefined;
  try {
    await transport.start();
    const port = transport.boundPort;
    assertCondition(port !== undefined, 'the transport did not report a bound port');
    const token = transport.resolvedToken;
    assertCondition(token !== undefined, 'the transport did not auto-mint an admission token');

    client = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      client?.once('open', () => resolve());
      client?.once('error', reject);
    });
    const listenersWhileConnected = gated.listenerCount();
    assertCondition(listenersWhileConnected > 0, 'the handler subscribed to no session events');

    client.send(JSON.stringify({ type: 'command', name: 'status' }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Disconnect, THEN let the command finish: the reply now targets a socket that is gone.
    await new Promise<void>((resolve) => {
      client?.once('close', () => resolve());
      client?.terminate();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    gated.release();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const committed = existsSync(markerPath) && readFileSync(markerPath, 'utf8').includes('status');
    const cleanupRuns = gated.listenerCount() === 0 ? 1 : 0;

    assertCondition(committed, 'the command did not commit before its reply failed');
    assertCondition(
      cleanupRuns === 1,
      `real carrier cleanup did not run exactly once (listeners still attached: ${gated.listenerCount()})`,
    );
    assertCondition(
      rejections.length === 0,
      `real carrier produced unhandled rejections: ${JSON.stringify(
        rejections.map((r) => (r instanceof Error ? r.message : String(r))),
      )}`,
    );

    return {
      carrier: 'WsTransport(real ws socket)',
      operationCommitted: committed,
      cleanupRuns,
      unhandledRejections: rejections.length,
    };
  } finally {
    process.off('unhandledRejection', collect);
    client?.terminate();
    await transport.stop();
  }
}

/** Phase B — `createWsTransport`, whose delivery callbacks are public options. */
async function runObservableCarrierPhase(markerPath: string): Promise<Record<string, unknown>> {
  const rejections: unknown[] = [];
  const collect = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', collect);

  const gated = createGatedSession(markerPath);
  const deliveryErrors: Array<{ message: string; event: string }> = [];
  const delivered: TServerMessage[] = [];
  let socketOpen = true;
  const transport = createWsTransport({
    send: (message) => {
      // The real carrier's failure mode, reproduced exactly: a closed socket throws on send.
      if (!socketOpen) throw new Error('WebSocket is not open');
      delivered.push(message);
    },
    onDeliveryError: (error, event) => deliveryErrors.push({ message: error.message, event }),
  });
  transport.attach(gated.session);
  try {
    await transport.start();
    // Captured BEFORE the failure, deliberately. The carrier's cleanup nulls `transport.onMessage`, so
    // reading it afterwards yields null and pushing a frame through it would exercise nothing — the
    // observable would report a pass it never measured. Review caught exactly that: `latchThrew` was
    // unconditionally null because it re-read the property the cleanup had just cleared.
    const retainedHandler = transport.onMessage;
    assertCondition(
      retainedHandler !== null,
      'the transport exposed no inbound handler after start()',
    );

    retainedHandler(JSON.stringify({ type: 'command', name: 'status' }));

    socketOpen = false;
    gated.release();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const committed = existsSync(markerPath) && readFileSync(markerPath, 'utf8').includes('status');
    const cleanupObserved = transport.onMessage === null;

    // The latch, from outside: a further frame pushed through the RETAINED handler after the failure is
    // dropped — neither a second delivery error nor a synchronous throw. Pre-ARCH-030 this threw
    // `WebSocket is not open` straight out of the handler.
    let latchThrew: string | null = null;
    try {
      retainedHandler(JSON.stringify({ type: 'get-messages' }));
    } catch (error) {
      latchThrew = error instanceof Error ? error.message : String(error);
    }

    assertCondition(committed, 'the command did not commit before its reply failed');
    assertCondition(
      deliveryErrors.length === 1,
      `expected exactly one delivery error, got ${JSON.stringify(deliveryErrors)}`,
    );
    assertCondition(
      deliveryErrors[0]?.event === 'command_result',
      `the delivery error named the wrong frame: ${JSON.stringify(deliveryErrors[0])}`,
    );
    assertCondition(cleanupObserved, 'the carrier cleanup did not detach the inbound handler');
    assertCondition(
      latchThrew === null,
      `a post-failure frame escaped the boundary: ${latchThrew}`,
    );
    assertCondition(
      rejections.length === 0,
      `observable carrier produced unhandled rejections: ${JSON.stringify(
        rejections.map((r) => (r instanceof Error ? r.message : String(r))),
      )}`,
    );

    return {
      carrier: 'createWsTransport(observable delivery callbacks)',
      operationCommitted: committed,
      cleanupObserved,
      deliveryErrors,
      latchThrew,
      unhandledRejections: rejections.length,
    };
  } finally {
    process.off('unhandledRejection', collect);
    await transport.stop();
  }
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-030-outbound-'));
  let result: Record<string, unknown> | undefined;
  try {
    const realCarrier = await runRealCarrierPhase(join(cwd, 'real-carrier.marker'));
    const observedCarrier = await runObservableCarrierPhase(join(cwd, 'observed-carrier.marker'));
    result = { scenario: 'ARCH-030-outbound-delivery-boundary', realCarrier, observedCarrier };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  assertCondition(result !== undefined, 'scenario did not produce a result');
  assertCondition(!existsSync(cwd), 'scenario cleanup did not remove its temporary directory');
  process.stdout.write(`${JSON.stringify({ ...result, cleanupRemoved: true })}\n`);
}

await main();
