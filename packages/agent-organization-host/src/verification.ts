import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
  OrganizationSchemaError,
  organizationBudget,
  organizationUnits,
} from '@robota-sdk/agent-organization';
import { organizationCanonical, organizationSigningBytes } from './canonical.js';
import { OrganizationRefused } from './types.js';
import type {
  IOrganizationApproval,
  IOrganizationBudget,
  IOrganizationEnvelope,
  IOrganizationGrant,
  IOrganizationReceipt,
  IOrganizationRequest,
  IOrganizationUnits,
} from './types.js';
import type { TOrganizationSigningDomain } from './canonical.js';

export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  organizationCanonical(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new OrganizationRefused('invalid-schema');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== keys.length || keys.some((key) => !Object.hasOwn(data, key)))
    throw new OrganizationRefused('invalid-schema');
  return data;
}

export function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    [...value].some((character) => {
      const point = character.codePointAt(0)!;
      return point < 32 || point === 127 || (point >= 0xd800 && point <= 0xdfff);
    })
  )
    throw new OrganizationRefused('invalid-schema');
  return value;
}

export function integer(value: unknown, minimum = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum
  )
    throw new OrganizationRefused('invalid-schema');
  return value;
}

export function units(value: unknown): IOrganizationUnits {
  try {
    return organizationUnits(value);
  } catch (error) {
    if (error instanceof OrganizationSchemaError) throw new OrganizationRefused('invalid-schema');
    throw error;
  }
}

export function receipt(value: unknown): IOrganizationReceipt {
  const data = record(value, ['value', 'usage']);
  return Object.freeze({
    value: immutableJson(
      JSON.parse(organizationCanonical(data.value)),
    ) as IOrganizationReceipt['value'],
    usage: units(data.usage),
  });
}

export function budget(value: unknown): IOrganizationBudget {
  try {
    return organizationBudget(value);
  } catch (error) {
    if (error instanceof OrganizationSchemaError) throw new OrganizationRefused('invalid-schema');
    throw error;
  }
}

export function publicKey(value: unknown): KeyObject {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    !value.startsWith('-----BEGIN PUBLIC KEY-----')
  )
    throw new OrganizationRefused('invalid-schema');
  try {
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong type');
    return key;
  } catch {
    throw new OrganizationRefused('invalid-proof');
  }
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64)
    throw new OrganizationRefused('invalid-schema');
  const output = value.map(identifier);
  if (new Set(output).size !== output.length) throw new OrganizationRefused('invalid-schema');
  return Object.freeze(output);
}

function immutableJson<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutableJson(child);
    Object.freeze(value);
  }
  return value;
}

function validity(data: Record<string, unknown>): void {
  if (data.version !== 1 || integer(data.expiresAt, 1) <= integer(data.notBefore))
    throw new OrganizationRefused('invalid-schema');
  integer(data.epoch, 1);
}

export function grantClaims(value: unknown): IOrganizationGrant {
  const data = record(value, [
    'version',
    'id',
    'tenant',
    'task',
    'actor',
    'role',
    'audience',
    'parent',
    'epoch',
    'notBefore',
    'expiresAt',
    'publicKey',
    'scopes',
    'budget',
  ]);
  validity(data);
  publicKey(data.publicKey);
  if (!Array.isArray(data.scopes) || data.scopes.length < 1 || data.scopes.length > 64)
    throw new OrganizationRefused('invalid-schema');
  const scopes = data.scopes.map((value) => {
    const scope = record(value, ['resource', 'operations']);
    return Object.freeze({
      resource: identifier(scope.resource),
      operations: strings(scope.operations),
    });
  });
  if (new Set(scopes.map((scope) => scope.resource)).size !== scopes.length)
    throw new OrganizationRefused('invalid-schema');
  return Object.freeze({
    version: 1,
    id: identifier(data.id),
    tenant: identifier(data.tenant),
    task: identifier(data.task),
    actor: identifier(data.actor),
    role: identifier(data.role),
    audience: identifier(data.audience),
    parent: data.parent === null ? null : identifier(data.parent),
    epoch: integer(data.epoch, 1),
    notBefore: integer(data.notBefore),
    expiresAt: integer(data.expiresAt, 1),
    publicKey: data.publicKey as string,
    scopes: Object.freeze(scopes),
    budget: budget(data.budget),
  });
}

export function requestClaims(value: unknown): IOrganizationRequest {
  const data = record(value, [
    'version',
    'grantId',
    'tenant',
    'task',
    'actor',
    'audience',
    'epoch',
    'nonce',
    'notBefore',
    'expiresAt',
    'operation',
  ]);
  validity(data);
  const operation = record(data.operation, [
    'idempotencyKey',
    'resource',
    'operation',
    'environment',
    'parameters',
  ]);
  // Snapshot the entire request before it crosses any async owner port.
  return Object.freeze({
    version: 1,
    grantId: identifier(data.grantId),
    tenant: identifier(data.tenant),
    task: identifier(data.task),
    actor: identifier(data.actor),
    audience: identifier(data.audience),
    epoch: integer(data.epoch, 1),
    nonce: identifier(data.nonce),
    notBefore: integer(data.notBefore),
    expiresAt: integer(data.expiresAt, 1),
    operation: Object.freeze({
      idempotencyKey: identifier(operation.idempotencyKey),
      resource: identifier(operation.resource),
      operation: identifier(operation.operation),
      environment: identifier(operation.environment),
      parameters: immutableJson(
        JSON.parse(organizationCanonical(operation.parameters)),
      ) as IOrganizationRequest['operation']['parameters'],
    }),
  });
}

export function approvalClaims(value: unknown): IOrganizationApproval {
  const data = record(value, [
    'version',
    'id',
    'tenant',
    'task',
    'actor',
    'audience',
    'epoch',
    'environment',
    'operationDigest',
    'notBefore',
    'expiresAt',
  ]);
  validity(data);
  if (typeof data.operationDigest !== 'string' || !/^[a-f0-9]{64}$/.test(data.operationDigest))
    throw new OrganizationRefused('invalid-schema');
  return Object.freeze({
    version: 1,
    id: identifier(data.id),
    tenant: identifier(data.tenant),
    task: identifier(data.task),
    actor: identifier(data.actor),
    audience: identifier(data.audience),
    epoch: integer(data.epoch, 1),
    environment: identifier(data.environment),
    operationDigest: data.operationDigest,
    notBefore: integer(data.notBefore),
    expiresAt: integer(data.expiresAt, 1),
  });
}

export function verifyEnvelope<T>(
  domain: TOrganizationSigningDomain,
  envelope: IOrganizationEnvelope<T>,
  key: KeyObject,
): void {
  const data = record(envelope, ['claims', 'signature']);
  if (typeof data.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(data.signature))
    throw new OrganizationRefused('invalid-proof');
  const signature = Buffer.from(data.signature, 'base64url');
  if (
    signature.length !== 64 ||
    signature.toString('base64url') !== data.signature ||
    !verify(null, organizationSigningBytes(domain, data.claims), key, signature)
  )
    throw new OrganizationRefused('invalid-proof');
}

export function currentTime(
  claims: { readonly notBefore: number; readonly expiresAt: number },
  now: number,
  maxTtlMs: number,
): void {
  integer(now);
  if (
    claims.expiresAt - claims.notBefore > maxTtlMs ||
    now < claims.notBefore ||
    now >= claims.expiresAt
  )
    throw new OrganizationRefused('expired');
}
