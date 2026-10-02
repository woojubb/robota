import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OrganizationLedger, OrganizationAuditAppendConflict, organizationSigningBytes,
  organizationAuditGenesis, organizationAuditHash, organizationAuditSigningBytes,
} from '@robota-sdk/agent-organization';
import type {
  IOrganizationGrant, IOrganizationRequest, IOrganizationLedgerAnchor, IOrganizationAuditHead,
  IOrganizationAuditEntry, IOrganizationEnvelope, IOrganizationAuditSink, IOrganizationAuditAnchor,
  TOrganizationSigningDomain,
} from '@robota-sdk/agent-organization';

function keys() {
  const pair = generateKeyPairSync('ed25519');
  return { publicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(), privateKey: pair.privateKey };
}
export function signed<T>(domain: TOrganizationSigningDomain, claims: T, key: KeyObject): IOrganizationEnvelope<T> {
  return { claims, signature: sign(null, organizationSigningBytes(domain, claims), key).toString('base64url') };
}
export function organizationOwnerFixture(anchor: IOrganizationLedgerAnchor, options: {
  audience?: string; grantId?: string; tenant?: string; task?: string; actor?: string; epoch?: number; modelResource?: string;
} = {}) {
  const issuer = keys(); const approver = keys(); const worker = keys();
  const directory = mkdtempSync(join(tmpdir(), 'organization-owner-'));
  const audience = options.audience ?? 'http://127.0.0.1:43121';
  const ledger = new OrganizationLedger({ path: join(directory, 'policy.sqlite'), audience, workloadPublicKey: issuer.publicKey, approvalPublicKey: approver.publicKey, anchor, create: true });
  const budget = { tokens: 100, timeMs: 200_000, costMicros: 100, concurrency: 8 };
  const tenant = options.tenant ?? 'company'; const task = options.task ?? 'task';
  if ((options.epoch ?? 1) > 1) ledger.advanceEpoch(options.epoch!);
  ledger.createGlobalBudget(budget); ledger.createTenant(tenant, budget); ledger.createTask(tenant, task, budget);
  const now = Date.now();
  const grant: IOrganizationGrant = { version: 1, id: options.grantId ?? 'root', tenant, task, actor: options.actor ?? 'actor', role: 'operator', audience, parent: null, epoch: options.epoch ?? 1, notBefore: now - 1000, expiresAt: now + 200_000, publicKey: worker.publicKey, scopes: [{ resource: options.modelResource ?? 'asset', operations: [options.modelResource === undefined ? 'read' : 'generate'] }], budget };
  ledger.registerGrant(signed('workload', grant, issuer.privateKey));
  return {
    ledger, grant, issuer, worker,
    request(overrides: Partial<IOrganizationRequest> = {}): IOrganizationRequest {
      return { version: 1, grantId: grant.id, tenant: grant.tenant, task: grant.task, actor: grant.actor, audience, epoch: grant.epoch, nonce: randomUUID(), notBefore: Date.now() - 100, expiresAt: Date.now() + 20_000,
        operation: { idempotencyKey: randomUUID(), resource: 'asset', operation: 'read', environment: 'test', parameters: 'payload' }, ...overrides };
    },
    call(request: IOrganizationRequest) { return { request: signed('request', request, worker.privateKey), approval: null }; },
    cleanup() { ledger.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

export function organizationOwnerAuditFixture() {
  const signer = keys(); const stream = 'company-audit';
  const signedHead = (claims: IOrganizationAuditHead) => ({ claims, signature: sign(null, organizationAuditSigningBytes(claims), signer.privateKey).toString('base64url') });
  const entries: IOrganizationAuditEntry[] = [];
  let stored = signedHead(organizationAuditGenesis(stream));
  let anchored = stored;
  const equal = (a: IOrganizationAuditHead, b: IOrganizationAuditHead) => a.sequence === b.sequence && a.hash === b.hash && a.stream === b.stream;
  const sink: IOrganizationAuditSink = {
    read: async (after) => ({ entries: entries.filter((entry) => entry.sequence > after.sequence), head: stored }),
    append: async (expected, event) => {
      if (!equal(expected, stored.claims)) throw new OrganizationAuditAppendConflict();
      const sequence = expected.sequence + 1;
      const entry = { stream, sequence, previous: expected.hash, event, hash: organizationAuditHash(stream, sequence, expected.hash, event) };
      entries.push(entry); stored = signedHead({ version: 1, stream, sequence, hash: entry.hash });
      return { entry, head: stored };
    },
  };
  const anchor: IOrganizationAuditAnchor = {
    load: async () => anchored,
    compareAndSet: async (expected, next) => { if (!equal(expected, anchored.claims)) return false; anchored = next; return true; },
  };
  return { signer, stream, entries, sink, anchor };
}
