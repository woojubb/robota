import { organizationCanonical } from './canonical.js';
import { OrganizationRefused } from './types.js';
import { OrganizationNoEffect } from './no-effect.js';
import { identifier, integer, record, units } from './verification.js';
import type { OrganizationLedger } from './sqlite-ledger.js';
import type { IOrganizationAction, IOrganizationUnits, TOrganizationJson } from './types.js';

function transactional<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    // The ledger propagates a refusal only after a successful rollback. Storage/commit uncertainty stays held.
    if (
      error instanceof OrganizationRefused &&
      [
        'not-authorized',
        'invalid-schema',
        'expired',
        'revoked',
        'operation-conflict',
        'operation-pending',
      ].includes(error.reason)
    )
      throw new OrganizationNoEffect(error.reason, {
        tokens: 0,
        timeMs: 0,
        costMicros: 0,
      });
    throw error;
  }
}

export interface IOrganizationStateActionsOptions {
  readonly resource: string;
  readonly readRoles: readonly string[];
  readonly writeRoles: readonly string[];
  readonly writeRequiresApproval: boolean;
  readonly reservation: IOrganizationUnits;
}

/** Owner-installed task state actions. Workers cannot choose roles, budget or approval policy. */
export function createOrganizationStateActions(
  ledger: OrganizationLedger,
  options: IOrganizationStateActionsOptions,
): readonly IOrganizationAction[] {
  const resource = identifier(options.resource);
  const readRoles = Object.freeze(options.readRoles.map(identifier));
  const writeRoles = Object.freeze(options.writeRoles.map(identifier));
  const reservation = units(options.reservation);
  if (
    readRoles.length === 0 ||
    writeRoles.length === 0 ||
    new Set(readRoles).size !== readRoles.length ||
    new Set(writeRoles).size !== writeRoles.length ||
    typeof options.writeRequiresApproval !== 'boolean'
  )
    throw new OrganizationRefused('invalid-schema');
  const common = { resource, reserve: () => reservation };
  return Object.freeze([
    Object.freeze({
      ...common,
      operation: 'state.read',
      roles: readRoles,
      requiresApproval: false,
      reserve: (operation) => {
        record(operation.parameters, []);
        return reservation;
      },
      execute: async (_, context) => {
        const result = transactional(() => ledger.readState(context.proof));
        return {
          value: {
            revision: result.revision,
            value: result.value,
          } as TOrganizationJson,
          usage: { tokens: 0, timeMs: 0, costMicros: 0 },
        };
      },
    } as IOrganizationAction),
    Object.freeze({
      ...common,
      operation: 'state.lease',
      roles: writeRoles,
      requiresApproval: false,
      reserve: (operation) => {
        const parameters = record(operation.parameters, ['expectedRevision', 'ttlMs']);
        integer(parameters.expectedRevision);
        integer(parameters.ttlMs, 1);
        if (Number(parameters.ttlMs) > 30_000) throw new OrganizationRefused('invalid-schema');
        return reservation;
      },
      execute: async (_, context) => {
        const result = transactional(() => ledger.leaseState(context.proof));
        return {
          value: {
            revision: result.revision,
            fence: result.fence,
            expiresAt: result.expiresAt,
          },
          usage: { tokens: 0, timeMs: 0, costMicros: 0 },
        };
      },
    } as IOrganizationAction),
    Object.freeze({
      ...common,
      operation: 'state.write',
      roles: writeRoles,
      requiresApproval: options.writeRequiresApproval,
      reserve: (operation) => {
        const parameters = record(operation.parameters, ['expectedRevision', 'fence', 'value']);
        integer(parameters.expectedRevision);
        integer(parameters.fence, 1);
        organizationCanonical(parameters.value);
        return reservation;
      },
      execute: async (_, context) => {
        const result = transactional(() => ledger.writeState(context.proof));
        return {
          value: {
            revision: result.revision,
            value: result.value,
          } as TOrganizationJson,
          usage: { tokens: 0, timeMs: 0, costMicros: 0 },
        };
      },
    } as IOrganizationAction),
  ]);
}
