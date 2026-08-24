/**
 * ARCH-030 — the connection-scoped outbound delivery boundary.
 *
 * Every case here was RED before the boundary existed. The two escape hatches it closes are different
 * and both had to be covered: a reply resolving from a Promise continuation escaped as an
 * `unhandledRejection`, while a synchronous reply threw straight out of `onMessage` into the carrier's
 * inbound listener. Guarding only the first would have left six families still escaping.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { createWsHandler } from '../ws-handler.js';

import type { TOutboundDeliver } from '../outbound-delivery.js';
import type { TServerMessage } from '../ws-protocol.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

interface ICarrierProbe {
  readonly deliver: TOutboundDeliver;
  readonly delivered: TServerMessage[];
  readonly failures: Array<{ message: string; event: TServerMessage['type'] }>;
  disconnect: () => void;
}

/** A carrier whose sink starts throwing the real `WsSessionDelivery` error once disconnected. */
function createCarrierProbe(): ICarrierProbe {
  const delivered: TServerMessage[] = [];
  const failures: Array<{ message: string; event: TServerMessage['type'] }> = [];
  let open = true;
  const probe: ICarrierProbe = {
    delivered,
    failures,
    disconnect: () => {
      open = false;
    },
    deliver: createOutboundDelivery(
      (message) => {
        if (!open) throw new Error('WebSocket is not open');
        delivered.push(message);
      },
      (error, event) => failures.push({ message: error.message, event }),
    ),
  };
  return probe;
}

/**
 * Collect unhandled rejections for the duration of `run`. Node reports them on a later tick, so the
 * helper drains the microtask/macrotask queue before restoring the previous listeners.
 */
async function withUnhandledRejectionCapture(run: () => void | Promise<void>): Promise<unknown[]> {
  const captured: unknown[] = [];
  const existing = process.listeners('unhandledRejection');
  for (const listener of existing) process.off('unhandledRejection', listener);
  const collect = (reason: unknown): void => {
    captured.push(reason);
  };
  process.on('unhandledRejection', collect);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off('unhandledRejection', collect);
    for (const listener of existing)
      process.on('unhandledRejection', listener as NodeJS.UnhandledRejectionListener);
  }
  return captured;
}

