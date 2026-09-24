import { describe, expect, it } from 'vitest';

import { sealHandoffRecord, verifyHandoffPayload } from '../node/handoff-manifest.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

function aRecord(over: Partial<IInteractiveSessionRecord> = {}): IInteractiveSessionRecord {
  return {
    id: 'session_1',
    cwd: '/home/alice/project',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
    messages: [],
    ...over,
  };
}

describe('HANDOFF-001 TC-06 — a payload that did not arrive whole is refused', () => {
  it('accepts the exact bytes that were sealed', () => {
    const { serialized, integrity } = sealHandoffRecord(aRecord());

    expect(verifyHandoffPayload(serialized, integrity).intact).toBe(true);
  });

  it('reports a truncated payload as truncated, not as corruption', () => {
    // Checked BEFORE the digest. Hashing a short buffer to discover it was short wastes the work
    // and reports a dropped connection as tampering.
    const { serialized, integrity } = sealHandoffRecord(aRecord());

    const verdict = verifyHandoffPayload(serialized.slice(0, -20), integrity);

    expect(verdict.failure).toBe('truncated');
    expect(verdict.expectedBytes).toBe(integrity.byteLength);
    expect(verdict.actualBytes).toBeLessThan(integrity.byteLength);
  });

  it('reports a same-length substitution as a digest mismatch', () => {
    // The case length alone cannot catch, which is why the digest is there at all.
    const { serialized, integrity } = sealHandoffRecord(aRecord());
    const tampered = serialized.replace('/home/alice/project', '/home/mallor/projec');

    expect(tampered).toHaveLength(serialized.length);
    expect(verifyHandoffPayload(tampered, integrity).failure).toBe('digest-mismatch');
  });

  it('two different records do not seal to the same digest', () => {
    const a = sealHandoffRecord(aRecord());
    const b = sealHandoffRecord(aRecord({ cwd: '/elsewhere' }));

    expect(a.integrity.digest).not.toBe(b.integrity.digest);
  });
});
