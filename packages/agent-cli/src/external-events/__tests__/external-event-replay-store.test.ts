import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createExternalEventReplayStore } from '../external-event-replay-store.js';

import type { IExternalEventGrant } from '@robota-sdk/agent-interface-transport';

const grant: IExternalEventGrant = {
  grantId: 'ci',
  verifier: {
    issuer: 'https://issuer.example',
    resource: 'https://agent.example/events/ci',
    algorithms: ['ES256'],
    requiredScopes: ['agent.events.submit'],
    allowedClients: ['ci-bot'],
  },
  kinds: ['message'],
};

describe('external event replay store', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('atomically refuses the same token ID across independently constructed stores', () => {
    const root = mkdtempSync(join(tmpdir(), 'external-replay-'));
    roots.push(root);
    const input = { grant, jti: 'SECRET-JTI', expiresAt: 2_000, at: 1_000 };

    expect(createExternalEventReplayStore(root).claim(input)).toBe('claimed');
    expect(createExternalEventReplayStore(root).claim(input)).toBe('spent');

    const files = readdirSync(join(root, 'external-event-replay'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.claim$/u);
    expect(files[0]).not.toContain(input.jti);
    expect(readFileSync(join(root, 'external-event-replay', files[0]), 'utf8')).toBe('2000\n');
  });

  it('removes an expired opaque claim before reusing its token ID', () => {
    const root = mkdtempSync(join(tmpdir(), 'external-replay-expired-'));
    roots.push(root);
    const input = { grant, jti: 'reissued', expiresAt: 2_000, at: 1_000 };
    const first = createExternalEventReplayStore(root);
    expect(first.claim(input)).toBe('claimed');

    const second = createExternalEventReplayStore(root);
    expect(second.claim({ ...input, expiresAt: 3_000, at: 2_001 })).toBe('claimed');
  });

  it('cannot delete and duplicate a newer issuance while reclaiming an expired claim', () => {
    const root = mkdtempSync(join(tmpdir(), 'external-replay-aba-'));
    roots.push(root);
    const original = { grant, jti: 'reissued', expiresAt: 2_000, at: 1_000 };
    expect(createExternalEventReplayStore(root).claim(original)).toBe('claimed');

    const newer = { ...original, expiresAt: 3_000, at: 2_001 };
    let concurrent: 'claimed' | 'spent' | 'saturated' | 'unavailable' | undefined;
    let observed = false;
    const racing = createExternalEventReplayStore(root, {
      afterExpiredClaimObserved: () => {
        if (observed) return;
        observed = true;
        concurrent = createExternalEventReplayStore(root).claim(newer);
      },
    });

    expect(racing.claim(newer)).toBe('spent');
    expect(concurrent).toBe('claimed');
    expect(readdirSync(join(root, 'external-event-replay'))).toHaveLength(1);
  });

  it('rejects an expiry that cannot be represented durably', () => {
    const root = mkdtempSync(join(tmpdir(), 'external-replay-expiry-'));
    roots.push(root);
    const store = createExternalEventReplayStore(root);

    expect(
      store.claim({ grant, jti: 'unsafe-expiry', expiresAt: Number.MAX_VALUE, at: 1_000 }),
    ).toBe('unavailable');
    expect(readdirSync(join(root, 'external-event-replay'))).toEqual([]);
  });
});
