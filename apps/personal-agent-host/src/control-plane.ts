import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

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
import type { ISpoolFile, Spool } from './archive/spool.js';
import {
  ArchiveError,
  archiveSize,
  archiveStream,
  type IBackupManifest,
  stateEntries,
  storeState,
  verifyArchive,
} from './archive/state-archive.js';
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
  spool: Spool;
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
  imageId: string;
  createdAt: string;
  updatedAt: string;
  runtime: IUnitStatus | { state: 'unknown' };
}

export interface IUpgradeResult {
  /** The image id the configured unit image resolves to now. */
  target: string;
  moved: Array<{ id: string; from: string }>;
  /** Accounts already running the target image. */
  current: string[];
  /** Accounts not touched, with the reason (a suspended account cannot be proven healthy). */
  skipped: Array<{ id: string; reason: string }>;
}

/** A finished backup waiting to be read; the reader must call `release` when done with it. */
export interface IBackupHandle {
  manifest: IBackupManifest;
  /** The archive's byte length, known before it is streamed. */
  size: number;
  stream(): AsyncIterable<Buffer>;
  release(): Promise<void>;
}

export interface IRestoreResult {
  account: string;
  /** What the archive said about itself. */
  from: IBackupManifest;
  /** Whether the unit was running and has been started again. */
  restarted: boolean;
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
    imageId: string;
  }>;
  /** Units of this install with no record. */
  orphans: string[];
}

const DEFAULT_ACTOR = 'operator';

