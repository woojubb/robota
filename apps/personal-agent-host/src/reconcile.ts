import type { AccountStore } from './accounts/store.js';
import type { SecretStore } from './accounts/secret-store.js';
import type { AuditLog, AuditResult } from './audit.js';
import type { IHostConfig } from './config.js';
import { errorMessage, scrub } from './errors.js';
import type { IRuntimePort, IUnitStatus } from './runtime/port.js';
import { unitSpecOf } from './unit-spec.js';

export interface IBackoff {
  baseMs: number;
  maxMs: number;
}

export interface IReconcileReport {
  guard: 'verified' | 'unverified';
  /** Units started again because their account should be running. */
  started: string[];
  /** Units stopped: running while suspended, or every unit when the guard failed. */
  stopped: string[];
  failed: Array<{ account: string; reason: string }>;
  /** Units of this install with no record. Reported, never deleted. */
  orphans: string[];
  /** Running units that report unhealthy. */
  unhealthy: string[];
  /** Accounts not retried yet because an earlier try failed. */
  backedOff: string[];
}

export interface IReconcilerDeps {
  config: IHostConfig;
  store: AccountStore;
  secrets: SecretStore;
  runtime: IRuntimePort;
  audit: AuditLog;
  applyRoutes(): Promise<void>;
  /** Whether the last route apply succeeded; a pass that finds it did not applies them again. */
  routesCurrent(): boolean;
  now(): number;
  backoff: IBackoff;
}

const ACTOR = 'reconcile';

/**
 * Brings units to what the records say. It fails closed: when the guard cannot be verified it
 * stops every unit instead of leaving any running unguarded.
 */
export class Reconciler {
  private readonly retry = new Map<string, { failures: number; nextAt: number }>();
  private readonly reportedOrphans = new Set<string>();

  constructor(private readonly deps: IReconcilerDeps) {}

  private async record(
    command: string,
    account: string | null,
    result: AuditResult,
    reason: string | null,
  ): Promise<void> {
    await this.deps.audit.append({ actor: ACTOR, command, account, result, reason });
  }

  private async guardVerified(): Promise<boolean> {
    try {
      return (await this.deps.runtime.describe()).guard.state === 'verified';
    } catch {
      return false;
    }
  }

  private async stopEverything(report: IReconcileReport): Promise<void> {
    let units: IUnitStatus[] = [];
    try {
      units = await this.deps.runtime.list();
    } catch (error) {
      report.failed.push({ account: '*', reason: errorMessage(error) });
    }
    for (const unit of units) {
      if (unit.state !== 'running') continue;
      try {
        await this.deps.runtime.stop(unit.account);
        report.stopped.push(unit.account);
        await this.record('reconcile-stop', unit.account, 'ok', 'network guard not verified');
      } catch (error) {
        const reason = errorMessage(error);
        report.failed.push({ account: unit.account, reason });
        await this.record('reconcile-stop', unit.account, 'failed', reason);
      }
    }
  }

  async pass(): Promise<IReconcileReport> {
    const { runtime, store, secrets, config } = this.deps;
    const report: IReconcileReport = {
      guard: 'verified',
      started: [],
      stopped: [],
      failed: [],
      orphans: [],
      unhealthy: [],
      backedOff: [],
    };

    if (!(await this.guardVerified())) {
      report.guard = 'unverified';
      await this.stopEverything(report);
      await this.record('reconcile', null, 'failed', 'network guard not verified; units stopped');
      await this.deps.applyRoutes().catch(() => undefined);
      return report;
    }

    const units = new Map((await runtime.list()).map((u) => [u.account, u]));
    let changed = false;
    const records = store.list();
    for (const account of records) {
      const unit = units.get(account.id);
      if (account.state === 'suspended') {
        if (unit?.state === 'running') {
          try {
            await runtime.stop(account.id);
            report.stopped.push(account.id);
            changed = true;
            await this.record('reconcile-stop', account.id, 'ok', 'account is suspended');
          } catch (error) {
            const reason = errorMessage(error);
            report.failed.push({ account: account.id, reason });
            await this.record('reconcile-stop', account.id, 'failed', reason);
          }
        }
        continue;
      }
      if (account.state !== 'active') continue;
      if (unit?.state === 'running') {
        this.retry.delete(account.id);
        if (!unit.healthy) report.unhealthy.push(account.id);
        continue;
      }
      const wait = this.retry.get(account.id);
      if (wait && this.deps.now() < wait.nextAt) {
        report.backedOff.push(account.id);
        continue;
      }
      let known: string[] = [];
      try {
        const unitSecrets = await secrets.resolve(account);
        known = unitSecrets.modelApiKey ? [unitSecrets.modelApiKey] : [];
        const spec = unitSpecOf(account, config, store.installId);
        if (!unit) await runtime.provision(spec);
        await runtime.start(spec, unitSecrets);
        this.retry.delete(account.id);
        report.started.push(account.id);
        changed = true;
        await this.record('reconcile-start', account.id, 'ok', null);
      } catch (error) {
        const failures = (wait?.failures ?? 0) + 1;
        const delay = Math.min(
          this.deps.backoff.maxMs,
          this.deps.backoff.baseMs * 2 ** (failures - 1),
        );
        this.retry.set(account.id, { failures, nextAt: this.deps.now() + delay });
        const reason = scrub(errorMessage(error), known);
        report.failed.push({ account: account.id, reason });
        await this.record('reconcile-start', account.id, 'failed', reason);
      }
    }

    const recorded = new Set(records.map((r) => r.id));
    for (const unit of units.values()) {
      if (recorded.has(unit.account)) continue;
      report.orphans.push(unit.account);
      if (!this.reportedOrphans.has(unit.account)) {
        this.reportedOrphans.add(unit.account);
        await this.record(
          'reconcile-orphan',
          unit.account,
          'ok',
          'unit has no record; left in place',
        );
      }
    }

    if (changed || !this.deps.routesCurrent()) {
      try {
        await this.deps.applyRoutes();
      } catch (error) {
        const reason = errorMessage(error);
        report.failed.push({ account: '*', reason: `routes: ${reason}` });
        await this.record('reconcile-routes', null, 'failed', reason);
      }
    }
    return report;
  }
}
