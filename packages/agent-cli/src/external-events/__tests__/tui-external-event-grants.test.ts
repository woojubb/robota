import { describe, expect, it, vi } from 'vitest';

import {
  createRefusalReporter,
  createTuiExternalEventGrants,
  describeExternalEventRecord,
} from '../tui-external-event-grants.js';

import { createExternalEventGrantHistory, ExternalEventIngress } from '@robota-sdk/agent-framework';

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
    // Reopened revoked on the new session, so that session can still verify a caller first.
    expect(next.opened.map((options) => options.grant.grantId)).toEqual(['ci', 'chat']);
    expect(next.closed).toEqual(['ci']);
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

  it('reports how turns end, leaving refusals to the carrier that answered them', async () => {
    const lines: string[] = [];
    const tui = createTuiExternalEventGrants([grant('ci')], (line) => lines.push(line));
    const session = fakeSession();
    await tui.bind(session);
    const audit = session.opened[0]!.audit!;
    audit({ at: 'now', grantId: 'ci', refusal: 'expired' });
    audit({ at: 'now', grantId: 'ci', settlement: 'completed' });
    audit({ at: 'now', grantId: 'ci', settlement: 'not-run' });
    expect(lines).toEqual(['External event grant ci: a turn ended not-run.']);
    expect(
      describeExternalEventRecord({
        at: 'now',
        refusal: 'unknown-grant',
        remote: 'public',
        throttled: false,
      }),
    ).toBe('External event: an event was refused (unknown-grant).');
  });

  it('reports refusals at most once per grant and reason a minute, and never a throttled peer', () => {
    const lines: string[] = [];
    let clock = 0;
    const reportRecord = createRefusalReporter(
      (line) => lines.push(line),
      () => clock,
    );
    const refusal = (refusal: 'missing-token' | 'expired', throttled = false) => ({
      at: 'now',
      grantId: 'ci',
      refusal,
      remote: 'public' as const,
      throttled,
    });
    for (let index = 0; index < 100; index += 1) reportRecord(refusal('missing-token'));
    reportRecord(refusal('expired'));
    for (let index = 0; index < 50; index += 1) reportRecord(refusal('expired', true));
    expect(lines).toEqual([
      'External event grant ci: an event was refused (missing-token).',
      'External event grant ci: an event was refused (expired).',
    ]);
    clock = 60_000;
    reportRecord(refusal('missing-token'));
    reportRecord(refusal('expired', true));
    expect(lines.slice(2)).toEqual([
      'External event grant ci: an event was refused (missing-token). 99 more were refused since the last report.',
    ]);
    reportRecord({ at: 'now', grantId: 'ci', settlement: 'failed' });
    expect(lines.at(-1)).toBe('External event grant ci: a turn ended failed.');
  });

  it('routes a delivery to the bound session, where only a verified caller learns of a revocation', async () => {
    const tui = createTuiExternalEventGrants([grant('ci'), grant('chat')], () => undefined);
    expect(await tui.receive('ci', { token: 't', event: {} })).toEqual({
      admitted: false,
      refusal: 'session-unavailable',
    });
    const session = fakeSession();
    await tui.bind(session);
    expect(await tui.receive('ci', { token: 't', event: {} })).toEqual({
      admitted: false,
      refusal: 'expired',
    });
    tui.adapter.revoke('ci');
    // A session whose grants verify first and answer revoked only to a valid token.
    const revokedIds = new Set<string>();
    const verifying = {
      // Like the real ingress: a label revoked on this session cannot be opened on it again.
      openExternalEventSource: async (options: IExternalEventSourceOptions) => {
        if (revokedIds.has(options.grant.grantId)) {
          throw new Error(`external event grant ${options.grant.grantId} was revoked`);
        }
        return {
          grantId: options.grant.grantId,
          receive: async (delivery: unknown) => {
            const token = (delivery as { token?: string }).token;
            if (token !== 'valid')
              return { admitted: false as const, refusal: 'bad-signature' as const };
            return revokedIds.has(options.grant.grantId)
              ? { admitted: false as const, refusal: 'grant-revoked' as const }
              : {
                  admitted: true as const,
                  turnId: 'turn_1',
                  settled: Promise.resolve({ outcome: 'completed' as const, response: '' }),
                };
          },
          close: () => undefined,
          revoke: () => revokedIds.add(options.grant.grantId),
        };
      },
    };
    await tui.bind(verifying);
    expect(await tui.receive('ci', { token: 'forged', event: {} })).toEqual({
      admitted: false,
      refusal: 'bad-signature',
    });
    expect(await tui.receive('chat', { token: 'forged', event: {} })).toEqual({
      admitted: false,
      refusal: 'bad-signature',
    });
    expect(await tui.receive('ci', { token: 'valid', event: {} })).toEqual({
      admitted: false,
      refusal: 'grant-revoked',
    });
    // Binding the same session again keeps its grants rather than reopening them.
    await tui.bind(verifying);
    expect(await tui.receive('ci', { token: 'valid', event: {} })).toEqual({
      admitted: false,
      refusal: 'grant-revoked',
    });
  });
});

