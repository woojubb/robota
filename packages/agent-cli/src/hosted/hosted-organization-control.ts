import { OrganizationBroker, OrganizationRefused, organizationAuditEvent, organizationOperationDigest } from '@robota-sdk/agent-organization';
import type { OrganizationAudit, OrganizationLedger, IOrganizationAction, IOrganizationCall, IOrganizationGrant, IOrganizationReceipt, IOrganizationRequest, TOrganizationJson } from '@robota-sdk/agent-organization';
import type { IHostedIdentity } from './hosted-runtime-types.js';

export interface IHostedOrganizationWorker {
  readonly resource: string;
  readonly grantId: string;
  readonly identity: IHostedIdentity;
  readonly epoch: number;
}

/** Owner provider inventory must survive broker restart and exclude resources outside its custody. */
export interface IHostedOrganizationInventory {
  list(signal: AbortSignal): Promise<readonly IHostedOrganizationWorker[]>;
  /** Revalidate owner metadata before termination; return only after the provider acknowledges cleanup. */
  terminate(worker: IHostedOrganizationWorker, signal: AbortSignal): Promise<void>;
}

export interface IHostedOrganizationIncidentOwners {
  readonly detection: string;
  readonly containment: string;
  readonly assessment: string;
  readonly recovery: string;
  /** Owner-installed incident channel; metadata only, no provider errors, credentials or request bodies. */
  report(event: {
    readonly kind: 'authority-unavailable' | 'cleanup-unresolved' | 'unknown-effect';
    readonly resources: readonly string[];
    readonly operationDigest?: string;
  }): Promise<void>;
}

export interface IHostedOrganizationControlOptions {
  readonly ledger: OrganizationLedger;
  readonly audit: OrganizationAudit;
  readonly actions: readonly IOrganizationAction[];
  readonly inventory: IHostedOrganizationInventory;
  readonly incidentOwners: IHostedOrganizationIncidentOwners;
  readonly policyIntervalMs?: number;
  readonly providerTimeoutMs?: number;
}

/** Owner-side company composition. No administrator operations are exposed to workers or model tools. */
export class HostedOrganizationControl {
  private readonly ledger: OrganizationLedger;
  private readonly audit: OrganizationAudit;
  private readonly broker: OrganizationBroker;
  private readonly inventory: IHostedOrganizationInventory;
  private readonly incidents: IHostedOrganizationIncidentOwners;
  private readonly timeout: number;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly calls = new Map<AbortController, string>();
  private sweepPending?: Promise<void>;
  private closed = false;
  private quarantined = false;