/** A deferred whose resolution the test controls, so "after disconnect" is deterministic. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createOutboundDelivery', () => {
  it('reports a carrier failure instead of throwing at the caller', () => {
    const probe = createCarrierProbe();
    probe.disconnect();

    expect(() => probe.deliver({ type: 'history_cleared' })).not.toThrow();
    expect(probe.failures).toEqual([
      { message: 'WebSocket is not open', event: 'history_cleared' },
    ]);
  });

  it('latches: a connection reports at most one delivery failure', () => {
    const probe = createCarrierProbe();
    probe.disconnect();

    probe.deliver({ type: 'history_cleared' });
    probe.deliver({ type: 'executing', executing: true });
    probe.deliver({ type: 'protocol_error', message: 'third' });

    expect(probe.failures).toHaveLength(1);
    // The three carriers each grew their own latch to suppress the repeats; it belongs here instead.
    expect(probe.failures[0]?.event).toBe('history_cleared');
  });

  it('isolates an error handler that itself throws', () => {
    const deliver = createOutboundDelivery(
      () => {
        throw new Error('carrier down');
      },
      () => {
        throw new Error('observer exploded');
      },
    );

    // A diagnostic cannot reverse a session operation that has already committed.
    expect(() => deliver({ type: 'history_cleared' })).not.toThrow();
  });

  it('normalizes a non-Error throw', () => {
    const failures: Error[] = [];
    const deliver = createOutboundDelivery(
      () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- a carrier can throw anything
        throw 'data channel is closing';
      },
      (error) => failures.push(error),
    );

    deliver({ type: 'history_cleared' });
    expect(failures[0]).toBeInstanceOf(Error);
    expect(failures[0]?.message).toBe('data channel is closing');
  });

  it('refuses a raw sink where a boundary is required — the mechanical floor', () => {
    const session = createTestInteractiveSession();
    const rawSend = (_message: TServerMessage): void => undefined;

    createWsHandler({
      session,
      // @ts-expect-error ARCH-030: only `createOutboundDelivery` produces a `TOutboundDeliver`. If this
      // ever compiles, the brand is gone and a twelfth reply family can reach the wire unguarded.
      deliver: rawSend,
    });
  });
});

describe('reply families that resolve after the carrier disconnected (ARCH-030)', () => {
  /** The five families whose reply lands from a Promise continuation. */
  const asynchronousFamilies: ReadonlyArray<{
    readonly name: string;
    readonly frame: Record<string, unknown>;
    readonly expectedEvent: TServerMessage['type'];
    readonly session: (release: Promise<never> | Promise<unknown>) => Partial<IInteractiveSession>;
  }> = [
    {
      name: 'command result',
      frame: { type: 'command', name: 'status' },
      expectedEvent: 'command_result',
      session: (release) => ({
        executeCommand: () => release.then(() => ({ success: true, message: 'done' })),
      }),
    },
    {
      name: 'submit rejection',
      frame: { type: 'submit', prompt: 'hello' },
      expectedEvent: 'protocol_error',
      session: (release) => ({
        submit: () => release.then(() => Promise.reject(new Error('submit failed'))),
      }),
    },
    {
      name: 'background log read',
      frame: { type: 'read-background-task-log', taskId: 'task_1' },
      expectedEvent: 'background_task_log',
      session: (release) => ({
        readBackgroundTaskLog: () => release.then(() => ({ taskId: 'task_1', lines: [] })),
      }),
    },
    {
      name: 'job-group wait',
      frame: { type: 'wait-background-job-group', groupId: 'group_1' },
      expectedEvent: 'background_job_group',
      session: (release) => ({
        waitBackgroundJobGroup: () =>
          release.then(() => ({
            id: 'group_1',
            parentSessionId: 'session_1',
            waitPolicy: 'wait_all' as const,
            taskIds: [],
            status: 'completed' as const,
            createdAt: '2026-08-16T00:00:00.000Z',
            updatedAt: '2026-08-16T00:00:00.000Z',
            results: [],
          })),
      }),
    },
    {
      name: 'background control result',
      frame: { type: 'cancel-background-task', taskId: 'task_1' },
      expectedEvent: 'background_task_control_result',
      session: (release) => ({
        cancelBackgroundTask: () => release.then(() => undefined),
      }),
    },
  ];

  for (const family of asynchronousFamilies) {
    it(`reports and does not leak an unhandled rejection — ${family.name}`, async () => {
      const probe = createCarrierProbe();
      const gate = deferred<void>();
      const session = createTestInteractiveSession(
        family.session(gate.promise) as Partial<IInteractiveSession>,
      );
      const handler = createWsHandler({ session, deliver: probe.deliver });

      const rejections = await withUnhandledRejectionCapture(async () => {
        handler.onMessage(JSON.stringify(family.frame));
        probe.disconnect();
        gate.resolve();
      });

      expect(rejections).toEqual([]);
      expect(probe.failures).toEqual([
        { message: 'WebSocket is not open', event: family.expectedEvent },
      ]);
      handler.cleanup();
    });
  }

  /** The six families whose reply is synchronous — they used to throw out of `onMessage` itself. */
  const synchronousFrames: ReadonlyArray<{
    name: string;
    raw: string;
    event: TServerMessage['type'];
  }> = [
    { name: 'parse error', raw: 'not json at all', event: 'protocol_error' },
    {
      name: 'unknown message type',
      raw: JSON.stringify({ type: 'nonsense' }),
      event: 'protocol_error',
    },
    {
      name: 'submit validation error',
      raw: JSON.stringify({ type: 'submit', prompt: '' }),
      event: 'protocol_error',
    },
    { name: 'session query', raw: JSON.stringify({ type: 'get-executing' }), event: 'executing' },
    {
      name: 'background query snapshot',
      raw: JSON.stringify({ type: 'get-background-tasks' }),
      event: 'background_tasks',
    },
    {
      name: 'background validation error',
      raw: JSON.stringify({ type: 'get-background-task', taskId: '' }),
      event: 'protocol_error',
    },
  ];

  for (const frame of synchronousFrames) {
    it(`does not throw out of onMessage — ${frame.name}`, () => {
      const probe = createCarrierProbe();
      const handler = createWsHandler({
        session: createTestInteractiveSession(),
        deliver: probe.deliver,
      });
      probe.disconnect();

      expect(() => handler.onMessage(frame.raw)).not.toThrow();
      expect(probe.failures).toEqual([{ message: 'WebSocket is not open', event: frame.event }]);
      handler.cleanup();
    });
  }

  it('leaves the committed session operation successful and drops later frames silently', async () => {
    const probe = createCarrierProbe();
    const gate = deferred<void>();
    const executed: string[] = [];
    const session = createTestInteractiveSession({
      executeCommand: (name: string) =>
        gate.promise.then(() => {
          executed.push(name);
          return { success: true, message: 'done' };
        }),
    } as Partial<IInteractiveSession>);
    const handler = createWsHandler({ session, deliver: probe.deliver });

    const rejections = await withUnhandledRejectionCapture(async () => {
      handler.onMessage(JSON.stringify({ type: 'command', name: 'status' }));
      probe.disconnect();
      gate.resolve();
    });

    expect(rejections).toEqual([]);
    expect(executed).toEqual(['status']); // the command ran; delivery failing did not reverse it
    expect(probe.failures).toHaveLength(1);

    // The latch, observed from outside: a further inbound frame is dropped, neither reported again
    // nor thrown out of `onMessage`.
    expect(() => handler.onMessage(JSON.stringify({ type: 'get-executing' }))).not.toThrow();
    expect(probe.failures).toHaveLength(1);
    handler.cleanup();
  });

  it('keeps the session-event fan-out on the same boundary', () => {
    const emit = new Map<string, (payload: unknown) => void>();
    const probe = createCarrierProbe();
    const session = createTestInteractiveSession({
      on: ((event: string, handler: (payload: unknown) => void) => {
        emit.set(event, handler);
      }) as IInteractiveSession['on'],
      off: ((event: string) => {
        emit.delete(event);
      }) as IInteractiveSession['off'],
    });
    createWsHandler({ session, deliver: probe.deliver });
    probe.disconnect();

    expect(() => emit.get('history_cleared')?.(undefined)).not.toThrow();
    expect(probe.failures).toEqual([
      { message: 'WebSocket is not open', event: 'history_cleared' },
    ]);
    // …and the fan-out shares the reply path's latch rather than having a second one.
    emit.get('thinking')?.(true);
    expect(probe.failures).toHaveLength(1);
  });
});