describe('grants across a switch on a run-level history (#3189)', () => {
  it('a revoke survives the switch without taking the other grants or the switch down', async () => {
    const history = createExternalEventGrantHistory();
    const submit = vi.fn(async () => ({
      turnId: 'turn_1',
      completed: new Promise<never>(() => undefined),
    }));
    // Each session owns its ingress; the run lends them all the same history.
    const session = () => {
      const ingress = new ExternalEventIngress({
        getPermissionMode: () => 'default',
        addPermissionModeGuard: () => () => undefined,
        submit,
        createVerifier: () => ({
          verify: async (token: string) =>
            token === 'valid'
              ? { admitted: true as const }
              : { admitted: false as const, refusal: 'bad-signature' as const },
        }),
        history,
      });
      return { openExternalEventSource: async (o: IExternalEventSourceOptions) => ingress.open(o) };
    };
    const tui = createTuiExternalEventGrants([grant('ci'), grant('chat')], () => undefined);
    await tui.bind(session());
    tui.adapter.revoke('ci');
    await tui.bind(session());
    expect(await tui.receive('ci', { token: 'forged', event: {} })).toEqual({
      admitted: false,
      refusal: 'bad-signature',
    });
    expect(await tui.receive('ci', { token: 'valid', event: {} })).toEqual({
      admitted: false,
      refusal: 'grant-revoked',
    });
    expect(tui.adapter.list().map((row) => [row.grantId, row.state])).toEqual([
      ['ci', 'revoked'],
      ['chat', 'open'],
    ]);
    // A third session: the switch after a revoke keeps working.
    await tui.bind(session());
    expect(tui.adapter.list().find((row) => row.grantId === 'chat')?.state).toBe('open');
  });

  it('a bind that fails after a revoke leaves every grant where it was', async () => {
    const submit = vi.fn(async () => ({
      turnId: 'turn_1',
      completed: new Promise<never>(() => undefined),
    }));
    const ingress = new ExternalEventIngress({
      getPermissionMode: () => 'default',
      addPermissionModeGuard: () => () => undefined,
      submit,
      createVerifier: () => ({ verify: async () => ({ admitted: true as const }) }),
      history: createExternalEventGrantHistory(),
    });
    const current = {
      openExternalEventSource: async (o: IExternalEventSourceOptions) => ingress.open(o),
    };
    const tui = createTuiExternalEventGrants([grant('ci'), grant('chat')], () => undefined);
    await tui.bind(current);
    tui.adapter.revoke('ci');
    await expect(tui.bind(fakeSession(true))).rejects.toThrow();
    expect(await tui.receive('ci', { token: 't', event: {} })).toEqual({
      admitted: false,
      refusal: 'grant-revoked',
    });
    // A token the ingress can spend: a compact JWS naming its own id and expiry.
    const part = (value: unknown): string =>
      Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const spendable = `${part({ alg: 'ES256' })}.${part({ jti: 'j1', exp: Date.now() / 1000 + 300 })}.c2ln`;
    expect(
      await tui.receive('chat', {
        token: spendable,
        event: { kind: 'message', conversationId: 'room', content: 'hi' },
      }),
    ).toMatchObject({ admitted: true });
  });
});