  constructor(options: IHostedOrganizationControlOptions) {
    this.ledger = options.ledger;
    this.audit = options.audit;
    this.broker = new OrganizationBroker({ ledger: options.ledger, audit: options.audit, actions: options.actions, hosted: true, policyIntervalMs: options.policyIntervalMs });
    const interval = options.policyIntervalMs ?? 100;
    this.timeout = options.providerTimeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 30_000 ||
      typeof options.inventory?.list !== 'function' || typeof options.inventory.terminate !== 'function' ||
      typeof options.incidentOwners?.report !== 'function' ||
      ['detection', 'containment', 'assessment', 'recovery'].some((key) => {
        const value = options.incidentOwners[key as 'detection'];
        return typeof value !== 'string' || value.trim().length === 0;
      })) throw new OrganizationRefused('invalid-schema');
    this.inventory = Object.freeze({ list: options.inventory.list.bind(options.inventory), terminate: options.inventory.terminate.bind(options.inventory) });
    this.incidents = Object.freeze({ ...options.incidentOwners, report: options.incidentOwners.report.bind(options.incidentOwners) });
    this.timer = setInterval(() => { void this.sweep().catch(() => undefined); }, interval);
    this.timer.unref();
  }

  private identity(grantId: string, identity: IHostedIdentity, epoch: number): IOrganizationGrant {
    const grant = this.ledger.currentGrant(grantId);
    // currentGrant verifies every delegation ancestor. Logical root/runtime bindings come from
    // the owner's provider inventory, and survive replacement of a revoked workload grant.
    if (grant.tenant !== identity.tenant || grant.task !== identity.task || grant.actor !== identity.actor ||
      grant.epoch !== epoch)
      throw new OrganizationRefused('not-authorized');
    return grant;
  }

  /** Admission uses current policy and retained audit evidence, never checkpoint authority. */
  async admit(worker: IHostedOrganizationWorker, signal?: AbortSignal): Promise<IOrganizationGrant> {
    if (this.closed || this.quarantined) throw new OrganizationRefused('policy-unavailable');
    this.ledger.verifyAnchoredAuthority();
    const grant = this.identity(worker.grantId, worker.identity, worker.epoch);
    await this.audit.verify(signal);
    const live = await this.inventory.list(signal === undefined ? AbortSignal.timeout(this.timeout) : AbortSignal.any([signal, AbortSignal.timeout(this.timeout)]));
    if (!live.some((entry) => entry.resource === worker.resource && entry.grantId === worker.grantId &&
      entry.epoch === worker.epoch && Object.entries(worker.identity).every(([key, value]) => entry.identity[key as keyof IHostedIdentity] === value)))
      throw new OrganizationRefused('not-authorized');
    if (this.closed || this.quarantined || signal?.aborted) throw new OrganizationRefused('not-authorized');
    this.identity(worker.grantId, worker.identity, worker.epoch);
    return grant;
  }

  async apply(call: IOrganizationCall, signal?: AbortSignal, onWithdrawal?: () => void): Promise<IOrganizationReceipt> {
    if (this.closed || this.quarantined) throw new OrganizationRefused('policy-unavailable');
    const controller = new AbortController();
    const withdraw = (): void => { onWithdrawal?.(); };
    controller.signal.addEventListener('abort', withdraw, { once: true });
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    this.calls.set(controller, call.request.claims.grantId);
    try { return await this.broker.apply(call, controller.signal); }
    catch (error) {
      if (error instanceof OrganizationRefused && error.reason === 'outcome-unknown') {
        await this.incidents.report({ kind: 'unknown-effect', resources: [call.request.claims.operation.resource], operationDigest: organizationOperationDigest(call.request.claims) }).catch(() => undefined);
      }
      throw error;
    }
    finally {
      this.calls.delete(controller);
      signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', withdraw);
    }
  }

  /** Owner commands persist policy withdrawal before terminating every affected provider worker. */
  private async afterWithdrawal(): Promise<void> {
    // An existing sweep may have evaluated policy before this withdrawal. Wait for it, then inspect again.
    await this.sweepPending?.catch(() => undefined);
    await this.sweep();
  }
  async stopGrant(grantId: string): Promise<void> { this.ledger.revokeGrant(grantId); await this.afterWithdrawal(); }
  async stopTask(tenant: string, task: string): Promise<void> { this.ledger.stopTask(tenant, task); await this.afterWithdrawal(); }
  async stopTenant(tenant: string): Promise<void> { this.ledger.stopTenant(tenant); await this.afterWithdrawal(); }
  async emergencyStop(): Promise<void> { this.ledger.emergencyStop(); await this.afterWithdrawal(); }

  /** Owner recovery channel only. A worker cannot supply the asset-owner confirmation capability. */
  async reconcileExternalOperation(request: IOrganizationRequest, assetOwner: {
    confirm(operationDigest: string, signal?: AbortSignal): Promise<TOrganizationJson>;
  }, signal?: AbortSignal): Promise<IOrganizationReceipt> {
    this.ledger.verifyAnchoredAuthority();
    const event = organizationAuditEvent(request, 'complete');
    const confirmed = await assetOwner.confirm(event.operationDigest, signal);
    await this.audit.record(event, signal);
    return this.ledger.reconcileExternalOperation(request, confirmed);
  }

  sweep(): Promise<void> {
    if (this.sweepPending !== undefined) return this.sweepPending;
    this.sweepPending = this.sweepOnce().finally(() => { this.sweepPending = undefined; });
    return this.sweepPending;
  }

  private async sweepOnce(): Promise<void> {
    const firstFailure = !this.closed && !this.quarantined;
    let unavailable = this.closed || this.quarantined;
    try { this.ledger.verifyAnchoredAuthority(); await this.audit.verify(AbortSignal.timeout(this.timeout)); }
    catch { unavailable = true; }
    if (unavailable && !this.closed) { this.quarantined = true; this.broker.close(); }
    for (const [controller, grantId] of this.calls) {
      try { if (unavailable) throw new OrganizationRefused('policy-unavailable'); this.ledger.currentGrant(grantId); }
      catch { controller.abort(); }
    }
    let workers: readonly IHostedOrganizationWorker[];
    try { workers = await this.inventory.list(AbortSignal.timeout(this.timeout)); }
    catch {
      this.quarantined = true;
      this.broker.close();
      for (const controller of this.calls.keys()) controller.abort();
      await this.incidents.report({ kind: 'cleanup-unresolved', resources: [] });
      throw new OrganizationRefused('policy-unavailable');
    }
    const stopped = workers.filter((worker) => {
      try { if (unavailable) return true; this.identity(worker.grantId, worker.identity, worker.epoch); return false; }
      catch { return true; }
    });
    const outcomes = await Promise.allSettled(stopped.map((worker) => this.inventory.terminate(worker, AbortSignal.timeout(this.timeout))));
    const unresolved = stopped.filter((_worker, index) => outcomes[index]!.status === 'rejected').map((worker) => worker.resource);
    if (unavailable && firstFailure) await this.incidents.report({ kind: 'authority-unavailable', resources: stopped.map((worker) => worker.resource) });
    if (unresolved.length > 0) {
      await this.incidents.report({ kind: 'cleanup-unresolved', resources: unresolved });
      throw new OrganizationRefused('policy-unavailable');
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    this.broker.close();
    for (const controller of this.calls.keys()) controller.abort();
    await this.afterWithdrawal();
  }
}
