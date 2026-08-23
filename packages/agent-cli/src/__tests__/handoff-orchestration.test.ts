/**
 * HANDOFF-001 (issue #1864): the five test-plan rows the frame layer could not cover.
 *
 * TC-02, TC-03, TC-04, TC-07 and TC-10 are all about what the two ends DO across a transfer, not
 * about the shape of a frame. They need both orchestrations and a carrier, which is what this file
 * builds — the carrier is two in-process ends, so the transfer is real and the network is scripted.
 *
 * It lives in `agent-cli` rather than beside the orchestrations because the composition is the REAL
 * wire layer. `agent-framework` deliberately does not depend on `agent-transport-protocol` — that is
 * the whole point of `IHandoffComposition` — so the only place the two halves can be put together is
 * the composition root, which is here. A hand-written double would let the orchestration agree with
 * a manifest builder that does not exist, and the one thing these cases have to prove is that the
 * two halves fit.
 */

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import { buildHandoffManifest } from '@robota-sdk/agent-transport-protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HandoffDestination,
  HandoffSource,
  type IHandoffCarrier,
  type IHandoffChunkFrame,
} from '@robota-sdk/agent-framework';

import { createHandoffComposition } from '../handoff/handoff-composition-root.js';

/**
 * The production composition root, not a double. It is as much the subject as the orchestrations
 * are: it is the one place the framework's port meets the wire package's functions, and a
 * hand-written stand-in would let the orchestration agree with a manifest builder that does not
 * exist.
 */
const composition = createHandoffComposition();

function message(index: number, text: string): IInteractiveSessionRecord['messages'][number] {
  return {
    id: `m-${index}`,
    // A real `Date`. The seal is `JSON.stringify`, so this arrives at the destination as an ISO
    // STRING — see the note on the task record. Using a string here would hide that.
    timestamp: new Date('2026-08-21T00:00:00.000Z'),
    state: 'complete',
    role: 'user',
    content: text,
  };
}

function record(id = 'session-1'): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/home/user/project',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T01:00:00.000Z',
    messages: [message(0, 'move me to the laptop')],
  };
}

function offerRequest(overrides: Partial<Parameters<typeof buildHandoffManifest>[0]> = {}) {
  return {
    handoffId: 'handoff-1',
    sessionId: 'session-1',
    sourceDeviceId: 'desktop',
    destinationDeviceId: 'laptop',
    record: record(),
    runtime: {},
    offeredAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Two in-process ends. `drop()` is the network failing, which is the subject of three cases here. */
function wire(destination: HandoffDestination) {
  let delivering = true;
  const chunks: IHandoffChunkFrame[] = [];
  const carrier: IHandoffCarrier = {
    sendManifest: async (manifest) => {
      if (delivering) destination.receiveManifest(manifest);
    },
    sendChunk: async (chunk) => {
      chunks.push(chunk);
      if (delivering) destination.receiveChunk(chunk);
    },
  };
  return {
    carrier,
    chunks,
    drop: () => {
      delivering = false;
    },
  };
}

describe('TC-10: two in-process sessions, a full transfer, and the source read-only afterwards', () => {
  let readOnly: ReturnType<typeof vi.fn>;
  let destination: HandoffDestination;
  let source: HandoffSource;

  beforeEach(() => {
    readOnly = vi.fn();
    destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => true,
      persist: () => true,
      now: () => 1_700_000_001_000,
    });
    source = new HandoffSource({
      composition,
      carrier: wire(destination).carrier,
      onReadOnly: readOnly,
    });
  });

  it('moves the session and leaves exactly one end authoritative', async () => {
    expect(source.offer(offerRequest()).started).toBe(true);
    await source.transfer();
    expect(destination.report().state).toBe('staged');

    // Staged is not live. Asserted before the commit, because "the destination has it" and "the
    // destination is running it" are the two states this design keeps apart.
    expect(destination.liveRecord()).toBe(null);
    expect(source.isAuthoritative()).toBe(true);

    await destination.commit();
    const ack = destination.acknowledgement();
    expect(ack?.persisted).toBe(true);

    const outcome = source.applyAck(ack!);
    expect(outcome.phase).toBe('committed');
    expect(source.isAuthoritative()).toBe(false);
    expect(destination.liveRecord()?.id).toBe('session-1');
    expect(readOnly).toHaveBeenCalledTimes(1);
  });
});

