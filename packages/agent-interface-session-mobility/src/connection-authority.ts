/**
 * What a connected device may do here, decided per connection and never beyond what the operator of
 * this session allows.
 *
 * Admission says who the peer is and which capabilities its certificate and local policy leave it.
 * That is necessary, not sufficient: some capabilities also need the operator here to say yes.
 *
 * - `presence` and `message` need nothing more. A turn a message starts is a peer turn, and what it
 *   may do is decided by where the peer runs, in the one permission evaluator.
 * - `delegate` and `handoff` ask the operator for every request. A delegated task runs as a peer
 *   turn under this session's own policy; nothing the sender attaches to the request travels with it.
 * - `observe` and `drive` ask the operator once for every connection. A new connection asks again,
 *   however recently the same device was allowed.
 *
 * With no operator to ask — a headless process, no terminal — the answer is no. The approver must be
 * someone a connected surface cannot speak for: a surface that could answer the question could
 * admit the next device itself.
 */

import type { TMeshCapability } from './mesh-admission-contracts.js';
import type { TPeerReach } from '@robota-sdk/agent-core';
import type { IPeerTurnContext } from '@robota-sdk/agent-interface-session';

/** How often the receiving operator must approve a capability. */
export type TCapabilityApproval = 'never' | 'every-request' | 'every-connection';

const APPROVAL: Readonly<Record<TMeshCapability, TCapabilityApproval>> = {
  presence: 'never',
  message: 'never',
  delegate: 'every-request',
  handoff: 'every-request',
  observe: 'every-connection',
  drive: 'every-connection',
};

/** How often the receiving operator must approve `capability`. */
export function capabilityApproval(capability: TMeshCapability): TCapabilityApproval {
  return APPROVAL[capability];
}

/** The connected peer, as admission established it. An `IMeshAdmission` is one. */
export interface IConnectionPeer {
  /** Shown to the operator. Absent when the carrier learned no stable id. */
  readonly deviceId?: string;
  /** The peer's session: where the answer to a delegated task goes. */
  readonly sessionId?: string;
  /** Where the carrier established the peer runs. */
  readonly locality: TPeerReach;
  /** What admission granted. A capability outside it is refused without asking. */
  readonly capabilities: readonly TMeshCapability[];
}

/** One question to the receiving operator. */
export interface ICapabilityApprovalRequest {
  readonly capability: TMeshCapability;
  readonly scope: 'connection' | 'request';
  readonly deviceId?: string;
  readonly locality: TPeerReach;
  /** A request-scoped approval: what the peer asks for, in its own words. Untrusted text. */
  readonly summary?: string;
}

/**
 * The operator of the receiving session. Resolves `true` only on the operator's explicit yes; a
 * rejection is a no.
 */
export interface IOperatorApprover {
  approve(request: ICapabilityApprovalRequest): Promise<boolean>;
}

export type TCapabilityRefusal =
  /** Admission did not grant the capability. */
  | 'not-granted'
  /** The capability needs the operator and there is nobody to ask. */
  | 'no-approver'
  /** The operator said no, or asking failed. */
  | 'declined';

export type TCapabilityDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: TCapabilityRefusal };

/** A task another device asks this session to run. Only these fields are read. */
export interface IDelegationRequest {
  readonly requestId: string;
  readonly task: string;
}

/** An approved delegated task, as the turn this session submits for it. */
export interface IDelegatedTurn {
  readonly input: string;
  readonly options: {
    readonly turnSource: 'peer';
    readonly driverId: string;
    readonly peer: IPeerTurnContext;
  };
}

export type TDelegationDecision =
  | { readonly allowed: true; readonly turn: IDelegatedTurn }
  | { readonly allowed: false; readonly reason: TCapabilityRefusal };

const REFUSED_DECLINED: TCapabilityDecision = { allowed: false, reason: 'declined' };

/** The authority one connection holds. Construct one per connection. */
export class ConnectionAuthority {
  /** One answer per capability for this connection, shared by concurrent asks. */
  private readonly connectionAnswers = new Map<TMeshCapability, Promise<TCapabilityDecision>>();

  constructor(
    private readonly peer: IConnectionPeer,
    private readonly approver?: IOperatorApprover,
  ) {}

  /** Whether the peer may use `capability` now. `summary` is shown for a request-scoped approval. */
  authorize(capability: TMeshCapability, summary?: string): Promise<TCapabilityDecision> {
    if (!this.peer.capabilities.includes(capability)) {
      return Promise.resolve({ allowed: false, reason: 'not-granted' });
    }
    const approval = capabilityApproval(capability);
    if (approval === 'never') return Promise.resolve({ allowed: true });
    if (approval === 'every-request') return this.ask(capability, 'request', summary);
    let answer = this.connectionAnswers.get(capability);
    if (answer === undefined) {
      answer = this.ask(capability, 'connection');
      this.connectionAnswers.set(capability, answer);
    }
    return answer;
  }

  /**
   * Ask the operator about a delegated task and, on yes, build the turn that runs it: a peer turn
   * from where admission placed the peer. Everything else on the request is ignored.
   */
  async authorizeDelegation(request: IDelegationRequest): Promise<TDelegationDecision> {
    const { requestId, task } = request;
    const replyTo = this.peer.sessionId;
    if (replyTo === undefined) return { allowed: false, reason: 'not-granted' };
    const decision = await this.authorize('delegate', task);
    if (!decision.allowed) return decision;
    return {
      allowed: true,
      turn: {
        input: task,
        options: {
          turnSource: 'peer',
          driverId: `peer:${this.peer.deviceId ?? replyTo}`,
          peer: { reach: this.peer.locality, messageId: requestId, replyTo },
        },
      },
    };
  }

  private async ask(
    capability: TMeshCapability,
    scope: 'connection' | 'request',
    summary?: string,
  ): Promise<TCapabilityDecision> {
    if (this.approver === undefined) return { allowed: false, reason: 'no-approver' };
    const question: ICapabilityApprovalRequest = {
      capability,
      scope,
      ...(this.peer.deviceId !== undefined ? { deviceId: this.peer.deviceId } : {}),
      locality: this.peer.locality,
      ...(summary !== undefined ? { summary } : {}),
    };
    try {
      return (await this.approver.approve(question)) === true
        ? { allowed: true }
        : REFUSED_DECLINED;
    } catch {
      return REFUSED_DECLINED;
    }
  }
}
