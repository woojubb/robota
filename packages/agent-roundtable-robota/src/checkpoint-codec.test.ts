import { describe, expect, it } from 'vitest';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import { RobotaParticipantError } from './errors';
import {
  ROBOTA_AGENT_CHECKPOINT_VERSION,
  ROBOTA_SESSION_CHECKPOINT_VERSION,
  decodeAgentCheckpoint,
  decodeSessionCheckpoint,
  encodeAgentCheckpoint,
  encodeSessionCheckpoint,
} from './checkpoint-codec';

function message(overrides: Partial<TUniversalMessage> = {}): TUniversalMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'hello',
    state: 'complete',
    timestamp: new Date('2024-03-01T12:00:00.000Z'),
    ...overrides,
  } as TUniversalMessage;
}

describe('session checkpoint codec (robota-session/1)', () => {
  it('round-trips a settled checkpoint, including message Date timestamps', () => {
    const checkpoint = encodeSessionCheckpoint({
      sessionId: 'sess-1',
      cwd: '/work',
      firstTurnDone: true,
      history: [message()],
      pending: null,
    });
    expect(checkpoint.version).toBe(ROBOTA_SESSION_CHECKPOINT_VERSION);
    const decoded = decodeSessionCheckpoint(checkpoint);
    expect(decoded.history?.[0].timestamp).toBeInstanceOf(Date);
    expect(decoded).toEqual({
      sessionId: 'sess-1',
      cwd: '/work',
      firstTurnDone: true,
      history: [message()],
      pending: null,
    });
  });

  it('round-trips a parked wait: no history, a pending executionId and request ids', () => {
    const checkpoint = encodeSessionCheckpoint({
      sessionId: 'sess-2',
      cwd: '/work',
      firstTurnDone: false,
      history: null,
      pending: { executionId: 'exec-1', requestIds: ['req-1'] },
    });
    expect(decodeSessionCheckpoint(checkpoint)).toEqual({
      sessionId: 'sess-2',
      cwd: '/work',
      firstTurnDone: false,
      history: null,
      pending: { executionId: 'exec-1', requestIds: ['req-1'] },
    });
  });

  it('rejects an unsupported version', () => {
    expect(() => decodeSessionCheckpoint({ version: 'robota-session/2', data: {} })).toThrowError(
      RobotaParticipantError,
    );
    try {
      decodeSessionCheckpoint({ version: 'robota-session/2', data: {} });
    } catch (error) {
      expect((error as RobotaParticipantError).code).toBe('checkpoint-invalid');
    }
  });

  it.each([
    { sessionId: 1, cwd: '/work', firstTurnDone: false, history: null, pending: null },
    { sessionId: 's', cwd: '/work', firstTurnDone: 'no', history: null, pending: null },
    { sessionId: 's', cwd: '/work', firstTurnDone: false, history: 'nope', pending: null },
    {
      sessionId: 's',
      cwd: '/work',
      firstTurnDone: false,
      history: null,
      pending: { executionId: 1 },
    },
  ])('rejects malformed checkpoint data %#', (data) => {
    expect(() =>
      decodeSessionCheckpoint({ version: ROBOTA_SESSION_CHECKPOINT_VERSION, data }),
    ).toThrowError(RobotaParticipantError);
  });

  // Optional: `{ "$date": "..." }` is also a value a tool's saved arguments could genuinely
  // contain — the codec's own Date marker must not swallow it. Cast past `TUniversalMessageMetadata`
  // deliberately: this shape (a nested arbitrary object) is exactly what a real tool call's
  // recorded arguments can carry, even though metadata's own declared type is narrower.
  it('round-trips a plain object holding a $date key without mistaking it for an encoded Date', () => {
    const withCollision = {
      id: 'm1',
      role: 'assistant',
      content: 'hello',
      state: 'complete',
      timestamp: new Date('2024-03-01T12:00:00.000Z'),
      metadata: { toolArguments: { $date: 'not-a-real-date' } },
    } as unknown as TUniversalMessage;
    const checkpoint = encodeAgentCheckpoint([withCollision]);
    expect(decodeAgentCheckpoint(checkpoint)).toEqual([withCollision]);
  });

  it('round-trips a plain object that collides with the $escaped envelope itself', () => {
    const withCollision = {
      id: 'm1',
      role: 'assistant',
      content: 'hello',
      state: 'complete',
      timestamp: new Date('2024-03-01T12:00:00.000Z'),
      metadata: { toolArguments: { $escaped: 'literal, not an envelope' } },
    } as unknown as TUniversalMessage;
    const checkpoint = encodeAgentCheckpoint([withCollision]);
    expect(decodeAgentCheckpoint(checkpoint)).toEqual([withCollision]);
  });

  it('round-trips a real Date nested beside a $date-shaped collision in the same message', () => {
    const withBoth = {
      id: 'm1',
      role: 'assistant',
      content: 'hello',
      state: 'complete',
      timestamp: new Date('2024-03-01T12:00:00.000Z'),
      metadata: {
        toolArguments: { $date: 'not-a-real-date' },
        real: new Date('2024-01-01T00:00:00.000Z'),
      },
    } as unknown as TUniversalMessage;
    const checkpoint = encodeAgentCheckpoint([withBoth]);
    const decoded = decodeAgentCheckpoint(checkpoint);
    expect(decoded).toEqual([withBoth]);
    expect(
      ((decoded[0] as unknown as { metadata: { real: unknown } }).metadata.real as Date) instanceof
        Date,
    ).toBe(true);
  });

  it('never carries a provider credential field a live provider object might have held', () => {
    const checkpoint = encodeSessionCheckpoint({
      sessionId: 'sess-3',
      cwd: '/work',
      firstTurnDone: true,
      history: [message({ metadata: { note: 'plain assistant reply' } })],
      pending: null,
    });
    expect(JSON.stringify(checkpoint)).not.toMatch(/apiKey|api_key|secret|token/i);
  });
});

describe('agent checkpoint codec (robota-agent/1)', () => {
  it('round-trips a history array, including Date timestamps', () => {
    const checkpoint = encodeAgentCheckpoint([message(), message({ id: 'm2', role: 'user' })]);
    expect(checkpoint.version).toBe(ROBOTA_AGENT_CHECKPOINT_VERSION);
    const decoded = decodeAgentCheckpoint(checkpoint);
    expect(decoded).toEqual([message(), message({ id: 'm2', role: 'user' })]);
    expect(decoded[0].timestamp).toBeInstanceOf(Date);
  });

  it('rejects an unsupported version', () => {
    expect(() => decodeAgentCheckpoint({ version: 'robota-agent/2', data: [] })).toThrowError(
      RobotaParticipantError,
    );
  });

  it('rejects malformed data', () => {
    expect(() =>
      decodeAgentCheckpoint({
        version: ROBOTA_AGENT_CHECKPOINT_VERSION,
        data: { not: 'an array' },
      }),
    ).toThrowError(RobotaParticipantError);
  });
});