/**
 * ARCH-030 / issue #1734 — the boundary can be ASKED about backpressure, and never invents an answer.
 *
 * `deliver` returning is not delivery: both carriers hand this boundary a fire-and-forget sink, so a
 * frame that has "been sent" may be sitting in a socket buffer the boundary cannot see. Before this,
 * a non-reading peer — the contract case the issue names — was not observable at all, and any budget
 * built here would have counted what the boundary HANDED OVER rather than what the peer had not read.
 *
 * These pin the two things that make the number worth having: it comes from the carrier, and
 * "cannot say" is distinguishable from "nothing pending".
 */
describe('outbound backpressure reporting (ARCH-030 / issue #1734)', () => {
  it('reports the carrier own reading, not a count the boundary kept', () => {
    let carrierPending = 0;
    const deliver = createOutboundDelivery(
      () => {
        // The carrier accepted it and has NOT written it — exactly the state the boundary cannot see
        // by counting its own calls.
        carrierPending += 100;
      },
      () => undefined,
      () => carrierPending,
    );

    expect(deliver.pendingBytes()).toBe(0);
    deliver({ type: 'protocol_error', message: 'x' } as never);
    deliver({ type: 'protocol_error', message: 'y' } as never);
    expect(deliver.pendingBytes()).toBe(200);
  });

  it('a peer that stops reading makes the number grow while every deliver still returns', () => {
    let carrierPending = 0;
    const deliver = createOutboundDelivery(
      () => {
        carrierPending += 10;
      },
      () => undefined,
      () => carrierPending,
    );

    for (let i = 0; i < 50; i += 1) deliver({ type: 'protocol_error', message: 'x' } as never);

    // Nothing threw and nothing reported a failure — which is the whole point: a non-reading peer is
    // indistinguishable from a healthy one through `deliver` alone.
    expect(deliver.pendingBytes()).toBe(500);
  });

  it('answers `undefined` — not 0 — when the carrier supplied no reading', () => {
    const deliver = createOutboundDelivery(
      () => undefined,
      () => undefined,
    );

    // `0` would let "unknown" satisfy any threshold later placed on this number, which is the defect
    // a budget over the wrong quantity would reintroduce.
    expect(deliver.pendingBytes()).toBeUndefined();
    expect(deliver.pendingBytes()).not.toBe(0);
  });

  it('re-reads at call time, so a value that changes underneath is not captured once', () => {
    let carrierPending = 7;
    const deliver = createOutboundDelivery(
      () => undefined,
      () => undefined,
      () => carrierPending,
    );

    expect(deliver.pendingBytes()).toBe(7);
    carrierPending = 0; // the peer drained
    expect(deliver.pendingBytes()).toBe(0);
  });
});

