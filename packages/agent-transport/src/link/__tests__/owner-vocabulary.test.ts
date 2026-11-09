/**
 * The owner vocabulary's decoders are strict on both ends: each message has exactly its fields,
 * each field its type and bounds, and anything else is not a message at all. An encoded message
 * decodes back to what was encoded.
 */
import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  decodeOwnerRequest,
  decodeRuntimeMessage,
  encodeOwnerRequest,
  encodeRuntimeMessage,
} from '../owner-vocabulary.js';

const utf8 = (value: unknown): Uint8Array => Buffer.from(JSON.stringify(value), 'utf8');
const b64 = (length: number, fill = 7): string => Buffer.alloc(length, fill).toString('base64url');

const REQUESTS = [
  { op: 'install-trust-root', requestId: 'r1', attachPublicKey: b64(32), certificate: b64(64) },
  { op: 'lock', requestId: 'r2', reason: 'screen-lock' },
  { op: 'question', requestId: 'r3', sessionId: 'sess_01-a.b:c' },
  { op: 'open-accepted', requestId: 'r4', bindingId: 'attach:1', sessionId: 's', acceptedDigest: 'ab'.repeat(32), questionId: 'q1' },
  { op: 'control', requestId: 'r5', command: 'rename', fields: { name: 'My session' } },
  { op: 'control', requestId: 'r6', command: 'events-list', fields: {} },
] as const;

const RUNTIME_MESSAGES = [
  { op: 'done', requestId: 'r1' },
  { op: 'unlocked', requestId: 'g1', sealingKey: 'mismatch' },
  { op: 'question', requestId: 'r3', question: { kind: 'open' } },
  {
    op: 'question',
    requestId: 'r3',
    question: {
      kind: 'accept',
      digest: 'ab'.repeat(32),
      questionId: 'q1',
      notice: 'Not verified.\nCheck it.',
      question: 'Resume?',
    },
  },
  { op: 'question', requestId: 'r3', question: { kind: 'refused', message: 'No such session.' } },
  {
    op: 'refused',
    requestId: 'r9',
    code: 'not-allowed',
    message: 'A spawner link cannot do this.',
  },
  {
    op: 'control',
    requestId: 'r5',
    result: { status: 'events', grants: [{ id: 'g', count: 2, live: true, note: null }] },
  },
  { op: 'custody', state: { unlocked: true, certified: false } },
] as const;

