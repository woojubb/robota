import type { SecretStore } from './accounts/secret-store.js';
import type { AccountStore } from './accounts/store.js';
import type { IAccountRecord, KeySource } from './accounts/types.js';
import {
  hostnameFor,
  validateAccountId,
  validateApiKey,
  validateBackend,
  validateKeySource,
  validateLimits,
  validateProvider,
} from './accounts/validate.js';
import type { AuditLog } from './audit.js';
import { ALLOW_CONTAINER_SETTING, type IHostConfig, publicOrigin } from './config.js';
import { errorMessage, HostError, REFUSAL_CODES, scrub } from './errors.js';
import type { IProxyPort, ProxySite } from './proxy/port.js';
import { type IBackoff, Reconciler, type IReconcileReport } from './reconcile.js';
import type {
  GuardState,
  IProviderInfo,
  IRuntimeDescription,
  IRuntimePort,
  IUnitLimits,
  IUnitStatus,
  RuntimeBackend,
} from './runtime/port.js';
import { RuntimePortError } from './runtime/port.js';
import { unitSpecOf } from './unit-spec.js';

export interface IControlPlaneDeps {
  config: IHostConfig;
  store: AccountStore;
  secrets: SecretStore;
  audit: AuditLog;
  runtime: IRuntimePort;
  proxy: IProxyPort;
  now?: () => number;
  backoff?: IBackoff;
}

export interface IAddAccountInput {
  id: string;
  backend: RuntimeBackend;
  provider: IProviderInfo;
  keySource: KeySource;
  /** Required when `keySource` is `account`; stored owner-only and never returned. */
  apiKey?: string;
  limits?: Partial<IUnitLimits>;
}

export interface IAccountView {
  id: string;
  hostname: string;
  url: string;
  backend: RuntimeBackend;
  state: IAccountRecord['state'];
  provider: IProviderInfo;
  keySource: KeySource;
  /** Whether a key is stored for this account; the key itself is never shown. */
  key: 'set' | 'unset';
  limits: IUnitLimits;
  image: string;
  createdAt: string;
  updatedAt: string;
  runtime: IUnitStatus | { state: 'unknown' };
}

export interface IStatusReport {
  runtime: Pick<IRuntimeDescription, 'backend' | 'isolation'> & { guard: GuardState };
  routesHash: string | null;
  baseDomain: string;
  /**
   * Accounts whose stored hostname lies under another domain than the configured one. Reported
   * only: the stored hostname stays authoritative and is never rewritten.
   */
  domainMismatches: Array<{ id: string; hostname: string }>;
  /** Audit writes that failed after their command had completed. */
  audit: { failures: number; last: string | null };
  accounts: Array<{
    id: string;
    desired: IAccountRecord['state'];
    actual: IUnitStatus['state'] | 'absent' | 'unknown';
    healthy: boolean;
  }>;
  /** Units of this install with no record. */
  orphans: string[];
}

const DEFAULT_ACTOR = 'operator';
const DEFAULT_BACKOFF: IBackoff = { baseMs: 2_000, maxMs: 300_000 };

/**
 * The account lifecycle. One operation runs at a time, every command is audited, and a failure
 * leaves nothing half-made: a half-made account is removed, never kept.
 */
export class ControlPlane {
  private queue: Promise<unknown> = Promise.resolve();
  private known: string[] = [];
  private routesHash: string | null = null;
  private routesFailed = false;
  private auditFailures = 0;
  private lastAuditFailure: string | null = null;
  private readonly reconciler: Reconciler;

  constructor(private readonly deps: IControlPlaneDeps) {
    this.reconciler = new Reconciler({
      config: deps.config,
      store: deps.store,
      secrets: deps.secrets,
      runtime: deps.runtime,
      audit: deps.audit,
      applyRoutes: () => this.applyRoutes(),
      routesCurrent: () => this.routesHash !== null && !this.routesFailed,
      now: deps.now ?? Date.now,
      backoff: deps.backoff ?? DEFAULT_BACKOFF,
    });
  }

  // ---- plumbing ----------------------------------------------------------------------------

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private track(secret: string | undefined): void {
    if (secret) this.known.push(secret);
  }

  /** The operation already happened, so an audit failure is surfaced in status, not as a failure. */
  private noteAuditFailure(error: unknown): void {
    this.auditFailures += 1;
    this.lastAuditFailure = scrub(errorMessage(error), this.known);
  }

