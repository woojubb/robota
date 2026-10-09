import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OrganizationLedger,
  OrganizationBroker,
  organizationSigningBytes,
  organizationOperationDigest,
} from '../index.js';
import type {
  TOrganizationSigningDomain,
  IOrganizationAction,
  IOrganizationApproval,
  IOrganizationBudget,
  IOrganizationCall,
  IOrganizationEnvelope,
  IOrganizationGrant,
  IOrganizationRequest,
  IOrganizationLedgerAnchor,
} from '../index.js';

export function keys(): { publicKey: string; privateKey: KeyObject } {
  const pair = generateKeyPairSync('ed25519');
  return {
    publicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    privateKey: pair.privateKey,
  };
}

export function signed<T>(
  domain: TOrganizationSigningDomain,
  claims: T,
  key: KeyObject,
): IOrganizationEnvelope<T> {
  return {
    claims,
    signature: sign(null, organizationSigningBytes(domain, claims), key).toString('base64url'),
  };
}

export function fixture(
  options: {
    audience?: string;
    budget?: Partial<IOrganizationBudget>;
    constraints?: Partial<
      Record<'global' | 'tenant' | 'task' | 'grant', Partial<IOrganizationBudget>>
    >;
    now?: () => number;
    anchor?: IOrganizationLedgerAnchor;
  } = {},
) {
  const issuer = keys();
  const approver = keys();
  const worker = keys();
  const directory = mkdtempSync(join(tmpdir(), 'organization-policy-'));
  const path = join(directory, 'policy.sqlite');
  const now = options.now ?? Date.now;
  const audience = options.audience ?? 'http://127.0.0.1:43121';
  const ledgerOptions = {
    path,
    audience,
    workloadPublicKey: issuer.publicKey,
    approvalPublicKey: approver.publicKey,
    now,
    ...(options.anchor === undefined ? {} : { anchor: options.anchor }),
  };
  const ledger = new OrganizationLedger({ ...ledgerOptions, create: true });
  const limit = {
    tokens: 100,
    timeMs: 200_000,
    costMicros: 100,
    concurrency: 8,
    ...options.budget,
  };
  ledger.createGlobalBudget({ ...limit, ...options.constraints?.global });
  ledger.createTenant('company', { ...limit, ...options.constraints?.tenant });
  ledger.createTask('company', 'task', { ...limit, ...options.constraints?.task });
  const instant = now();
  const grant: IOrganizationGrant = {
    version: 1,
    id: 'root',
    tenant: 'company',
    task: 'task',
    actor: 'actor',
    role: 'operator',
    audience,
    parent: null,
    epoch: 1,
    notBefore: instant - 1000,
    expiresAt: instant + 200_000,
    publicKey: worker.publicKey,
    scopes: [{ resource: 'asset', operations: ['read', 'deploy'] }],
    budget: { ...limit, ...options.constraints?.grant },
  };
  ledger.registerGrant(signed('workload', grant, issuer.privateKey));
  const brokers: OrganizationBroker[] = [];
  return {
    issuer,
    approver,
    worker,
    directory,
    path,
    audience,
    ledger,
    ledgerOptions,
    grant,
    limit,
    now,
    request(overrides: Partial<IOrganizationRequest> = {}): IOrganizationRequest {
      return {
        version: 1,
        grantId: grant.id,
        tenant: grant.tenant,
        task: grant.task,
        actor: grant.actor,
        audience,
        epoch: grant.epoch,
        nonce: randomUUID(),
        notBefore: now() - 100,
        expiresAt: now() + 20_000,
        operation: {
          idempotencyKey: randomUUID(),
          resource: 'asset',
          operation: 'read',
          environment: 'test',
          parameters: { message: '회사 😀\n\u0000', amount: 1 },
        },
        ...overrides,
      };
    },
    call(
      request: IOrganizationRequest,
      approval: IOrganizationEnvelope<IOrganizationApproval> | null = null,
      key = worker.privateKey,
    ): IOrganizationCall {
      return { request: signed('request', request, key), approval };
    },
    approval(
      request: IOrganizationRequest,
      overrides: Partial<IOrganizationApproval> = {},
    ): IOrganizationEnvelope<IOrganizationApproval> {
      return signed(
        'approval',
        {
          version: 1,
          id: randomUUID(),
          tenant: request.tenant,
          task: request.task,
          actor: request.actor,
          audience,
          epoch: request.epoch,
          environment: request.operation.environment,
          operationDigest: organizationOperationDigest(request),
          notBefore: now() - 100,
          expiresAt: now() + 20_000,
          ...overrides,
        },
        approver.privateKey,
      );
    },
    broker(actions?: readonly IOrganizationAction[], policyIntervalMs = 5): OrganizationBroker {
      const broker = new OrganizationBroker({
        ledger,
        now,
        policyIntervalMs,
        actions: actions ?? [
          {
            resource: 'asset',
            operation: 'read',
            roles: ['operator'],
            requiresApproval: false,
            reserve: () => ({ tokens: 10, timeMs: 1000, costMicros: 10 }),
            execute: async (operation) => ({
              value: operation.parameters,
              usage: { tokens: 2, timeMs: 0, costMicros: 2 },
            }),
          },
        ],
      });
      brokers.push(broker);
      return broker;
    },
    cleanup(): void {
      for (const broker of brokers) broker.close();
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