describe('TC-02: the source goes read-only on DURABLE persistence, not on a message', () => {
  it('produces no acknowledgement when the write did not land', async () => {
    const readOnly = vi.fn();
    const destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => true,
      // The write is attempted and reports failure. This is the case a source that transitioned on
      // RECEIPT would get wrong: the bytes arrived, and the session is on no disk.
      persist: () => false,
    });
    const source = new HandoffSource({
      composition,
      carrier: wire(destination).carrier,
      onReadOnly: readOnly,
    });
    source.offer(offerRequest());
    await source.transfer();

    const report = await destination.commit();
    expect(report.state).toBe('discarded');
    expect(destination.acknowledgement()).toBe(null);
    expect(source.isAuthoritative()).toBe(true);
    expect(readOnly).not.toHaveBeenCalled();
  });

  it('refuses an acknowledgement that does not assert persistence', async () => {
    const readOnly = vi.fn();
    const destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => true,
      persist: () => true,
    });
    const source = new HandoffSource({
      composition,
      carrier: wire(destination).carrier,
      onReadOnly: readOnly,
    });
    source.offer(offerRequest());
    await source.transfer();

    // A forged ack: everything the real one has, except the field that carries the evidence.
    const outcome = source.applyAck({
      handoffId: 'handoff-1',
      destinationDeviceId: 'laptop',
      persisted: false as unknown as true,
      committedAt: 1,
    });
    expect(outcome.phase).not.toBe('committed');
    expect(source.isAuthoritative()).toBe(true);
    expect(readOnly).not.toHaveBeenCalled();
  });
});

describe('TC-03: the connection drops during `transferring`', () => {
  it('leaves the source authoritative and the destination with nothing staged', async () => {
    const readOnly = vi.fn();
    const destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => true,
      persist: () => true,
    });
    const link = wire(destination);
    // Drop after the first chunk: the destination is receiving, and the payload never completes.
    let sent = 0;
    const dropping: IHandoffCarrier = {
      sendManifest: link.carrier.sendManifest,
      sendChunk: async (chunk) => {
        sent += 1;
        if (sent > 1) link.drop();
        await link.carrier.sendChunk(chunk);
      },
    };
    const source = new HandoffSource({ composition, carrier: dropping, onReadOnly: readOnly });
    source.offer(offerRequest({ record: { ...record(), messages: manyMessages() } }));
    await source.transfer();

    // More than one chunk actually went, or this case would be about an empty payload instead.
    expect(sent).toBeGreaterThan(1);
    expect(destination.report().state).toBe('receiving');
    expect(destination.liveRecord()).toBe(null);
    expect(source.isAuthoritative()).toBe(true);
    expect(readOnly).not.toHaveBeenCalled();

    // And the destination discarding does not reach across: the source was never told.
    destination.discard('timed-out', 'staging area expired');
    expect(source.isAuthoritative()).toBe(true);
  });
});

describe('TC-04: the drop AFTER the destination commits, before the ack arrives', () => {
  it('leaves the source authoritative, and a RE-DELIVERED ack finishes the transfer', async () => {
    const readOnly = vi.fn();
    const destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => true,
      persist: () => true,
      now: () => 1_700_000_002_000,
    });
    const source = new HandoffSource({
      composition,
      carrier: wire(destination).carrier,
      onReadOnly: readOnly,
    });
    source.offer(offerRequest());
    await source.transfer();
    await destination.commit();

    // The window. The destination is live and has the session on disk; the source has heard nothing.
    expect(destination.liveRecord()?.id).toBe('session-1');
    expect(source.isAuthoritative()).toBe(true);
    expect(readOnly).not.toHaveBeenCalled();

    // Re-delivery is the SUCCESS path of this protocol, not an error path.
    const ack = destination.acknowledgement()!;
    expect(source.applyAck(ack).phase).toBe('committed');
    expect(source.isAuthoritative()).toBe(false);
    expect(readOnly).toHaveBeenCalledTimes(1);

    // And the ack arriving twice is one hand-off, not two: the read-only transition happens once.
    expect(source.applyAck(ack).phase).toBe('committed');
    expect(readOnly).toHaveBeenCalledTimes(1);
  });

  it('is the SAME acknowledgement each time it is read, so idempotence has something stable', async () => {
    const destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => true,
      persist: () => true,
      now: () => 1_700_000_003_000,
    });
    const source = new HandoffSource({
      composition,
      carrier: wire(destination).carrier,
      onReadOnly: () => {},
    });
    source.offer(offerRequest());
    await source.transfer();
    await destination.commit();
    expect(destination.acknowledgement()).toEqual(destination.acknowledgement());
  });
});