  private toHostError(error: unknown): HostError {
    if (error instanceof HostError) {
      return new HostError(error.code, scrub(error.message, this.known));
    }
    return new HostError('runtime-failed', scrub(errorMessage(error), this.known));
  }

  private async command<T>(
    name: string,
    account: string | null,
    actor: string,
    task: () => Promise<T>,
  ): Promise<T> {
    return this.exclusive(async () => {
      this.known = [];
      try {
        const result = await task();
        await this.deps.audit
          .append({ actor, command: name, account, result: 'ok', reason: null })
          .catch((error: unknown) => this.noteAuditFailure(error));
        return result;
      } catch (error) {
        const failure = this.toHostError(error);
        await this.deps.audit
          .append({
            actor,
            command: name,
            account,
            result: REFUSAL_CODES.has(failure.code) ? 'refused' : 'failed',
            reason: failure.message,
          })
          .catch(() => undefined);
        throw failure;
      } finally {
        this.known = [];
      }
    });
  }

  private timestamp(): string {
    return new Date((this.deps.now ?? Date.now)()).toISOString();
  }

  private require(id: string): IAccountRecord {
    const record = this.deps.store.get(validateAccountId(id));
    if (!record) throw new HostError('not-found', `No account named ${id}`);
    return record;
  }

  private async requireGuard(): Promise<void> {
    const { guard } = await this.deps.runtime.describe();
    if (guard.state !== 'verified') {
      throw new HostError(
        'guard-unverified',
        `The network guard is not verified${guard.detail ? ` (${guard.detail})` : ''}; refusing to start a unit`,
      );
    }
  }

