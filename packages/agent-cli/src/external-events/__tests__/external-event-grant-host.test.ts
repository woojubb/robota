import { describe, expect, it, vi } from 'vitest';

import { openExternalEventGrants } from '../external-event-grant-host.js';

import type {
  IExternalEventSource,
  IExternalEventSourceOptions,
  TExternalEventReceipt,
} from '@robota-sdk/agent-framework';
import type {
  IExternalEventGrant,
  TExternalEventAuditRecord,
} from '@robota-sdk/agent-interface-transport';

function grant(grantId: string, principal: 'subject' | 'client' = 'client'): IExternalEventGrant {
  return {
    grantId,
    verifier: {
      issuer: 'https://issuer.example',
      resource: `https://robota.example/events/${grantId}`,
      algorithms: ['ES256'],
      requiredScopes: ['robota.events.submit'],
      ...(principal === 'client'
        ? { allowedClients: ['PRINCIPAL-VALUE'] }
        : { allowedSubjects: ['PRINCIPAL-VALUE'] }),
    },
    kinds: ['message'],
  };
}

function fakeSession(receipts: TExternalEventReceipt[] = []) {
  const opened: IExternalEventSourceOptions[] = [];
  const sources = new Map<string, IExternalEventSource & { closed: boolean; revoked: boolean }>();
  return {
    opened,
    sources,
    openExternalEventSource: vi.fn(async (options: IExternalEventSourceOptions) => {
      if (options.grant.grantId === 'refused') throw new Error('bypassPermissions');
      opened.push(options);
      const source = {
        grantId: options.grant.grantId,
        closed: false,
        revoked: false,
        receive: vi.fn(async () => {
          const receipt = receipts.shift() ?? {
            admitted: false as const,
            refusal: 'expired' as const,
          };
          if (!receipt.admitted)
            options.audit?.({
              at: 'now',
              grantId: options.grant.grantId,
              refusal: receipt.refusal,
            });
          return receipt;
        }),
        close: () => {
          source.closed = true;
        },
        revoke: () => {
          source.revoked = true;
          source.closed = true;
        },
      };
      sources.set(options.grant.grantId, source);
      return source;
    }),
  };
}

describe('external event grant host', () => {
  it('opens every grant with a verifier built from that grant, and nothing else', async () => {
    const session = fakeSession();
    const createVerifier = vi.fn(() => ({ verify: async () => ({ admitted: true as const }) }));
    const host = await openExternalEventGrants(session, [grant('ci'), grant('chat', 'subject')], {
      createVerifier,
    });
    expect(session.opened.map((options) => options.grant.grantId)).toEqual(['ci', 'chat']);
    expect(session.opened.every((options) => !('verifier' in options))).toBe(true);
    const ci = grant('ci');
    session.opened[0]!.createVerifier(ci.verifier);
    expect(createVerifier).toHaveBeenCalledWith(ci.verifier);
    expect(
      host.list().map(({ grantId, principal, state }) => ({ grantId, principal, state })),
    ).toEqual([
      { grantId: 'ci', principal: 'client', state: 'open' },
      { grantId: 'chat', principal: 'subject', state: 'open' },
    ]);
  });

  it('fails the whole start when the session refuses one grant, closing the ones it opened', async () => {
    const session = fakeSession();
    await expect(openExternalEventGrants(session, [grant('ci'), grant('refused')])).rejects.toThrow(
      /^grant refused: refused by the session$/,
    );
    expect(session.sources.get('ci')?.closed).toBe(true);
  });

  it('refuses an event for a grant it does not hold as unknown-grant, audited without a label', async () => {
    const session = fakeSession();
    const audit: TExternalEventAuditRecord[] = [];
    const host = await openExternalEventGrants(session, [grant('ci')], {
      audit: (record) => audit.push(record),
    });
    expect(await host.receive('nope', { token: 't', event: {} })).toEqual({
      admitted: false,
      refusal: 'unknown-grant',
    });
    expect(audit).toEqual([{ at: expect.any(String), refusal: 'unknown-grant' }]);
    expect(session.sources.get('ci')!.receive).not.toHaveBeenCalled();
  });

  it('counts admissions, refusals and settlements per grant, with no principal or content', async () => {
    let settle: (value: { outcome: 'completed'; response: string }) => void = () => {};
    const settled = new Promise<{ outcome: 'completed'; response: string }>((resolve) => {
      settle = resolve;
    });
    const session = fakeSession([
      { admitted: true, turnId: 'turn_1', settled },
      { admitted: false, refusal: 'expired' },
    ]);
    const host = await openExternalEventGrants(session, [grant('ci')]);
    expect(await host.receive('ci', { token: 't', event: {} })).toEqual({
      admitted: true,
      turnId: 'turn_1',
    });
    await host.receive('ci', { token: 't', event: {} });
    session.opened[0]!.audit?.({ at: 'now', grantId: 'ci', settlement: 'completed' });
    settle({ outcome: 'completed', response: 'MODEL-OUTPUT' });
    expect(host.list()).toEqual([
      {
        grantId: 'ci',
        principal: 'client',
        state: 'open',
        counters: { accepted: 1, refused: { expired: 1 }, settled: { completed: 1 } },
      },
    ]);
    expect(JSON.stringify(host.list())).not.toMatch(/PRINCIPAL-VALUE|MODEL-OUTPUT|issuer/);
  });

  it('revokes one grant by label and leaves the others open', async () => {
    const session = fakeSession();
    const host = await openExternalEventGrants(session, [grant('ci'), grant('chat')]);
    expect(host.revoke('ci')).toBe('revoked');
    expect(host.revoke('nope')).toBe('unknown-grant');
    expect(session.sources.get('ci')?.revoked).toBe(true);
    expect(session.sources.get('chat')?.revoked).toBe(false);
    expect(host.list().map(({ grantId, state }) => [grantId, state])).toEqual([
      ['ci', 'revoked'],
      ['chat', 'open'],
    ]);
    host.close();
    expect(session.sources.get('chat')?.closed).toBe(true);
  });
});
