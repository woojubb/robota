import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { OrganizationAudit, OrganizationFileLedgerAnchor } from '@robota-sdk/agent-organization';
import {
  organizationOwnerAuditFixture,
  organizationOwnerFixture,
} from './organization-owner-fixture.js';
import { HostedOrganizationControl } from '../hosted-organization-control.js';
import { HostedDesktopAuthorization, desktopBindingKey } from '../desktop/authorization.js';
import { HostedDesktopAuthorityStore } from '../desktop/authority-store.js';

async function fixture() {
  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const custody = mkdtempSync(join(tmpdir(), 'desktop-owner-'));
  const f = organizationOwnerFixture(
    new OrganizationFileLedgerAnchor({ directory: custody, ledger: 'company' }),
  );
  const a = organizationOwnerAuditFixture();
  const worker = {
    resource: 'worker',
    grantId: f.grant.id,
    epoch: f.grant.epoch,
    identity: {
      tenant: f.grant.tenant,
      task: f.grant.task,
      rootTask: 'logical-root',
      actor: f.grant.actor,
      runtime: 'runtime',
    },
  };
  const control = new HostedOrganizationControl({
    ledger: f.ledger,
    audit: new OrganizationAudit({
      stream: a.stream,
      publicKey: a.signer.publicKey,
      sink: a.sink,
      anchor: a.anchor,
    }),
    inventory: { list: async () => [worker], terminate: async () => undefined },
    actions: [],
    incidentOwners: {
      detection: 'security',
      containment: 'runtime',
      assessment: 'asset',
      recovery: 'owner',
      report: async () => undefined,
    },
  });
  const binding = {
    id: 'owner-desktop',
    user: 'alice',
    client: 'desktop',
    session: 'session',
    worker,
  };
  const pair = await generateKeyPair('EdDSA', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'owner', alg: 'EdDSA', use: 'sig' };
  let unavailable = false;
  const auth = new HostedDesktopAuthorization({
    publicUrl: 'https://company.example/desktop',
    issuer: 'https://issuer.example',
    control,
    bindings: [binding],
    now: () => nowMs,
    verifierDeps: {
      now: () => nowMs,
      lookup: async () => ['93.184.216.34'],
      fetch: (async (input: string | URL | Request) => {
        if (unavailable) return new Response('', { status: 503 });
        const url = String(input);
        return new Response(
          JSON.stringify(
            url.endsWith('/jwks')
              ? { keys: [jwk] }
              : { issuer: 'https://issuer.example', jwks_uri: 'https://issuer.example/jwks' },
          ),
          { headers: { 'content-type': 'application/json' } },
        );
      }) as typeof fetch,
    },
  });
  const mint = (claims: Record<string, unknown> = {}, operator = false) => {
    return new SignJWT({
      iss: 'https://issuer.example',
      aud: operator
        ? 'https://company.example/desktop/approval'
        : 'https://company.example/desktop',
      sub: binding.user,
      client_id: binding.client,
      iat: nowSeconds,
      exp: nowSeconds + 60,
      jti: randomUUID(),
      scope: operator ? 'desktop:approve' : 'desktop:pair desktop:drive',
      tenant: worker.identity.tenant,
      task: worker.identity.task,
      session: binding.session,
      workload: worker.identity.runtime,
      epoch: worker.epoch,
      ...claims,
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt', kid: 'owner' })
      .sign(pair.privateKey);
  };
  return {
    f,
    binding,
    auth,
    mint,
    nowSeconds,
    outage: () => {
      unavailable = true;
    },
    async close() {
      await control.close();
      f.cleanup();
      rmSync(custody, { recursive: true, force: true });
    },
  };
}

it('requires independently verified issuer identity, narrow TTL, scope and exact owner session/workload binding', async () => {
  const f = await fixture();
  try {
    await expect(f.auth.verify(await f.mint(), f.binding)).resolves.toMatchObject({
      binding: f.binding,
    });
    const now = f.nowSeconds;
    await expect(
      f.auth.verify(await f.mint({ exp: now + 120, nbf: now }), f.binding),
    ).resolves.toMatchObject({ binding: f.binding });
    for (const claims of [
      { iss: 'https://wrong.example' },
      { aud: 'https://wrong.example' },
      { sub: 'mallory' },
      { client_id: 'other-client' },
      { scope: 'desktop:pair' },
      { tenant: 'another-tenant' },
      { task: 'another-task' },
      { session: 'another-session' },
      { workload: 'another-runtime' },
      { epoch: 2 },
      { exp: now - 1 },
      { nbf: now + 1 },
      { exp: now + 121 },
      { jti: '' },
    ]) {
      await expect(f.auth.verify(await f.mint(claims), f.binding)).rejects.toThrow();
    }
    await expect(f.auth.verify(await f.mint(), { ...f.binding, user: 'mallory' })).rejects.toThrow(
      'owner-binding',
    );
    const token = await f.mint();
    const [header, payload, signature] = token.split('.');
    const changed = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
        session: 'another-session',
      }),
    ).toString('base64url');
    await expect(f.auth.verify(`${header}.${changed}.${signature}`, f.binding)).rejects.toThrow(
      'bad-signature',
    );
  } finally {
    await f.close();
  }
});
it('keeps operator approval distinct from drive credentials and fails closed on current authority or issuer outage', async () => {
  const f = await fixture();
  try {
    await expect(f.auth.verify(await f.mint({}, true), f.binding, true)).resolves.toBeDefined();
    await expect(f.auth.verify(await f.mint(), f.binding, true)).rejects.toThrow();
    await f.auth.verify(await f.mint(), f.binding);
    f.outage();
    await expect(f.auth.verify(await f.mint(), f.binding)).rejects.toThrow('keys-unavailable');
  } finally {
    await f.close();
  }
  const revoked = await fixture();
  try {
    revoked.f.ledger.revokeGrant(revoked.f.grant.id);
    await expect(revoked.auth.verify(await revoked.mint(), revoked.binding)).rejects.toThrow();
  } finally {
    await revoked.close();
  }
});
it('durably consumes pairing and connection credentials, replaces reconnect generations and rejects authority-store rollback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-state-'));
  const custody = mkdtempSync(join(tmpdir(), 'desktop-state-anchor-'));
  const anchor = new OrganizationFileLedgerAnchor({ directory: custody, ledger: 'desktop' });
  let now = Date.now();
  try {
    const store = new HostedDesktopAuthorityStore({ directory, anchor, create: true }, () => now);
    const key = desktopBindingKey({
      id: 'owner-desktop',
      user: 'alice',
      client: 'desktop',
      session: 'session',
      worker: {
        resource: 'worker',
        grantId: 'grant',
        epoch: 1,
        identity: {
          tenant: 'tenant',
          task: 'task',
          actor: 'actor',
          rootTask: 'root',
          runtime: 'runtime',
        },
      },
    });
    const access = store.pair(
      key,
      [{ id: 'issuer-pair-id', expiresAt: now + 120_000 }],
      now + 60_000,
      true,
    );
    store.connect(key, access.generation, access.token);
    expect(() => store.connect(key, access.generation, access.token)).toThrow(
      'replayed-connection',
    );
    const snapshot = readFileSync(join(directory, 'desktop-authority.json'));
    const reopened = new HostedDesktopAuthorityStore({ directory, anchor }, () => now);
    expect(() =>
      reopened.pair(key, [{ id: 'issuer-pair-id', expiresAt: now + 120_000 }], now + 60_000, false),
    ).toThrow('replayed-pairing');
    const fresh = reopened.pair(
      key,
      [{ id: 'new-issuer-id', expiresAt: now + 120_000 }],
      now + 60_000,
      false,
    );
    expect(() => store.authorize(key, access.generation, access.token)).toThrow(
      'withdrawn-connection',
    );
    reopened.authorize(key, fresh.generation, fresh.token);
    expect(() => reopened.authorize(key, fresh.generation, fresh.token, true)).toThrow(
      'withdrawn-connection',
    );
    now += 60_001;
    expect(() =>
      reopened.pair(key, [{ id: 'issuer-pair-id', expiresAt: now + 60_000 }], now + 30_000, false),
    ).toThrow('replayed-pairing');
    expect(() => reopened.authorize(key, fresh.generation, fresh.token)).toThrow(
      'withdrawn-connection',
    );
    writeFileSync(join(directory, 'desktop-authority.json'), snapshot, { mode: 0o600 });
    expect(() => new HostedDesktopAuthorityStore({ directory, anchor })).toThrow(
      'store-unavailable',
    );
    expect(() => new HostedDesktopAuthorityStore({ directory, anchor, create: true })).toThrow(
      'store-unavailable',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(custody, { recursive: true, force: true });
  }
});