  private async sites(replacing?: IAccountRecord): Promise<ProxySite[]> {
    const records = this.deps.store.list().filter((r) => r.id !== replacing?.id);
    if (replacing) records.push(replacing);
    const units = new Map((await this.deps.runtime.list()).map((u) => [u.account, u]));
    const sites: ProxySite[] = [];
    for (const record of records) {
      if (record.state === 'provisioning' || record.state === 'deleting') continue;
      if (record.state === 'suspended') {
        sites.push({ kind: 'suspended', hostname: record.hostname });
        continue;
      }
      const unit = units.get(record.id);
      // A unit without a reported address (its slot is outside the pool) cannot be proxied to.
      if (unit?.state === 'running' && unit.endpoints.host !== '') {
        const { host, guiPort, wsPort } = unit.endpoints;
        sites.push({
          kind: 'active',
          hostname: record.hostname,
          guiUpstream: `${host}:${guiPort}`,
          wsUpstream: `${host}:${wsPort}`,
        });
      } else {
        sites.push({ kind: 'unavailable', hostname: record.hostname });
      }
    }
    return sites.sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  private async applyRoutes(replacing?: IAccountRecord): Promise<void> {
    try {
      this.routesHash = (await this.deps.proxy.apply(await this.sites(replacing))).hash;
      this.routesFailed = false;
    } catch (error) {
      this.routesFailed = true;
      throw error;
    }
  }

  private nextSlot(): number {
    const used = new Set(this.deps.store.list().map((r) => r.subnetSlot));
    for (let slot = 0; slot < this.deps.config.subnetPool.slots; slot += 1) {
      if (!used.has(slot)) return slot;
    }
    throw new HostError('refused', 'The subnet pool has no free slot for another account');
  }

  private async removeEverything(record: IAccountRecord): Promise<void> {
    await this.deps.runtime.destroy(record.id);
    await this.deps.secrets.removeAccountKey(record.id);
    await this.deps.store.remove(record.id);
  }

  // ---- commands ----------------------------------------------------------------------------

  /** Finishes accounts a crash left in `provisioning` or `deleting` by removing them. */
  async recover(actor = 'startup'): Promise<string[]> {
    return this.exclusive(async () => {
      const recovered: string[] = [];
      for (const record of this.deps.store.list()) {
        if (record.state !== 'provisioning' && record.state !== 'deleting') continue;
        try {
          await this.removeEverything(record);
          recovered.push(record.id);
          await this.deps.audit.append({
            actor,
            command: 'recover',
            account: record.id,
            result: 'recovered',
            reason: `finished ${record.state} by removal`,
          });
        } catch (error) {
          await this.deps.audit.append({
            actor,
            command: 'recover',
            account: record.id,
            result: 'failed',
            reason: errorMessage(error),
          });
        }
      }
      if (recovered.length > 0) await this.applyRoutes().catch(() => undefined);
      return recovered;
    });
  }

  async add(input: IAddAccountInput, actor = DEFAULT_ACTOR): Promise<IAccountView> {
    const id = typeof input?.id === 'string' ? input.id : null;
    return this.command('add', id, actor, async () => {
      this.track(input.apiKey);
      const accountId = validateAccountId(input.id);
      const backend = validateBackend(input.backend);
      if (backend === 'vm') {
        throw new HostError(
          'refused',
          'The vm backend is not available yet; use the container backend',
        );
      }
      if (!this.deps.config.allowContainer) {
        throw new HostError(
          'refused',
          `The container backend is not allowed for accounts; set ${ALLOW_CONTAINER_SETTING}=true to allow it`,
        );
      }
      const provider = validateProvider(input.provider);
      const keySource = validateKeySource(input.keySource);
      if (keySource === 'account') validateApiKey(input.apiKey);
      else if (input.apiKey !== undefined) {
        throw new HostError(
          'invalid-input',
          'A model key is only accepted with key source account',
        );
      }
      if (keySource === 'operator' && !(await this.deps.secrets.hasOperatorKey())) {
        throw new HostError(
          'refused',
          'Key source operator needs the operator-wide key to be set first',
        );
      }
      const limits = validateLimits({ ...this.deps.config.defaultLimits, ...input.limits });
      if (this.deps.store.get(accountId)) {
        throw new HostError('conflict', `An account named ${accountId} already exists`);
      }
      const description = await this.deps.runtime.describe();
      if (description.backend !== backend) {
        throw new HostError(
          'refused',
          `This host runs the ${description.backend} backend, not ${backend}`,
        );
      }

      const now = this.timestamp();
      const record: IAccountRecord = {
        id: accountId,
        hostname: hostnameFor(accountId, this.deps.config.baseDomain),
        backend,
        state: 'provisioning',
        provider,
        keySource,
        limits,
        subnetSlot: this.nextSlot(),
        image: this.deps.config.unitImage,
        createdAt: now,
        updatedAt: now,
      };
      await this.deps.store.put(record);
      const spec = unitSpecOf(record, this.deps.config, this.deps.store.installId);
      try {
        await this.deps.runtime.provision(spec);
        if (keySource === 'account')
          await this.deps.secrets.writeAccountKey(accountId, input.apiKey ?? '');
        await this.requireGuard();
        const secrets = await this.deps.secrets.resolve(record);
        this.track(secrets.modelApiKey);
        await this.deps.runtime.start(spec, secrets);
        const active: IAccountRecord = { ...record, state: 'active', updatedAt: this.timestamp() };
        await this.applyRoutes(active);
        await this.deps.store.put(active);
        return await this.view(active);
      } catch (error) {
        await this.rollBack(record);
        throw error;
      }
    });
  }

  /** Removes a half-made account. If the unit cannot be removed, the record stays for recovery. */
  private async rollBack(record: IAccountRecord): Promise<void> {
    try {
      await this.removeEverything(record);
    } catch (error) {
      throw new HostError(
        'runtime-failed',
        `Adding ${record.id} failed and cleanup is incomplete (${errorMessage(error)}); ` +
          'the account stays in provisioning and is removed at the next start',
      );
    }
    await this.applyRoutes().catch(() => undefined);
  }

  async suspend(id: string, actor = DEFAULT_ACTOR): Promise<IAccountView> {
    return this.command('suspend', id, actor, async () => {
      const record = this.require(id);
      if (record.state === 'provisioning' || record.state === 'deleting') {
        throw new HostError('busy', `Account ${id} is ${record.state}`);
      }
      const suspended: IAccountRecord = {
        ...record,
        state: 'suspended',
        updatedAt: this.timestamp(),
      };
      await this.deps.store.put(suspended);
      await this.applyRoutes();
      await this.deps.runtime.stop(id).catch((error: unknown) => {
        if (error instanceof RuntimePortError && error.code === 'unknown-account') return;
        throw error;
      });
      return this.view(suspended);
    });
  }

  async resume(id: string, actor = DEFAULT_ACTOR): Promise<IAccountView> {
    return this.command('resume', id, actor, async () => {
      const record = this.require(id);
      if (record.state === 'provisioning' || record.state === 'deleting') {
        throw new HostError('busy', `Account ${id} is ${record.state}`);
      }
      await this.requireGuard();
      const secrets = await this.deps.secrets.resolve(record);
      this.track(secrets.modelApiKey);
      const spec = unitSpecOf(record, this.deps.config, this.deps.store.installId);
      await this.deps.runtime.provision(spec);
      await this.deps.runtime.start(spec, secrets);
      const active: IAccountRecord = { ...record, state: 'active', updatedAt: this.timestamp() };
      await this.deps.store.put(active);
      await this.applyRoutes();
      return this.view(active);
    });
  }

  async delete(id: string, confirmation: string, actor = DEFAULT_ACTOR): Promise<void> {
    return this.command('delete', id, actor, async () => {
      const record = this.require(id);
      if (confirmation !== record.id) {
        throw new HostError(
          'confirmation-required',
          `Deleting ${record.id} wipes its state; repeat the account id as the confirmation`,
        );
      }
      await this.deps.store.put({ ...record, state: 'deleting', updatedAt: this.timestamp() });
      await this.applyRoutes();
      await this.removeEverything(record);
    });
  }

  async accessCode(id: string, actor = DEFAULT_ACTOR): Promise<string> {
    return this.command('access-code', id, actor, async () => {
      const record = this.require(id);
      if (record.state === 'provisioning' || record.state === 'deleting') {
        throw new HostError('busy', `Account ${id} is ${record.state}`);
      }
      return (await this.deps.runtime.accessCode(id)).code;
    });
  }

  async list(actor = DEFAULT_ACTOR): Promise<IAccountView[]> {
    return this.command('list', null, actor, async () => {
      const units = new Map((await this.deps.runtime.list()).map((u) => [u.account, u]));
      return Promise.all(this.deps.store.list().map((r) => this.view(r, units.get(r.id))));
    });
  }

  async show(id: string, actor = DEFAULT_ACTOR): Promise<IAccountView> {
    return this.command('show', id, actor, async () => this.view(this.require(id)));
  }

  async status(actor = DEFAULT_ACTOR): Promise<IStatusReport> {
    return this.command('status', null, actor, async () => {
      const description = await this.deps.runtime.describe();
      const units = new Map((await this.deps.runtime.list()).map((u) => [u.account, u]));
      const records = this.deps.store.list();
      const recorded = new Set(records.map((r) => r.id));
      return {
        runtime: {
          backend: description.backend,
          isolation: description.isolation,
          guard: description.guard.state,
        },
        routesHash: this.routesHash,
        baseDomain: this.deps.config.baseDomain,
        domainMismatches: records
          .filter((r) => r.hostname !== hostnameFor(r.id, this.deps.config.baseDomain))
          .map((r) => ({ id: r.id, hostname: r.hostname })),
        audit: { failures: this.auditFailures, last: this.lastAuditFailure },
        accounts: records.map((r) => {
          const unit = units.get(r.id);
          return {
            id: r.id,
            desired: r.state,
            actual: unit ? unit.state : 'absent',
            healthy: unit?.healthy ?? false,
          };
        }),
        orphans: [...units.keys()].filter((account) => !recorded.has(account)).sort(),
      };
    });
  }

  /** One reconcile pass: re-verify the guard, restart what should run, report strays. */
  async reconcile(): Promise<IReconcileReport> {
    return this.exclusive(() => this.reconciler.pass());
  }

  private async view(record: IAccountRecord, unit?: IUnitStatus): Promise<IAccountView> {
    let runtime: IAccountView['runtime'] = unit ?? { state: 'unknown' };
    if (!unit) {
      try {
        runtime = await this.deps.runtime.inspect(record.id);
      } catch {
        runtime = { state: 'unknown' };
      }
    }
    const hasKey =
      record.keySource === 'account'
        ? await this.deps.secrets.hasAccountKey(record.id)
        : record.keySource === 'operator' && (await this.deps.secrets.hasOperatorKey());
    return {
      id: record.id,
      hostname: record.hostname,
      url: publicOrigin(this.deps.config, record.hostname),
      backend: record.backend,
      state: record.state,
      provider: record.provider,
      keySource: record.keySource,
      key: hasKey ? 'set' : 'unset',
      limits: record.limits,
      image: record.image,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      runtime,
    };
  }
}