describe('TC-07: the destination has no provider credential', () => {
  it('fails at COMMIT, loudly, with the source unaffected', async () => {
    const readOnly = vi.fn();
    const destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => false,
      persist: () => {
        throw new Error('persist must not be reached when the machine cannot run the session');
      },
    });
    const source = new HandoffSource({
      composition,
      carrier: wire(destination).carrier,
      onReadOnly: readOnly,
    });
    source.offer(offerRequest());
    await source.transfer();
    expect(destination.report().state).toBe('staged');

    const report = await destination.commit();
    expect(report.state).toBe('discarded');
    expect(report.refusal).toBe('destination-cannot-resume');
    // Loudly: the reason says which rule produced it, so the user is not left guessing.
    expect(report.detail).toContain('SEC-009');
    expect(destination.acknowledgement()).toBe(null);
    expect(destination.liveRecord()).toBe(null);
    expect(source.isAuthoritative()).toBe(true);
    expect(readOnly).not.toHaveBeenCalled();
  });

  it('resolves the credential BEFORE writing, so a machine that cannot run it holds nothing', async () => {
    const order: string[] = [];
    const destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => {
        order.push('credential');
        return true;
      },
      persist: () => {
        order.push('persist');
        return true;
      },
    });
    const source = new HandoffSource({
      composition,
      carrier: wire(destination).carrier,
      onReadOnly: () => {},
    });
    source.offer(offerRequest());
    await source.transfer();
    await destination.commit();
    expect(order).toEqual(['credential', 'persist']);
  });
});

describe('what the source refuses to start', () => {
  it('will not offer a session with a model call in flight', () => {
    const source = new HandoffSource({
      composition,
      carrier: wire(
        new HandoffDestination({
          composition,
          deviceId: 'laptop',
          resolveCredential: () => true,
          persist: () => true,
        }),
      ).carrier,
      onReadOnly: () => {},
    });
    const outcome = source.offer(offerRequest({ runtime: { modelCallInFlight: true } }));
    expect(outcome.started).toBe(false);
    expect(outcome.started === false && outcome.outcome.refusal).toBe('in-flight-work');
    // Refusing to start is not giving up ownership.
    expect(source.isAuthoritative()).toBe(true);
  });

  it('offers a session whose only unsettled state stays behind by design', () => {
    // The other direction: uncommitted changes and subprocesses are `source-local`, not blockers.
    // Without this the previous case could be passing because the builder refuses everything.
    const source = new HandoffSource({
      composition,
      carrier: wire(
        new HandoffDestination({
          composition,
          deviceId: 'laptop',
          resolveCredential: () => true,
          persist: () => true,
        }),
      ).carrier,
      onReadOnly: () => {},
    });
    expect(
      source.offer(offerRequest({ runtime: { uncommittedChanges: true, subprocesses: 2 } }))
        .started,
    ).toBe(true);
  });
});

describe('a corrupt payload never reaches the staging area', () => {
  it('discards on a digest mismatch and tells the source nothing', async () => {
    const destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => true,
      persist: () => true,
    });
    const readOnly = vi.fn();
    const link = wire(destination);
    const corrupting: IHandoffCarrier = {
      sendManifest: link.carrier.sendManifest,
      sendChunk: async (chunk) =>
        link.carrier.sendChunk({
          ...chunk,
          data: Buffer.from('not the payload that was sealed', 'utf8').toString('base64'),
        }),
    };
    const source = new HandoffSource({ composition, carrier: corrupting, onReadOnly: readOnly });
    source.offer(offerRequest());
    await source.transfer();

    expect(destination.report().state).toBe('discarded');
    expect(destination.report().refusal).toBe('integrity-failed');
    expect(destination.liveRecord()).toBe(null);
    expect(source.isAuthoritative()).toBe(true);
    expect(readOnly).not.toHaveBeenCalled();
  });
});

/** Enough messages to make the payload span several chunks, so a mid-transfer drop is possible. */
function manyMessages(): IInteractiveSessionRecord['messages'] {
  return Array.from({ length: 400 }, (_, index) => message(index, `${'x'.repeat(200)}`));
}
