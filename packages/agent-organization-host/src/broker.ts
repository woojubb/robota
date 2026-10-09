import { performance } from 'node:perf_hooks';
import { OrganizationAudit, organizationAuditEvent } from './audit.js';
import type { IOrganizationAuditWriter, TOrganizationAuditPhase } from './audit.js';
import { organizationCanonical } from './canonical.js';
import type { OrganizationLedger } from './sqlite-ledger.js';
import { OrganizationRefused } from './types.js';
import { OrganizationNoEffect, noEffectReason } from './no-effect.js';
import {
  approvalClaims,
  identifier,
  integer,
  receipt,
  record,
  requestClaims,
  units,
} from './verification.js';
import type {
  IOrganizationAction,
  IOrganizationCall,
  IOrganizationEnvelope,
  IOrganizationReceipt,
  IOrganizationRequest,
} from './types.js';

export interface IOrganizationBrokerOptions {
  readonly ledger: OrganizationLedger;
  readonly actions: readonly IOrganizationAction[];
  /** Owner-installed independently anchored audit. Hosted composition must require this capability. */
  readonly audit?: IOrganizationAuditWriter;
  /** Hosted company composition requires anchored policy and a verified anchored audit implementation. */
  readonly hosted?: boolean;
  /** Nominal recheck interval; event-loop stalls and provider shutdown require external containment. */
  readonly policyIntervalMs?: number;
  readonly now?: () => number;
}

function snapshotCall(value: IOrganizationCall): IOrganizationCall {
  const data = record(value, ['request', 'approval']);
  const request = record(data.request, ['claims', 'signature']);
  const approval = data.approval === null ? null : record(data.approval, ['claims', 'signature']);
  if (
    typeof request.signature !== 'string' ||
    (approval !== null && typeof approval.signature !== 'string')
  )
    throw new OrganizationRefused('invalid-proof');
  return Object.freeze({
    request: Object.freeze({
      claims: requestClaims(request.claims),
      signature: request.signature,
    }),
    approval:
      approval === null
        ? null
        : Object.freeze({
            claims: approvalClaims(approval.claims),
            signature: approval.signature as string,
          }),
  });
}

/** Worker requests can use only the action table installed by the broker owner. */
export class OrganizationBroker {
  readonly audience: string;
  private readonly ledger: OrganizationLedger;
  private readonly actions = new Map<string, IOrganizationAction>();
  private readonly interval: number;
  private readonly now: () => number;
  private readonly active = new Set<AbortController>();
  private readonly audit?: IOrganizationAuditWriter;
  private readonly auditReadiness?: (signal?: AbortSignal) => Promise<unknown>;
  private closed = false;

  constructor(options: IOrganizationBrokerOptions) {
    this.ledger = options.ledger;
    if (options.hosted === true) {
      this.ledger.verifyAnchoredAuthority();
      if (!(options.audit instanceof OrganizationAudit))
        throw new OrganizationRefused('policy-unavailable');
      this.auditReadiness = options.audit.verify.bind(options.audit);
    }
    if (options.audit !== undefined) {
      if (typeof options.audit?.record !== 'function')
        throw new OrganizationRefused('invalid-schema');
      this.audit = Object.freeze({ record: options.audit.record.bind(options.audit) });
    }
    this.audience = options.ledger.audience;
    this.interval = integer(options.policyIntervalMs ?? 100, 1);
    if (this.interval > 1000) throw new OrganizationRefused('invalid-schema');
    this.now = options.now ?? Date.now;
    for (const action of options.actions) {
      const resource = identifier(action.resource);
      const operation = identifier(action.operation);
      const roles = action.roles.map(identifier);
      if (
        roles.length === 0 ||
        new Set(roles).size !== roles.length ||
        typeof action.requiresApproval !== 'boolean' ||
        typeof action.reserve !== 'function' ||
        typeof action.execute !== 'function'
      )
        throw new OrganizationRefused('invalid-schema');
      const key = organizationCanonical([resource, operation]);
      if (this.actions.has(key)) throw new OrganizationRefused('invalid-schema');
      this.actions.set(
        key,
        Object.freeze({
          resource,
          operation,
          roles: Object.freeze(roles),
          requiresApproval: action.requiresApproval,
          reserve: action.reserve.bind(action),
          execute: action.execute.bind(action),
        }),
      );
    }
  }

  async apply(value: IOrganizationCall, signal?: AbortSignal): Promise<IOrganizationReceipt> {
    if (this.closed) throw new OrganizationRefused('policy-unavailable');
    if (signal?.aborted) throw new OrganizationRefused('not-authorized');
    await this.auditReadiness?.(signal);
    if (this.closed || signal?.aborted) throw new OrganizationRefused('not-authorized');
    const call = snapshotCall(value);
    const { request, grant } = this.ledger.authenticate(call.request);
    const action = this.actions.get(
      organizationCanonical([request.operation.resource, request.operation.operation]),
    );
    if (action === undefined || !action.roles.includes(grant.role))
      throw new OrganizationRefused('not-authorized');
    const reservation = units(action.reserve(request.operation));
    // A real wall-clock ceiling also bounds unknown holds. Provider ports must bound tokens/cost/effects.
    integer(reservation.timeMs, 1);
    if (reservation.timeMs > 2_147_483_647) throw new OrganizationRefused('invalid-schema');
    const result = this.ledger.reserve(
      call.request,
      reservation,
      call.approval,
      action.requiresApproval,
    );
    if (result.kind === 'complete') return result.receipt;
    if (result.kind === 'refused') throw new OrganizationRefused(result.reason);
    return this.execute(call.request, action, result, signal);
  }

