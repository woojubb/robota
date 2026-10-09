import { createHash } from 'node:crypto';
import { organizationCanonical as publicCanonical, OrganizationSchemaError } from '@robota-sdk/agent-organization';
import { OrganizationRefused } from './types.js';
import type { IOrganizationRequest } from './types.js';

export function organizationCanonical(value: unknown): string {
  try {
    return publicCanonical(value);
  } catch (error) {
    if (error instanceof OrganizationSchemaError) throw new OrganizationRefused('invalid-schema');
    throw error;
  }
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
