import { OrganizationNoEffect } from './no-effect.js';
import { OrganizationRefused } from './types.js';
import { gitParameters } from './git-asset.js';
import { units } from './verification.js';
import { createOrganizationStateActions } from './state-actions.js';
import type { OrganizationGitAsset } from './git-asset.js';
import type { OrganizationLedger } from './sqlite-ledger.js';
import type { IOrganizationAction, IOrganizationUnits, TOrganizationJson } from './types.js';

export interface IOrganizationGitActionsOptions {
  readonly resource: string;
  readonly asset: OrganizationGitAsset;
  readonly readRoles: readonly string[];
  readonly writeRoles: readonly string[];
  readonly reservation: IOrganizationUnits;
}

/** Owner-pinned Git asset. Publication always requires separate exact operator approval. */
export function createOrganizationGitActions(
  ledger: OrganizationLedger,
  options: IOrganizationGitActionsOptions,
): readonly IOrganizationAction[] {
  const states = createOrganizationStateActions(ledger, {
    ...options,
    writeRequiresApproval: true,
  });
  const asset = options.asset;
  if (options.reservation.timeMs < asset.phaseTimeoutMs * 3)
    throw new OrganizationRefused('invalid-schema');
  const lease = states[1]!;
  const reservation = units(options.reservation);
  const publish: IOrganizationAction = Object.freeze<IOrganizationAction>({
    resource: lease.resource,
    operation: 'git.publish',
    roles: lease.roles,
    requiresApproval: true,
    reserve: (operation) => {
      gitParameters(operation.parameters);
      return reservation;
    },
    execute: async (_, context) => {
      try {
        ledger.prepareGitPublication(context.proof, asset);
      } catch (error) {
        // No target ref changed in this phase. Only confirmed rollback refusals may release the hold.
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
          throw new OrganizationNoEffect(error.reason, { tokens: 0, timeMs: 0, costMicros: 0 });
        throw error;
      }
      const result = ledger.commitGitPublication(context.proof, asset);
      return {
        value: { revision: result.revision, value: result.value } as TOrganizationJson,
        usage: { tokens: 0, timeMs: 0, costMicros: 0 },
      };
    },
  });
  // Do not expose arbitrary state.write for the Git head resource.
  return Object.freeze([states[0]!, lease, publish]);
}