describe('ARCH-030: the byte budget the boundary enforces itself', () => {
  it('refuses and closes when the carrier is holding more than the budget', () => {
    // The contract case the reopened scope names: a peer that accepted frames and stopped reading.
    // Detected by what the CARRIER is still holding, not by anything this boundary counted.
    const sent: TServerMessage[] = [];
    const failures: Array<{ error: Error; event: string }> = [];
    let pending = 0;
    const deliver = createOutboundDelivery(
      (message) => sent.push(message),
      (error, event) => failures.push({ error, event }),
      () => pending,
      100,
    );

    deliver({ type: 'protocol_error', message: 'under budget' });
    expect(sent).toHaveLength(1);

    pending = 101;
    deliver({ type: 'protocol_error', message: 'over budget' });

    expect(sent).toHaveLength(1); // not sent
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error.message).toContain('101 byte(s) pending, limit 100');
  });

  it('checks the budget BEFORE sending, so the boundary is not the last contributor to the overflow', () => {
    // Checking after would let one more frame onto a carrier already past its limit, and would report
    // an overflow the boundary had just helped cause.
    const sent: TServerMessage[] = [];
    const deliver = createOutboundDelivery(
      (message) => sent.push(message),
      () => {},
      () => 500,
      100,
    );

    deliver({ type: 'protocol_error', message: 'first frame, already over' });
    expect(sent).toHaveLength(0);
  });

  it('applies no budget to a carrier that cannot report backpressure', () => {
    // `undefined` is unknown, not zero. A default of 0 would refuse every frame on such a carrier —
    // turning "cannot measure" into "always over budget".
    const sent: TServerMessage[] = [];
    const deliver = createOutboundDelivery(
      (message) => sent.push(message),
      () => {},
      () => undefined,
      // A limit BELOW zero, deliberately. With `0`, a mutant collapsing `undefined` to `0` still
      // passes — `0 > 0` is false — so the case would assert nothing about the collapse it exists to
      // forbid. Below zero, only "unknown means no budget applies" can explain the frame going out.
      -1,
    );

    deliver({ type: 'protocol_error', message: 'no reading available' });
    expect(sent).toHaveLength(1);
  });
});