  private async auditRecord(
    request: IOrganizationRequest,
    phase: TOrganizationAuditPhase,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.audit === undefined) return;
    let stopped!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      stopped = () => reject(new OrganizationRefused('outcome-unknown'));
      signal.addEventListener('abort', stopped, { once: true });
      if (signal.aborted) stopped();
    });
    try {
      await Promise.race([
        Promise.resolve().then(() => {
          if (signal.aborted) throw new OrganizationRefused('outcome-unknown');
          return this.audit!.record(organizationAuditEvent(request, phase), signal);
        }),
        aborted,
      ]);
      if (signal.aborted) throw new OrganizationRefused('outcome-unknown');
    } finally {
      signal.removeEventListener('abort', stopped);
    }
  }

  private async execute(
    envelope: IOrganizationEnvelope<IOrganizationRequest>,
    action: IOrganizationAction,
    reserved: {
      readonly digest: string;
      readonly grant: Parameters<IOrganizationAction['execute']>[1]['identity'];
      readonly reservation: Parameters<IOrganizationAction['execute']>[1]['reservation'];
    },
    signal?: AbortSignal,
  ): Promise<IOrganizationReceipt> {
    const request = envelope.claims;
    const controller = new AbortController();
    this.active.add(controller);
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted || this.closed) controller.abort();
    const remaining = Math.min(
      reserved.reservation.timeMs,
      request.expiresAt - this.now(),
      reserved.grant.expiresAt - this.now(),
    );
    const deadline = setTimeout(abort, Math.max(0, remaining));
    const policy = setInterval(() => {
      try {
        this.ledger.authenticate(envelope);
      } catch {
        controller.abort();
      }
    }, this.interval);
    const start = performance.now();
    let abortedListener: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        abortedListener = () => reject(new OrganizationRefused('outcome-unknown'));
        controller.signal.addEventListener('abort', abortedListener, {
          once: true,
        });
        if (controller.signal.aborted) abortedListener();
      });
      const effect = Promise.resolve().then(async () => {
        if (controller.signal.aborted) throw new OrganizationRefused('outcome-unknown');
        // Recheck immediately at dispatch as well as while the action is outstanding.
        this.ledger.authenticate(envelope);
        await this.auditRecord(request, 'dispatch', controller.signal);
        if (controller.signal.aborted || performance.now() - start > remaining)
          throw new OrganizationRefused('outcome-unknown');
        this.ledger.authenticate(envelope);
        return action.execute(request.operation, {
          signal: controller.signal,
          proof: envelope,
          operationDigest: reserved.digest,
          identity: reserved.grant,
          reservation: reserved.reservation,
        });
      });
      const returned = receipt(await Promise.race([effect, aborted]));
      this.ledger.authenticate(envelope);
      if (controller.signal.aborted || performance.now() - start > remaining)
        throw new OrganizationRefused('outcome-unknown');
      await this.auditRecord(request, 'complete', controller.signal);
      this.ledger.authenticate(envelope);
      if (controller.signal.aborted || performance.now() - start > remaining)
        throw new OrganizationRefused('outcome-unknown');
      const completed = receipt({
        value: returned.value,
        usage: {
          ...returned.usage,
          timeMs: Math.max(returned.usage.timeMs, Math.ceil(performance.now() - start)),
        },
      });
      this.ledger.settle(request, completed);
      return completed;
    } catch (error) {
      if (
        error instanceof OrganizationNoEffect &&
        !controller.signal.aborted &&
        performance.now() - start <= remaining
      ) {
        try {
          await this.auditRecord(request, 'refused', controller.signal);
          if (controller.signal.aborted || performance.now() - start > remaining)
            throw new OrganizationRefused('outcome-unknown');
          this.ledger.confirmNoEffect(request, noEffectReason(error.reason), {
            ...error.usage,
            timeMs: Math.max(error.usage.timeMs, Math.ceil(performance.now() - start)),
          });
        } catch {
          controller.abort();
          try {
            this.ledger.markUnknown(request);
          } catch {
            /* Retain the original admission hold. */
          }
          throw new OrganizationRefused('outcome-unknown');
        }
        throw new OrganizationRefused(error.reason);
      }
      controller.abort();
      // A failed write leaves the existing running reservation held; never refund or re-execute.
      try {
        this.ledger.markUnknown(request);
      } catch {
        /* The durable admission already owns the hold. */
      }
      try {
        await this.auditRecord(request, 'unknown', AbortSignal.timeout(1000));
      } catch {
        /* A persisted dispatch and the admission hold survive missing outcome telemetry. */
      }
      throw new OrganizationRefused('outcome-unknown');
    } finally {
      clearTimeout(deadline);
      clearInterval(policy);
      signal?.removeEventListener('abort', abort);
      if (abortedListener !== undefined)
        controller.signal.removeEventListener('abort', abortedListener);
      this.active.delete(controller);
    }
  }

  /** Host shutdown: withdraw admission and signal outstanding trusted effects. */
  close(): void {
    this.closed = true;
    for (const controller of this.active) controller.abort();
  }
}
