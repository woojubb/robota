/**
 * TRANS-006 (issue #2097) — the handoff destination decodes before it stages.
 *
 * Integrity is not validity. A digest proves the bytes that arrived are the bytes that were sent; it
 * says nothing about whether they are a session record. These cases drive the REAL composition root
 * — the same reasoning as `handoff-orchestration.test.ts`, which lives here rather than beside the
 * orchestration because a hand-written double would let the orchestration agree with a manifest
 * builder that does not exist. A double would be worse here specifically: the whole subject is
 * whether a genuine digest can pass while the payload is not a record, and a stand-in digest would
 * make that unfalsifiable.
 *
 * TC-05 is the case that carries the design: one payload fails integrity and one passes integrity
 * and fails decoding, asserted to produce DIFFERENT refusals. The two require opposite actions from
 * the source — an integrity failure is retried, a decode failure never is — so a suite that only
 * checked "it refused" would pass against an implementation that had collapsed them.
 */

import { HandoffDestination, HandoffSource } from '@robota-sdk/agent-framework';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHandoffComposition } from '../handoff/handoff-composition-root.js';

import type { IHandoffCarrier, IHandoffChunkFrame } from '@robota-sdk/agent-framework';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const composition = createHandoffComposition();

function validRecord(id = 'session-1'): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/home/user/project',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        // A real `Date`. The seal is `JSON.stringify`, so this reaches the destination as an ISO
        // string — the decoder is what turns it back into a `Date`, and TC-08 asserts that.
        timestamp: new Date('2026-08-21T00:00:00.000Z'),
        state: 'complete',
        role: 'user',
        content: 'move me to the laptop',
      },
    ],
  };
}

/**
 * A payload that is NOT a session record, handed to the manifest builder as if it were.
 *
 * The builder serializes and digests whatever it is given, so the manifest's digest and byte length
 * are correct FOR THESE BYTES. That is the point: integrity passes honestly, and only the decode
 * fails. The cast is the test's subject rather than a convenience — it stands in for a source on a
 * different build, a partially written record, or a crafted payload.
 */
function undecodableRecord(shape: unknown): IInteractiveSessionRecord {
  return shape as IInteractiveSessionRecord;
}

function offerRequest(record: IInteractiveSessionRecord) {
  return {
    handoffId: 'handoff-1',
    sessionId: 'session-1',
    sourceDeviceId: 'desktop',
    destinationDeviceId: 'laptop',
    record,
    runtime: {},
    offeredAt: 1_700_000_000_000,
  };
}

function wire(
  destination: HandoffDestination,
  corrupt?: (chunk: IHandoffChunkFrame) => IHandoffChunkFrame,
) {
  const carrier: IHandoffCarrier = {
    sendManifest: async (manifest) => {
      destination.receiveManifest(manifest);
    },
    sendChunk: async (chunk) => {
      destination.receiveChunk(corrupt ? corrupt(chunk) : chunk);
    },
  };
  return carrier;
}

describe('handoff decode — TC-04/TC-06: an intact payload that is not a record never stages', () => {
  let destination: HandoffDestination;
  let persist: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    persist = vi.fn(() => true);
    destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => true,
      persist,
      now: () => 1_700_000_001_000,
    });
  });

  it.each([
    ['a record missing every required member', {}],
    ['messages that are not an array', { ...validRecord(), messages: 'not-an-array' }],
    [
      'a message with no timestamp',
      { ...validRecord(), messages: [{ id: 'm', role: 'user', content: 'x', state: 'complete' }] },
    ],
    ['a member the contract does not declare', { ...validRecord(), surprise: true }],
    ['a JSON array where a record belongs', []],
  ])('refuses %s as payload-undecodable', async (_case, shape) => {
    const source = new HandoffSource({
      composition,
      carrier: wire(destination),
      onReadOnly: vi.fn(),
    });
    expect(source.offer(offerRequest(undecodableRecord(shape))).started).toBe(true);
    await source.transfer();

    const report = destination.report();
    expect(report.state).not.toBe('staged');
    expect(report.state).toBe('discarded');
    expect(report.refusal).toBe('payload-undecodable');

    // TC-06: nothing is committable after the refusal, and no write was attempted.
    expect(destination.liveRecord()).toBe(null);
    expect(persist).not.toHaveBeenCalled();
  });

  it('names the offending field path in the refusal detail', async () => {
    const source = new HandoffSource({
      composition,
      carrier: wire(destination),
      onReadOnly: vi.fn(),
    });
    source.offer(offerRequest(undecodableRecord({ ...validRecord(), messages: 'not-an-array' })));
    await source.transfer();

    expect(destination.report().detail).toContain('messages');
  });
});

describe('handoff decode — TC-05: integrity failure and decode failure are different refusals', () => {
  function newDestination(): HandoffDestination {
    return new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => true,
      persist: () => true,
      now: () => 1_700_000_001_000,
    });
  }

  it('a payload whose bytes were altered in flight refuses integrity-failed', async () => {
    const destination = newDestination();
    const source = new HandoffSource({
      composition,
      // Alter the bytes after the manifest was built, so the digest no longer describes them.
      carrier: wire(destination, (chunk) => ({ ...chunk, data: `${chunk.data} ` })),
      onReadOnly: vi.fn(),
    });
    source.offer(offerRequest(validRecord()));
    await source.transfer();

    expect(destination.report().refusal).toBe('integrity-failed');
  });

  it('a payload whose bytes are intact and whose shape is wrong refuses payload-undecodable', async () => {
    const destination = newDestination();
    const source = new HandoffSource({
      composition,
      carrier: wire(destination),
      onReadOnly: vi.fn(),
    });
    source.offer(offerRequest(undecodableRecord({ id: 'session-1' })));
    await source.transfer();

    expect(destination.report().refusal).toBe('payload-undecodable');
  });
});

describe('handoff decode — TC-08: the valid path still stages, commits and revives dates', () => {
  it('carries a real Date through the transfer', async () => {
    const destination = new HandoffDestination({
      composition,
      deviceId: 'laptop',
      resolveCredential: () => true,
      persist: () => true,
      now: () => 1_700_000_001_000,
    });
    const source = new HandoffSource({
      composition,
      carrier: wire(destination),
      onReadOnly: vi.fn(),
    });
    source.offer(offerRequest(validRecord()));
    await source.transfer();
    expect(destination.report().state).toBe('staged');

    await destination.commit();
    const live = destination.liveRecord();
    expect(live?.id).toBe('session-1');

    // The seal is `JSON.stringify`, so the timestamp crossed as a string. Before TRANS-006 the
    // destination cast it back and the declared `Date` was a lie on the receiving side.
    expect(live?.messages[0]?.timestamp).toBeInstanceOf(Date);
    expect(live?.messages[0]?.timestamp.toISOString()).toBe('2026-08-21T00:00:00.000Z');
  });
});