function names(ids: readonly string[]): string {
  return ids.length === 0 ? 'none' : ids.join(', ');
}
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
    await this.releaseIfUnused(record.imageId);
  }

  /** Best effort: an image that cannot be released only costs disk. */
  private async releaseIfUnused(imageId: string): Promise<void> {
    if (this.deps.store.list().some((r) => r.imageId === imageId)) return;
    await this.deps.runtime.releaseImage(imageId).catch(() => undefined);
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
        imageId: await this.deps.runtime.resolveImage(this.deps.config.unitImage),
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

  /**
   * Moves one account, or every account, to the image the configured unit image names now. The new
   * image is recorded only after its unit is healthy; otherwise the unit is started again from the
   * previous image and the command fails, so nothing is left half-upgraded.
   */
  async upgrade(target: string | { all: true }, actor = DEFAULT_ACTOR): Promise<IUpgradeResult> {
    const single = typeof target === 'string' ? target : null;
    return this.command('upgrade', single, actor, async () => {
      const records = single === null ? this.deps.store.list() : [this.require(single)];
      const result: IUpgradeResult = {
        target: await this.deps.runtime.resolveImage(this.deps.config.unitImage),
        moved: [],
        current: [],
        skipped: [],
      };
      for (const record of records) {
        if (record.state === 'provisioning' || record.state === 'deleting') {
          throw new HostError('busy', `Account ${record.id} is ${record.state}`);
        }
        if (record.state === 'suspended') {
          if (single !== null) {
            throw new HostError(
              'refused',
              `Account ${record.id} is suspended; resume it first, so the new image can be proven healthy`,
            );
          }
          result.skipped.push({ id: record.id, reason: 'suspended; resume it first' });
          continue;
        }
        if (record.imageId === result.target) {
          result.current.push(record.id);
          continue;
        }
        try {
          await this.moveToImage(record, result.target);
        } catch (error) {
          await this.applyRoutes().catch(() => undefined);
          if (single !== null) throw error;
          throw new HostError(
            error instanceof HostError ? error.code : 'runtime-failed',
            `${errorMessage(error)}. Stopped there; moved: ${names(result.moved.map((m) => m.id))}; ` +
              `skipped: ${names(result.skipped.map((s) => s.id))}; failed: ${record.id}`,
          );
        }
        // The unit was down and may have been served as unavailable meanwhile; routes follow state.
        await this.applyRoutes().catch(() => undefined);
        result.moved.push({ id: record.id, from: record.imageId });
      }
      return result;
    });
  }

  private async moveToImage(record: IAccountRecord, imageId: string): Promise<void> {
    await this.requireGuard();
    const secrets = await this.deps.secrets.resolve(record);
    this.track(secrets.modelApiKey);
    const previous = unitSpecOf(record, this.deps.config, this.deps.store.installId);
    const next = { ...previous, image: imageId };
    try {
      await this.deps.runtime.stop(record.id).catch((error: unknown) => {
        if (error instanceof RuntimePortError && error.code === 'unknown-account') return;
        throw error;
      });
      await this.deps.runtime.provision(next);
      await this.deps.runtime.start(next, secrets);
      await this.deps.store.put({ ...record, imageId, updatedAt: this.timestamp() });
      await this.releaseIfUnused(record.imageId);
    } catch (error) {
      const reason = errorMessage(error);
      // The image that failed was retained when its start was tried; nothing is recorded on it.
      await this.releaseIfUnused(imageId);
      try {
        await this.deps.runtime.stop(record.id).catch(() => undefined);
        await this.deps.runtime.provision(previous);
        await this.deps.runtime.start(previous, secrets);
      } catch (rollback) {
        throw new HostError(
          'runtime-failed',
          `Upgrading ${record.id} failed (${reason}) and the previous image could not be started ` +
            `again (${errorMessage(rollback)}); the account is recorded on the previous image and ` +
            'the reconcile loop keeps retrying it',
        );
      }
      throw new HostError(
        'runtime-failed',
        `Upgrading ${record.id} failed (${reason}); the previous image is running again`,
      );
    }
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

  private archiveLimits(): { maxBytes: number } {
    return { maxBytes: this.deps.config.backupMaxBytes };
  }

  /** Copies a runtime's state archive to a file as it is, refusing one past the backup limit. */
  private async copyOut(archive: AsyncIterable<Uint8Array>, path: string): Promise<void> {
    const { maxBytes } = this.archiveLimits();
    let size = 0;
    await pipeline(
      archive,
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > maxBytes) {
            throw new HostError(
              'refused',
              `The state is larger than the backup limit of ${maxBytes} bytes; raise PERSONAL_AGENT_HOST_BACKUP_MAX_BYTES`,
            );
          }
          yield chunk;
        }
      },
      createWriteStream(path, { flags: 'wx', mode: 0o600 }),
    );
  }

  private async stopUnit(id: string): Promise<void> {
    await this.deps.runtime.stop(id).catch((error: unknown) => {
      if (error instanceof RuntimePortError && error.code === 'unknown-account') return;
      throw error;
    });
  }

  /**
   * Runs `work` with the account's unit stopped, then starts it again from the recorded image if it
   * was meant to run (guard first, health checked). A suspended account stays suspended. If the
   * unit cannot be started again and `putBack` is given (the work replaced state), the previous
   * state is put back and the unit started once more; either way the account stays recorded active,
   * so the reconcile loop keeps trying, and the failure says what was left.
   */
  private async whileStopped<T>(
    record: IAccountRecord,
    work: () => Promise<T>,
    putBack?: () => Promise<void>,
  ): Promise<T> {
    const wasActive = record.state === 'active';
    const spec = unitSpecOf(record, this.deps.config, this.deps.store.installId);
    let secrets: Awaited<ReturnType<SecretStore['resolve']>> | undefined;
    if (wasActive) {
      await this.requireGuard();
      secrets = await this.deps.secrets.resolve(record);
      this.track(secrets.modelApiKey);
      await this.stopUnit(record.id);
    }
    let result: T | undefined;
    let failure: unknown;
    try {
      result = await work();
    } catch (error) {
      failure = error;
    }
    if (wasActive) {
      const start = async (): Promise<void> => {
        await this.deps.runtime.provision(spec);
        await this.deps.runtime.start(spec, secrets ?? {});
      };
      try {
        await start();
      } catch (error) {
        const note = await this.recoverStart(record.id, error, failure, start, putBack);
        await this.applyRoutes().catch(() => undefined);
        throw new HostError('runtime-failed', note);
      }
    }
    await this.applyRoutes().catch(() => undefined);
    if (failure !== undefined) throw failure;
    return result as T;
  }

  private async recoverStart(
    id: string,
    startError: unknown,
    failure: unknown,
    start: () => Promise<void>,
    putBack: (() => Promise<void>) | undefined,
  ): Promise<string> {
    const first = `The unit of ${id} could not be started again (${errorMessage(startError)})`;
    if (failure !== undefined) {
      return `${first}; the operation itself failed first: ${errorMessage(failure)}. The account stays active and the reconcile loop keeps trying`;
    }
    if (putBack === undefined) {
      return `${first}; the account stays active and the reconcile loop keeps trying`;
    }
    try {
      await this.stopUnit(id);
      await putBack();
    } catch (error) {
      return `${first}, and the previous state could not be put back (${errorMessage(error)}); the account stays active and its state is incomplete, so restore a backup again`;
    }
    try {
      await start();
    } catch (error) {
      return `${first}; the previous state is back but the unit does not start from it either (${errorMessage(error)}); the account stays active and the reconcile loop keeps trying`;
    }
    return `${first}; the previous state is back and the unit is running again`;
  }

  /**
   * Takes a consistent copy of an account's state: the unit is stopped, its state read and checked
   * into a private file, the unit started again, and only then is the archive handed over. If the
   * unit cannot be started again the command fails and no archive is handed over.
   */
  async backup(id: string, actor = DEFAULT_ACTOR): Promise<IBackupHandle> {
    return this.command('backup', id, actor, async () => {
      const record = this.require(id);
      if (record.state === 'provisioning' || record.state === 'deleting') {
        throw new HostError('busy', `Account ${id} is ${record.state}`);
      }
      const spec = unitSpecOf(record, this.deps.config, this.deps.store.installId);
      const file = this.deps.spool.file('backup');
      try {
        const stored = await this.whileStopped(record, async () => {
          try {
            return await storeState(
              await this.deps.runtime.exportState(spec),
              file.path,
              this.archiveLimits(),
            );
          } catch (error) {
            if (error instanceof ArchiveError) throw new HostError('refused', error.message);
            throw error;
          }
        });
        const fields = {
          account: record.id,
          hostname: record.hostname,
          imageId: record.imageId,
          createdAt: this.timestamp(),
        };
        const handle: IBackupHandle = {
          manifest: {
            format: 1,
            ...fields,
            contentSha256: stored.contentSha256,
            entries: stored.entries,
            bytes: stored.bytes,
          },
          size: archiveSize(stored, fields),
          stream: () => archiveStream(file.path, stored, fields),
          release: () => file.remove(),
        };
        return handle;
      } catch (error) {
        await file.remove();
        throw error;
      }
    });
  }

  /** Receives an upload into a private file, refusing one past the backup limit. Not a command. */
  async stageUpload(source: AsyncIterable<Uint8Array>): Promise<ISpoolFile> {
    const file = this.deps.spool.file('upload');
    const { maxBytes } = this.archiveLimits();
    let size = 0;
    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            size += chunk.length;
            if (size > maxBytes) {
              throw new HostError(
                'invalid-input',
                `The archive is larger than the limit of ${maxBytes} bytes`,
              );
            }
            yield chunk;
          }
        },
        createWriteStream(file.path, { flags: 'wx', mode: 0o600 }),
      );
      return file;
    } catch (error) {
      await file.remove();
      throw error;
    }
  }

  /**
   * Replaces an account's state with a backup. The archive is checked in full first; then the unit
   * is stopped, today's state copied aside, the backup put in place and the unit started again. A
   * failure at any step puts the previous state back, so the account is never left half-restored.
   * The stored key is kept: a backup never holds one.
   */
  async restore(
    id: string,
    upload: ISpoolFile,
    options: { fromOtherAccount: boolean },
    actor = DEFAULT_ACTOR,
  ): Promise<IRestoreResult> {
    return this.command('restore', id, actor, async () => {
      const record = this.require(id);
      if (record.state === 'provisioning' || record.state === 'deleting') {
        throw new HostError('busy', `Account ${id} is ${record.state}`);
      }
      let manifest: IBackupManifest;
      try {
        manifest = await verifyArchive(upload.path, this.archiveLimits());
      } catch (error) {
        if (error instanceof ArchiveError) {
          throw new HostError('invalid-input', `The archive is refused: ${error.message}`);
        }
        throw error;
      }
      if (manifest.account !== record.id && !options.fromOtherAccount) {
        throw new HostError(
          'refused',
          `This backup is of account ${manifest.account}, not ${record.id}; ` +
            "restoring another account's state needs --from-other-account",
        );
      }
      const spec = unitSpecOf(record, this.deps.config, this.deps.store.installId);
      const previous = this.deps.spool.file('previous');
      const putBack = async (): Promise<void> => {
        await this.deps.runtime.importState(spec, createReadStream(previous.path));
      };
      try {
        await this.whileStopped(
          record,
          async () => {
            await this.deps.runtime.provision(spec);
            await this.copyOut(await this.deps.runtime.exportState(spec), previous.path);
            try {
              await this.deps.runtime.importState(spec, stateEntries(upload.path));
            } catch (error) {
              const outcome = await putBack().then(
                () => 'the previous state is back in place',
                (back: unknown) =>
                  `the previous state could not be put back either (${errorMessage(back)}); the account's state is incomplete, so restore a backup again`,
              );
              throw new HostError(
                'runtime-failed',
                `Restoring ${id} failed (${errorMessage(error)}); ${outcome}`,
              );
            }
          },
          putBack,
        );
      } finally {
        await previous.remove();
      }
      return { account: record.id, from: manifest, restarted: record.state === 'active' };
    });
  }

  async accessCode(id: string, actor = DEFAULT_ACTOR): Promise<string> {
    return this.command('access-code', id, actor, async () => {
      const record = this.require(id);
      if (record.state === 'provisioning' || record.state === 'deleting') {
        throw new HostError('busy', `Account ${id} is ${record.state}`);
      }
      const spec = unitSpecOf(record, this.deps.config, this.deps.store.installId);
      return (await this.deps.runtime.accessCode(spec)).code;
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
            imageId: r.imageId,
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
      imageId: record.imageId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      runtime,
    };
  }
}
