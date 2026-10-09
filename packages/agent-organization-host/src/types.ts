import type { IOrganizationBudget, IOrganizationUnits } from '@robota-sdk/agent-organization';
export type { IOrganizationBudget, IOrganizationUnits } from '@robota-sdk/agent-organization';

export type TOrganizationJson =
  null | boolean | number | string | TOrganizationJson[] | { [key: string]: TOrganizationJson };

export interface IOrganizationScope {
  readonly resource: string;
  readonly operations: readonly string[];
}

/** Signed by the external workload issuer; its private key is never accepted by this package. */
export interface IOrganizationGrant {
  readonly version: 1;
  readonly id: string;
  readonly tenant: string;
  readonly task: string;
  readonly actor: string;
  readonly role: string;
  readonly audience: string;
  readonly parent: string | null;
  readonly epoch: number;
  readonly notBefore: number;
  readonly expiresAt: number;
  readonly publicKey: string;
  readonly scopes: readonly IOrganizationScope[];
  readonly budget: IOrganizationBudget;
}

export interface IOrganizationOperation {
  readonly idempotencyKey: string;
  readonly resource: string;
  readonly operation: string;
  readonly environment: string;
  readonly parameters: TOrganizationJson;
}

/** Proof of possession by the worker key named in the issued workload grant. */
export interface IOrganizationRequest {
  readonly version: 1;
  readonly grantId: string;
  readonly tenant: string;
  readonly task: string;
  readonly actor: string;
  readonly audience: string;
  readonly epoch: number;
  readonly nonce: string;
  readonly notBefore: number;
  readonly expiresAt: number;
  readonly operation: IOrganizationOperation;
}

/** Minted through a separate operator channel, not a worker/model/ordinary tool approval. */
export interface IOrganizationApproval {
  readonly version: 1;
  readonly id: string;
  readonly tenant: string;
  readonly task: string;
  readonly actor: string;
  readonly audience: string;
  readonly epoch: number;
  readonly environment: string;
  readonly operationDigest: string;
  readonly notBefore: number;
  readonly expiresAt: number;
}

export interface IOrganizationEnvelope<T> {
  readonly claims: T;
  readonly signature: string;
}

export interface IOrganizationCall {
  readonly request: IOrganizationEnvelope<IOrganizationRequest>;
  readonly approval: IOrganizationEnvelope<IOrganizationApproval> | null;
}

export interface IOrganizationReceipt {
  readonly value: TOrganizationJson;
  /** Trusted instrumentation; the action owner must bound effects to its reservation. */
  readonly usage: IOrganizationUnits;
}

export interface IOrganizationAction {
  readonly resource: string;
  readonly operation: string;
  readonly roles: readonly string[];
  readonly requiresApproval: boolean;
  /** Trusted server-side validation and upper bound; never accept a worker-selected quota. */
  reserve(operation: IOrganizationOperation): IOrganizationUnits;
  execute(
    operation: IOrganizationOperation,
    context: {
      readonly signal: AbortSignal;
      readonly proof: IOrganizationEnvelope<IOrganizationRequest>;
      readonly operationDigest: string;
      readonly identity: IOrganizationGrant;
      readonly reservation: IOrganizationUnits;
    },
  ): Promise<IOrganizationReceipt>;
}

export type TOrganizationRefusal =
  | 'invalid-proof'
  | 'invalid-schema'
  | 'not-authorized'
  | 'expired'
  | 'revoked'
  | 'budget-exhausted'
  | 'replayed'
  | 'approval-required'
  | 'approval-invalid'
  | 'approval-reused'
  | 'operation-conflict'
  | 'operation-pending'
  | 'outcome-unknown'
  | 'policy-unavailable';

export class OrganizationRefused extends Error {
  constructor(readonly reason: TOrganizationRefusal) {
    super(`Organization operation refused: ${reason}`);
  }
}
