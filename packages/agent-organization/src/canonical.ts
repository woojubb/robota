import { createHash } from 'node:crypto';
import { OrganizationRefused } from './types.js';
import type { IOrganizationRequest } from './types.js';

function validString(value: string): void {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) throw new OrganizationRefused('invalid-schema');
  }
}

/** UTF-8 canonical JSON for a deliberately bounded, safe-integer subset; no float coercion. */
export function organizationCanonical(value: unknown): string {
  const visiting = new Set<object>();
  let nodes = 0;
  function encode(item: unknown, depth: number): string {
    if (++nodes > 4096 || depth > 32) throw new OrganizationRefused('invalid-schema');
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'string') {
      validString(item);
      return JSON.stringify(item);
    }
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || Object.is(item, -0))
        throw new OrganizationRefused('invalid-schema');
      return JSON.stringify(item);
    }
    if (typeof item !== 'object' || visiting.has(item))
      throw new OrganizationRefused('invalid-schema');
    visiting.add(item);
    try {
      if (Array.isArray(item)) {
        if (Reflect.ownKeys(item).length !== item.length + 1)
          throw new OrganizationRefused('invalid-schema');
        return `[${Array.from({ length: item.length }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (descriptor === undefined || !('value' in descriptor))
            throw new OrganizationRefused('invalid-schema');
          return encode(descriptor.value, depth + 1);
        }).join(',')}]`;
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new OrganizationRefused('invalid-schema');
      const keys = Reflect.ownKeys(item);
      if (keys.some((key) => typeof key !== 'string'))
        throw new OrganizationRefused('invalid-schema');
      return `{${(keys as string[])
        .sort()
        .map((key) => {
          validString(key);
          const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
          if (!descriptor.enumerable || !('value' in descriptor))
            throw new OrganizationRefused('invalid-schema');
          return `${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`;
        })
        .join(',')}}`;
    } finally {
      visiting.delete(item);
    }
  }
  const encoded = encode(value, 0);
  if (Buffer.byteLength(encoded, 'utf8') > 64 * 1024)
    throw new OrganizationRefused('invalid-schema');
  return encoded;
}

export type TOrganizationSigningDomain = 'workload' | 'request' | 'approval';

export function organizationSigningBytes(
  domain: TOrganizationSigningDomain,
  claims: unknown,
): Buffer {
  if (!['workload', 'request', 'approval'].includes(domain))
    throw new OrganizationRefused('invalid-schema');
  return Buffer.from(
    organizationCanonical([`robota/organization-${domain}/v1`, claims]),
    'utf8',
  );
}

export function organizationOperationDigest(request: IOrganizationRequest): string {
  return createHash('sha256')
    .update(
      organizationCanonical([
        'robota/organization-operation/v1',
        request.grantId,
        request.tenant,
        request.task,
        request.actor,
        request.audience,
        request.epoch,
        request.operation,
      ]),
      'utf8',
    )
    .digest('hex');
}
