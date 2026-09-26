import { describe, expect, it, vi } from 'vitest';

import { createTuiExternalEventGrants } from '../tui-external-event-grants.js';

import type { IExternalEventSourceOptions } from '@robota-sdk/agent-framework';
import type { IExternalEventGrant } from '@robota-sdk/agent-interface-transport';

function grant(grantId: string): IExternalEventGrant {
  return {
    grantId,
    verifier: {
      issuer: 'https://issuer.example',
      resource: `https://robota.example/events/${grantId}`,
      algorithms: ['ES256'],
      requiredScopes: ['robota.events.submit'],
      allowedSubjects: ['PRINCIPAL-VALUE'],
    },
    kinds: ['message'],
  };
}

function fakeSession(refuse = false) {
  const opened: IExternalEventSourceOptions[] = [];
  const closed: string[] = [];
  return {
    opened,
    closed,
    openExternalEventSource: vi.fn(async (options: IExternalEventSourceOptions) => {
      if (refuse) throw new Error('bypassPermissions');
      opened.push(options);
      return {
        grantId: options.grant.grantId,
        receive: async () => ({ admitted: false as const, refusal: 'expired' as const }),
        close: () => closed.push(options.grant.grantId),
        revoke: () => closed.push(options.grant.grantId),
      };
    }),
  };
}

describe('TUI external event grants', () => {
  it('opens the grants on each bound session and closes the previous binding', async () => {
    const tui = createTuiExternalEventGrants([grant('ci'), grant('chat')], () => undefined);
    const first = fakeSession();
    await tui.bind(first);
    expect(first.opened.map((options) => options.grant.grantId)).toEqual(['ci', 'chat']);
    const second = fakeSession();
    await tui.bind(second);
    expect(first.closed).toEqual(['ci', 'chat']);
    expect(second.opened).toHaveLength(2);
    expect(tui.adapter.list().map((row) => [row.grantId, row.principal, row.state])).toEqual([
      ['ci', 'subject', 'open'],
      ['chat', 'subject', 'open'],
    ]);
  });

  it('keeps a revoked grant revoked when the TUI switches sessions', async () => {
    const tui = createTuiExternalEventGrants([grant('ci'), grant('chat')], () => undefined);
    await tui.bind(fakeSession());
    expect(tui.adapter.revoke('ci')).toBe('revoked');
    expect(tui.adapter.revoke('nope')).toBe('unknown-grant');
    const next = fakeSession();
    await tui.bind(next);
    expect(next.opened.map((options) => options.grant.grantId)).toEqual(['chat']);
    expect(tui.adapter.list().map((row) => [row.grantId, row.state])).toEqual([
      ['ci', 'revoked'],
      ['chat', 'open'],
    ]);
  });

  it('applies a revocation that arrives while the grants are opening', async () => {
    const tui = createTuiExternalEventGrants([grant('ci')], () => undefined);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revokedIds: string[] = [];
    let opening = false;
    const session = {
      openExternalEventSource: async (options: IExternalEventSourceOptions) => {
        opening = true;
        await gate;
        return {
          grantId: options.grant.grantId,
          receive: async () => ({ admitted: false as const, refusal: 'expired' as const }),
          close: () => undefined,
          revoke: () => revokedIds.push(options.grant.grantId),
        };
      },
    };
    const binding = tui.bind(session);
    await vi.waitFor(() => expect(opening).toBe(true));
    expect(tui.adapter.revoke('ci')).toBe('revoked');
    release();
    await binding;
    expect(revokedIds).toEqual(['ci']);
    expect(tui.adapter.list().map((row) => [row.grantId, row.state])).toEqual([['ci', 'revoked']]);
  });

  it('fails the bind when the session refuses a grant', async () => {
    const tui = createTuiExternalEventGrants([grant('ci')], () => undefined);
    await expect(tui.bind(fakeSession(true))).rejects.toThrow(/^grant ci: refused by the session$/);
  });

  it('reports refusals and unfinished turns on one content-free line each', async () => {
    const lines: string[] = [];
    const tui = createTuiExternalEventGrants([grant('ci')], (line) => lines.push(line));
    const session = fakeSession();
    await tui.bind(session);
    const audit = session.opened[0]!.audit!;
    audit({ at: 'now', grantId: 'ci', refusal: 'expired' });
    audit({ at: 'now', grantId: 'ci', settlement: 'completed' });
    audit({ at: 'now', grantId: 'ci', settlement: 'not-run' });
    expect(lines).toEqual([
      'External event grant ci: an event was refused (expired).',
      'External event grant ci: a turn ended not-run.',
    ]);
  });
});