describe('owner requests', () => {
  it('carries an explicit owner question cancellation without extra fields', () => {
    const wire = { op: 'cancel-question', requestId: 'r1' };
    const decoded = decodeOwnerRequest(utf8(wire));
    expect(decoded).toEqual(wire);
    expect(JSON.parse(Buffer.from(encodeOwnerRequest(decoded!)).toString())).toEqual(wire);
    expect(decodeOwnerRequest(utf8({ ...wire, extra: true }))).toBeUndefined();
  });
  it('binds an acceptance to one attached surface', () => {
    const wire = {
      op: 'open-accepted',
      requestId: 'r4',
      bindingId: 'attach:1',
      sessionId: 'session-1',
      acceptedDigest: 'ab'.repeat(32),
      questionId: 'q1',
    };
    const decoded = decodeOwnerRequest(utf8(wire));
    expect(decoded).toEqual(wire);
    expect(JSON.parse(Buffer.from(encodeOwnerRequest(decoded!)).toString())).toEqual(wire);
    expect(decodeOwnerRequest(utf8({ ...wire, bindingId: '' }))).toBeUndefined();
    expect(decodeOwnerRequest(utf8({ ...wire, bindingId: 'other surface' }))).toBeUndefined();
    expect(decodeOwnerRequest(utf8({ ...wire, questionId: '' }))).toBeUndefined();
    const { questionId: _questionId, ...withoutQuestion } = wire;
    expect(decodeOwnerRequest(utf8(withoutQuestion))).toBeUndefined();
    const { bindingId: _bindingId, ...withoutBinding } = wire;
    expect(decodeOwnerRequest(utf8(withoutBinding))).toBeUndefined();
  });

  it('decode every request the vocabulary has, and encode back to the same bytes', () => {
    for (const wire of REQUESTS) {
      const decoded = decodeOwnerRequest(utf8(wire));
      expect(decoded).toBeDefined();
      expect(JSON.parse(Buffer.from(encodeOwnerRequest(decoded!)).toString())).toEqual(wire);
    }
    const root = decodeOwnerRequest(utf8(REQUESTS[0]));
    expect(root?.op === 'install-trust-root' && root.root.certificate).toHaveLength(64);
  });

  it('refuse anything that is not exactly one of them', () => {
    const refused: unknown[] = [
      null,
      [],
      'lock',
      { op: 'unlock', requestId: 'r1' },
      { op: 'lock', requestId: 'r1', reason: 'idle' },
      { op: 'lock', requestId: 'r1', reason: 'explicit', extra: 1 },
      { op: 'lock', requestId: 'g1', reason: 'explicit' },
      { op: 'lock', requestId: 'r0', reason: 'explicit' },
      { op: 'lock', requestId: `r${'1'.repeat(17)}`, reason: 'explicit' },
      { op: 'lock', reason: 'explicit' },
      { ...REQUESTS[0], attachPublicKey: b64(31) },
      { ...REQUESTS[0], certificate: b64(64) + 'A' },
      { ...REQUESTS[0], certificate: `${b64(64).slice(0, -1)}=` },
      { ...REQUESTS[0], attachPublicKey: 'A'.repeat(42) + 'B' },
      { ...REQUESTS[2], sessionId: '' },
      { ...REQUESTS[2], sessionId: 'a b' },
      { ...REQUESTS[2], sessionId: 's'.repeat(257) },
      { ...REQUESTS[3], acceptedDigest: 'ab\n' },
      { ...REQUESTS[4], command: 'Rename' },
      { ...REQUESTS[4], fields: { name: 7 } },
      { ...REQUESTS[4], fields: { 'bad key': 'x' } },
      { ...REQUESTS[4], fields: { name: 'x\u0007' } },
      {
        ...REQUESTS[4],
        fields: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, 'v'])),
      },
      { ...REQUESTS[4], fields: ['name'] },
    ];
    for (const value of refused) expect(decodeOwnerRequest(utf8(value))).toBeUndefined();
    expect(decodeOwnerRequest(Buffer.from('{"op":"lock",'))).toBeUndefined();
    expect(decodeOwnerRequest(Buffer.from([0xff, 0xfe]))).toBeUndefined();
  });
});

describe('runtime replies and notices', () => {
  it('decode every reply and notice, and encode back to the same bytes', () => {
    for (const wire of RUNTIME_MESSAGES) {
      const decoded = decodeRuntimeMessage(utf8(wire));
      expect(decoded).toBeDefined();
      expect(JSON.parse(Buffer.from(encodeRuntimeMessage(decoded!)).toString())).toEqual(wire);
    }
  });

  it('refuse anything that is not exactly one of them', () => {
    const refused: unknown[] = [
      { op: 'done', requestId: 'r1', extra: true },
      { op: 'unlocked', requestId: 'r1', sealingKey: 'verified' },
      { op: 'unlocked', requestId: 'g1', sealingKey: 'repaired' },
      { op: 'question', requestId: 'r3', question: { kind: 'accept', digest: 'd', notice: 'n' } },
      { op: 'question', requestId: 'r3', question: { kind: 'open', extra: 1 } },
      { op: 'question', requestId: 'r3', question: { kind: 'refused', message: 'x\u001b[2J' } },
      { op: 'question', requestId: 'r3', question: { kind: 'refused', message: 'x\u202e' } },
      { op: 'question', requestId: 'r3', question: { kind: 'refused', message: 'm'.repeat(4097) } },
      { op: 'refused', requestId: 'r9', code: 'Not Allowed', message: 'x' },
      { op: 'refused', requestId: 'r9', code: 'x', message: '' },
      { op: 'control', requestId: 'r5', result: [] },
      {
        op: 'control',
        requestId: 'r5',
        result: { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } },
      },
      { op: 'control', requestId: 'r5', result: JSON.parse('{"__proto__":{"polluted":true}}') },
      { op: 'custody', state: { unlocked: 'yes', certified: false } },
      { op: 'custody', state: { unlocked: true } },
      { op: 'custody', requestId: 'r1', state: { unlocked: true, certified: true } },
    ];
    for (const value of refused) expect(decodeRuntimeMessage(utf8(value))).toBeUndefined();
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
