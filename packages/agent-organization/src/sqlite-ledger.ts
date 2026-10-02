import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import { organizationCanonical, organizationOperationDigest } from './canonical.js';
import { OrganizationRefused } from './types.js';
import { noEffectReason } from './no-effect.js';
import { gitParameters } from './git-asset.js';
import type { OrganizationGitAsset, IOrganizationGitIntent } from './git-asset.js';
import { OrganizationSharedStateSql } from './shared-state.js';
import { OrganizationLedgerIntegrity } from './ledger-anchor.js';
import type { IOrganizationLedgerAnchor } from './ledger-anchor.js';
import type { IOrganizationStateLease, IOrganizationStateValue } from './shared-state.js';
import type { TOrganizationNoEffectReason } from './no-effect.js';
import type { ISqlDatabase, ISqlModule } from './sql.js';
import {
  approvalClaims,
  budget,
  currentTime,
  grantClaims,
  identifier,
  integer,
  publicKey,
  receipt as receiptClaims,
  record,
  requestClaims,
  units,
  verifyEnvelope,
} from './verification.js';
import type {
  IOrganizationApproval,
  IOrganizationBudget,
  IOrganizationEnvelope,
  IOrganizationGrant,
  IOrganizationReceipt,
  IOrganizationRequest,
  IOrganizationUnits,
  TOrganizationJson,
} from './types.js';

const UNIT_KEYS = ['tokens', 'timeMs', 'costMicros'] as const;

export interface IOrganizationLedgerOptions {
  readonly path: string;
  /** Explicit first-time bootstrap. Reopen/missing/corrupt policy never initializes empty authority. */
  readonly create?: boolean;
  /** Owner-controlled v1/v2-to-v3 schema upgrade; close existing brokers first. Preserves all authority/accounting. */
  readonly upgrade?: boolean;
  readonly audience: string;
  readonly workloadPublicKey: string;
  readonly approvalPublicKey: string;
  readonly now?: () => number;
  readonly maxGrantTtlMs?: number;
  readonly maxRequestTtlMs?: number;
  /** Independently retained owner checkpoint; hosted organization composition requires it. */
  readonly anchor?: IOrganizationLedgerAnchor;
}

interface IOperationRow {
  readonly digest: string;
  readonly grantId: string;
  readonly status: string;
  readonly scopes: readonly string[];
  readonly reservation: IOrganizationUnits;
  readonly receipt: IOrganizationReceipt | null;
}

export type TOrganizationReservation =
  | {
      readonly kind: 'reserved';
      readonly digest: string;
      readonly grant: IOrganizationGrant;
      readonly reservation: IOrganizationUnits;
    }
  | {
      readonly kind: 'complete';
      readonly digest: string;
      readonly receipt: IOrganizationReceipt;
    }
  | {
      readonly kind: 'refused';
      readonly digest: string;
      readonly reason: TOrganizationNoEffectReason;
    };

function scopeKey(kind: 'global' | 'tenant' | 'task' | 'grant', ...parts: string[]): string {
  const arity = { global: 0, tenant: 1, task: 2, grant: 1 }[kind];
  if (arity === undefined || parts.length !== arity)
    throw new OrganizationRefused('invalid-schema');
  return organizationCanonical([kind, ...parts]);
}

/** Durable policy/budgets live in the operator's domain, never in a worker checkpoint. */
export class OrganizationLedger {
  private readonly db: ISqlDatabase;
  private readonly state: OrganizationSharedStateSql;
  private readonly path: string;
  private readonly inode: { ino: number; dev: number };
  private closed = false;
  private readonly now: () => number;
  private readonly workloadKey;
  private readonly approvalKey;
  private readonly integrity?: OrganizationLedgerIntegrity;
  readonly audience: string;
  readonly maxGrantTtlMs: number;
  readonly maxRequestTtlMs: number;

  constructor(options: IOrganizationLedgerOptions) {
    if (options.anchor !== undefined && options.upgrade === true)
      throw new OrganizationRefused('policy-unavailable');
    this.audience = identifier(options.audience);
    this.workloadKey = publicKey(options.workloadPublicKey);
    this.approvalKey = publicKey(options.approvalPublicKey);
    if (
      this.workloadKey
        .export({ type: 'spki', format: 'der' })
        .equals(this.approvalKey.export({ type: 'spki', format: 'der' }))
    )
      throw new OrganizationRefused('invalid-schema');
    this.now = options.now ?? Date.now;
    this.maxGrantTtlMs = integer(options.maxGrantTtlMs ?? 300_000, 1);
    this.maxRequestTtlMs = integer(options.maxRequestTtlMs ?? 30_000, 1);
    if (!isAbsolute(options.path)) throw new OrganizationRefused('policy-unavailable');
    let opened: ISqlDatabase | undefined;
    try {
      const directory = realpathSync(dirname(options.path));
      const root = lstatSync(directory);
      const uid = process.getuid?.();
      if (
        !root.isDirectory() ||
        (root.mode & 0o077) !== 0 ||
        (uid !== undefined && root.uid !== uid)
      )
        throw new Error('unowned directory');
      this.path = join(directory, basename(options.path));
      if (options.create === true) {
        closeSync(
          openSync(
            this.path,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
            0o600,
          ),
        );
      }
      const file = lstatSync(this.path);
      if (
        !file.isFile() ||
        file.nlink !== 1 ||
        (file.mode & 0o077) !== 0 ||
        (uid !== undefined && file.uid !== uid)
      )
        throw new Error('unowned database');
      this.inode = { ino: file.ino, dev: file.dev };
      if (options.create !== true) this.verifyFile();
      // The optional runtime capability fails closed; there is no memory or JSON-file fallback.
      const requireFrom = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Node-only optional storage runtime
      const sqlite = requireFrom('node:sqlite') as ISqlModule;
      this.db = new sqlite.DatabaseSync(this.path, {
        allowExtension: false,
        enableDoubleQuotedStringLiterals: false,
      });
      opened = this.db;
      this.state = new OrganizationSharedStateSql(this.db);
      this.db.exec(
        'PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;',
      );
      if (options.create === true) {
        this.db.exec(`
          CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, epoch INTEGER NOT NULL, active INTEGER NOT NULL) STRICT;
          INSERT INTO metadata VALUES (1,3,1,1);
          CREATE TABLE budgets (key TEXT PRIMARY KEY, limits TEXT NOT NULL, spent TEXT NOT NULL, held TEXT NOT NULL, active INTEGER NOT NULL, stopped INTEGER NOT NULL) STRICT;
          CREATE TABLE grants (id TEXT PRIMARY KEY, claims TEXT NOT NULL, revoked INTEGER NOT NULL) STRICT;
          CREATE TABLE nonces (tenant TEXT NOT NULL, actor TEXT NOT NULL, nonce TEXT NOT NULL, PRIMARY KEY(tenant,actor,nonce)) STRICT;
          CREATE TABLE approvals (id TEXT PRIMARY KEY, digest TEXT NOT NULL) STRICT;
          CREATE TABLE operations (key TEXT PRIMARY KEY, digest TEXT NOT NULL, grantId TEXT NOT NULL, status TEXT NOT NULL, scopes TEXT NOT NULL, reservation TEXT NOT NULL, receipt TEXT) STRICT;
        `);
        this.state.initialize();
        this.initializeGit();
      }
      let metadata = this.db.prepare('SELECT version FROM metadata WHERE id=1').get();
      if ([1, 2].includes(Number(metadata?.version)) && options.upgrade === true) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          const current = this.db.prepare('SELECT version FROM metadata WHERE id=1').get();
          if (current?.version === 1) this.state.initialize();
          if (current?.version === 1 || current?.version === 2) {
            this.initializeGit();
            this.db.exec('UPDATE metadata SET version=3 WHERE id=1');
          } else if (current?.version !== 3) throw new Error('unsupported database');
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
        metadata = this.db.prepare('SELECT version FROM metadata WHERE id=1').get();
      }
      if (
        metadata?.version !== 3 ||
        this.db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok'
      )
        throw new Error('invalid database');
      this.db
        .prepare('SELECT key,value,revision,fence,holder,epoch,expiresAt FROM shared_state LIMIT 0')
        .all();
      this.db.prepare('SELECT digest,grantId,value FROM state_effects LIMIT 0').all();
      this.db.prepare('SELECT digest,grantId,value FROM git_intents LIMIT 0').all();
      if (options.anchor !== undefined) {
        this.integrity = new OrganizationLedgerIntegrity(this.db, options.anchor);
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.integrity.initialize(options.create === true);
          this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      }
    } catch {
      try {
        opened?.close();
      } catch {
        /* Refusal remains refusal even if a failed bootstrap cannot close. */
      }
      throw new OrganizationRefused('policy-unavailable');
    }
  }

  private initializeGit(): void {
    this.db.exec(
      'CREATE TABLE git_intents (digest TEXT PRIMARY KEY, grantId TEXT NOT NULL, value TEXT NOT NULL) STRICT;',
    );
  }

  private verifyFile(): void {
    const descriptor = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const file = fstatSync(descriptor);
      const uid = process.getuid?.();
      const header = Buffer.alloc(16);
      if (
        !file.isFile() ||
        file.ino !== this.inode.ino ||
        file.dev !== this.inode.dev ||
        file.nlink !== 1 ||
        (file.mode & 0o077) !== 0 ||
        (uid !== undefined && file.uid !== uid) ||
        readSync(descriptor, header, 0, 16, 0) !== 16 ||
        !header.equals(Buffer.from('SQLite format 3\u0000'))
      )
        throw new Error('changed database');
    } finally {
      closeSync(descriptor);
    }
  }

  private transaction<T>(action: () => T): T {
    if (this.closed) throw new OrganizationRefused('policy-unavailable');
    try {
      this.verifyFile();
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const checkpoint = this.integrity?.verify();
        const result = action();
        if (checkpoint !== undefined) this.integrity!.advance(checkpoint);
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      if (error instanceof OrganizationRefused) throw error;
      throw new OrganizationRefused('policy-unavailable');
    }
  }

  private metadata(): { epoch: number; active: boolean } {
    const row = this.db.prepare('SELECT version,epoch,active FROM metadata WHERE id=1').get();
    if (row === undefined || row.version !== 3) throw new OrganizationRefused('policy-unavailable');
    if (row.active !== 0 && row.active !== 1) throw new OrganizationRefused('policy-unavailable');
    return { epoch: integer(row.epoch, 1), active: row.active === 1 };
  }

  private newBudget(key: string, limits: IOrganizationBudget): void {
    budget(limits);
    if (this.db.prepare('SELECT key FROM budgets WHERE key=?').get(key) !== undefined)
      throw new OrganizationRefused('operation-conflict');
    const zero = organizationCanonical({ tokens: 0, timeMs: 0, costMicros: 0 });
    this.db
      .prepare('INSERT INTO budgets VALUES (?,?,?,?,0,0)')
      .run(key, organizationCanonical(limits), zero, zero);
  }

  /** Trusted administration only; these methods are not present on the HTTP broker ingress. */
  createGlobalBudget(limits: IOrganizationBudget): void {
    this.transaction(() => this.newBudget(scopeKey('global'), limits));
  }
  createTenant(tenant: string, limits: IOrganizationBudget): void {
    identifier(tenant);
    this.transaction(() => {
      this.liveBudget(scopeKey('global'));
      this.newBudget(scopeKey('tenant', tenant), limits);
    });
  }
  createTask(tenant: string, task: string, limits: IOrganizationBudget): void {
    identifier(tenant);
    identifier(task);
    this.transaction(() => {
      this.liveBudget(scopeKey('tenant', tenant));
      this.newBudget(scopeKey('task', tenant, task), limits);
    });
  }

  registerGrant(envelope: IOrganizationEnvelope<IOrganizationGrant>): void {
    const grant = grantClaims(envelope.claims);
    verifyEnvelope('workload', envelope, this.workloadKey);
    this.transaction(() => {
      const metadata = this.metadata();
      currentTime(grant, this.now(), this.maxGrantTtlMs);
      if (!metadata.active || metadata.epoch !== grant.epoch || grant.audience !== this.audience)
        throw new OrganizationRefused('revoked');
      this.liveBudget(scopeKey('global'));
      this.liveBudget(scopeKey('tenant', grant.tenant));
      this.liveBudget(scopeKey('task', grant.tenant, grant.task));
      if (grant.parent !== null) {
        const parent = this.chain(grant.parent)[0]!;
        if (
          parent.tenant !== grant.tenant ||
          parent.task !== grant.task ||
          parent.audience !== grant.audience ||
          parent.role !== grant.role ||
          parent.notBefore > grant.notBefore ||
          parent.expiresAt < grant.expiresAt ||
          UNIT_KEYS.some((key) => grant.budget[key] > parent.budget[key]) ||
          grant.budget.concurrency > parent.budget.concurrency ||
          grant.scopes.some((scope) => {
            const inherited = parent.scopes.find(
              (candidate) => candidate.resource === scope.resource,
            );
            return (
              inherited === undefined ||
              scope.operations.some((operation) => !inherited.operations.includes(operation))
            );
          })
        )
          throw new OrganizationRefused('not-authorized');
      }
      if (this.db.prepare('SELECT id FROM grants WHERE id=?').get(grant.id))
        throw new OrganizationRefused('operation-conflict');
      this.db
        .prepare('INSERT INTO grants VALUES (?,?,0)')
        .run(grant.id, organizationCanonical(grant));
      this.newBudget(scopeKey('grant', grant.id), grant.budget);
    });
  }

  private chain(grantId: string): IOrganizationGrant[] {
    const metadata = this.metadata();
    if (!metadata.active) throw new OrganizationRefused('revoked');
    const grants: IOrganizationGrant[] = [];
    const seen = new Set<string>();
    let id: string | null = grantId;
    while (id !== null) {
      if (seen.has(id) || seen.size >= 32) throw new OrganizationRefused('policy-unavailable');
      seen.add(id);
      const row = this.db.prepare('SELECT claims,revoked FROM grants WHERE id=?').get(id);
      if (row === undefined || row.revoked !== 0 || typeof row.claims !== 'string')
        throw new OrganizationRefused('revoked');
      const grant = grantClaims(JSON.parse(row.claims));
      currentTime(grant, this.now(), this.maxGrantTtlMs);
      if (grant.epoch !== metadata.epoch || grant.audience !== this.audience)
        throw new OrganizationRefused('revoked');
      this.liveBudget(scopeKey('grant', grant.id));
      grants.push(grant);
      id = grant.parent;
    }
    const leaf = grants[0]!;
    this.liveBudget(scopeKey('global'));
    this.liveBudget(scopeKey('tenant', leaf.tenant));
    this.liveBudget(scopeKey('task', leaf.tenant, leaf.task));
    return grants;
  }

  currentGrant(grantId: string): IOrganizationGrant {
    return this.transaction(() => this.chain(identifier(grantId))[0]!);
  }

  /** Owner inventory inspection, including expired/revoked grants; never grants execution authority. */
  registeredGrant(grantId: string): IOrganizationGrant {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT claims FROM grants WHERE id=?').get(identifier(grantId));
      if (typeof row?.claims !== 'string') throw new OrganizationRefused('not-authorized');
      return grantClaims(JSON.parse(row.claims));
    });
  }

  /** Trusted supervisory accounting for an owner-installed single-purpose workload grant. */
  grantOperationCount(grantId: string): number {
    return this.transaction(() => {
      this.chain(identifier(grantId));
      const row = this.db.prepare('SELECT COUNT(*) AS count FROM operations WHERE grantId=?').get(grantId);
      return integer(row?.count);
    });
  }

  /** Owner composition can require integrity rather than silently accepting legacy SDK mode. */
  verifyAnchoredAuthority(): void {
    if (this.integrity === undefined) throw new OrganizationRefused('policy-unavailable');
    this.transaction(() => undefined);
  }

  private authenticateInside(envelope: IOrganizationEnvelope<IOrganizationRequest>): {
    request: IOrganizationRequest;
    grant: IOrganizationGrant;
    grants: IOrganizationGrant[];
  } {
    const request = requestClaims(envelope.claims);
    const grants = this.chain(request.grantId);
    const grant = grants[0]!;
    verifyEnvelope('request', envelope, publicKey(grant.publicKey));
    currentTime(request, this.now(), this.maxRequestTtlMs);
    if (request.notBefore < grant.notBefore || request.expiresAt > grant.expiresAt)
      throw new OrganizationRefused('expired');
    if (
      request.tenant !== grant.tenant ||
      request.task !== grant.task ||
      request.actor !== grant.actor ||
      request.audience !== grant.audience ||
      request.epoch !== grant.epoch ||
      !grant.scopes.some(
        (scope) =>
          scope.resource === request.operation.resource &&
          scope.operations.includes(request.operation.operation),
      )
    )
      throw new OrganizationRefused('not-authorized');
    return { request, grant, grants };
  }

  authenticate(envelope: IOrganizationEnvelope<IOrganizationRequest>): {
    request: IOrganizationRequest;
    grant: IOrganizationGrant;
  } {
    return this.transaction(() => this.authenticateInside(envelope));
  }

  /** Owner administration only; state creation cannot overwrite an existing resource or its fence. */
  createStateResource(
    tenant: string,
    task: string,
    resource: string,
    value: TOrganizationJson,
  ): void {
    this.transaction(() => {
      this.liveBudget(scopeKey('global'));
      this.liveBudget(scopeKey('tenant', identifier(tenant)));
      this.liveBudget(scopeKey('task', tenant, identifier(task)));
      this.state.create(tenant, task, resource, value);
    });
  }

  private activeOperation(envelope: IOrganizationEnvelope<IOrganizationRequest>): {
    request: IOrganizationRequest;
    grant: IOrganizationGrant;
  } {
    const result = this.authenticateInside(envelope);
    const operation = this.operation(this.key(result.request));
    if (
      operation === undefined ||
      operation.status !== 'running' ||
      operation.digest !== organizationOperationDigest(result.request) ||
      operation.grantId !== result.grant.id
    )
      throw new OrganizationRefused('operation-conflict');
    return result;
  }

  private stateOperation<T>(
    envelope: IOrganizationEnvelope<IOrganizationRequest>,
    action: (request: IOrganizationRequest, grant: IOrganizationGrant) => T,
  ): T {
    return this.transaction(() => {
      const { request, grant } = this.activeOperation(envelope);
      const digest = organizationOperationDigest(request);
      if (this.db.prepare('SELECT digest FROM state_effects WHERE digest=?').get(digest))
        throw new OrganizationRefused('outcome-unknown');
      const result = action(request, grant);
      this.db
        .prepare('INSERT INTO state_effects VALUES (?,?,?)')
        .run(digest, grant.id, organizationCanonical(result));
      return result;
    });
  }

  leaseState(envelope: IOrganizationEnvelope<IOrganizationRequest>): IOrganizationStateLease {
    return this.stateOperation(envelope, (request, grant) =>
      this.state.lease(request, grant, this.now()),
    );
  }
  readState(envelope: IOrganizationEnvelope<IOrganizationRequest>): IOrganizationStateValue {
    return this.stateOperation(envelope, (request) => this.state.read(request));
  }
  writeState(envelope: IOrganizationEnvelope<IOrganizationRequest>): IOrganizationStateValue {
    return this.stateOperation(envelope, (request, grant) =>
      this.state.write(request, grant, this.now()),
    );
  }

  /** Trusted Git owner only. Persist an unreachable receipt intent before any target ref can change. */
  prepareGitPublication(
    envelope: IOrganizationEnvelope<IOrganizationRequest>,
    asset: OrganizationGitAsset,
  ): IOrganizationGitIntent {
    return this.transaction(() => {
      const { request, grant } = this.activeOperation(envelope);
      if (request.operation.operation !== 'git.publish')
        throw new OrganizationRefused('not-authorized');
      const params = gitParameters(request.operation.parameters);
      const value = record(
        this.state.assertFence(request, grant, this.now(), params.expectedRevision, params.fence),
        ['oid'],
      );
      if (value.oid !== params.expectedOid) throw new OrganizationRefused('operation-conflict');
      const digest = organizationOperationDigest(request);
      if (this.db.prepare('SELECT digest FROM git_intents WHERE digest=?').get(digest))
        throw new OrganizationRefused('outcome-unknown');
      const intent = asset.prepare(digest, params);
      this.db
        .prepare('INSERT INTO git_intents VALUES (?,?,?)')
        .run(digest, grant.id, organizationCanonical(intent));
      return intent;
    });
  }

  private gitIntent(
    request: IOrganizationRequest,
    asset: OrganizationGitAsset,
  ): IOrganizationGitIntent {
    const digest = organizationOperationDigest(request);
    const row = this.db.prepare('SELECT grantId,value FROM git_intents WHERE digest=?').get(digest);
    if (row === undefined) throw new OrganizationRefused('outcome-unknown');
    if (row.grantId !== request.grantId || typeof row.value !== 'string')
      throw new OrganizationRefused('policy-unavailable');
    const data = record(JSON.parse(row.value), [
      'asset',
      'digest',
      'expectedRevision',
      'fence',
      'expectedOid',
      'candidateOid',
      'publishedOid',
    ]);
    const params = gitParameters(request.operation.parameters);
    if (
      request.operation.operation !== 'git.publish' ||
      data.digest !== digest ||
      data.asset !== asset.identity ||
      Object.entries(params).some(([key, value]) => data[key] !== value) ||
      typeof data.publishedOid !== 'string'
    )
      throw new OrganizationRefused('operation-conflict');
    return data as unknown as IOrganizationGitIntent;
  }

  /** SQL locking serializes policy/fence checks with dispatch. External Git and SQL are NOT an atomic store. */
  commitGitPublication(
    envelope: IOrganizationEnvelope<IOrganizationRequest>,
    asset: OrganizationGitAsset,
  ): IOrganizationStateValue {
    return this.stateOperation(envelope, (request, grant) => {
      const intent = this.gitIntent(request, asset);
      const value = record(
        this.state.assertFence(request, grant, this.now(), intent.expectedRevision, intent.fence),
        ['oid'],
      );
      if (value.oid !== intent.expectedOid) throw new OrganizationRefused('operation-conflict');
      asset.publish(intent);
      // A failure from this point is an unknown foreign effect, never proof of rollback.
      return this.state.replace(request, { oid: intent.publishedOid });
    });
  }

  /** Owner-only proof of a past branch publication. No absent effect is refunded, no workload authority is restored. */
  reconcileGitPublication(
    value: IOrganizationRequest,
    asset: OrganizationGitAsset,
  ): IOrganizationReceipt {
    const request = requestClaims(value);
    this.transaction(() => {
      const operation = this.operation(this.key(request));
      const digest = organizationOperationDigest(request);
      if (
        operation === undefined ||
        operation.digest !== digest ||
        operation.grantId !== request.grantId ||
        !['running', 'unknown', 'complete'].includes(operation.status)
      )
        throw new OrganizationRefused('operation-conflict');
      const intent = this.gitIntent(request, asset);
      if (!asset.wasPublished(intent)) throw new OrganizationRefused('outcome-unknown');
      const recorded = this.db
        .prepare('SELECT digest FROM state_effects WHERE digest=?')
        .get(digest);
      if (recorded === undefined) {
        const result = this.state.recoverGit(
          request,
          intent.expectedRevision,
          intent.expectedOid,
          intent.publishedOid,
        );
        this.db
          .prepare('INSERT INTO state_effects VALUES (?,?,?)')
          .run(digest, request.grantId, organizationCanonical(result));
      }
    });
    return this.reconcileStateOperation(request);
  }

  /** Trusted asset-owner reconciliation only. The atomic state outcome proves this specific effect; no worker route exposes it. */
  reconcileStateOperation(value: IOrganizationRequest): IOrganizationReceipt {
    const request = requestClaims(value);
    const outcome = this.transaction(() => {
      const operation = this.operation(this.key(request));
      const digest = organizationOperationDigest(request);
      if (
        operation === undefined ||
        operation.grantId !== request.grantId ||
        operation.digest !== digest
      )
        throw new OrganizationRefused('operation-conflict');
      if (operation.status === 'complete' && operation.receipt !== null)
        return { complete: operation.receipt };
      if (!['running', 'unknown'].includes(operation.status))
        throw new OrganizationRefused('operation-conflict');
      const effect = this.db
        .prepare('SELECT grantId,value FROM state_effects WHERE digest=?')
        .get(digest);
      if (effect === undefined) throw new OrganizationRefused('outcome-unknown');
      if (effect.grantId !== request.grantId || typeof effect.value !== 'string')
        throw new OrganizationRefused('policy-unavailable');
      // Unknown elapsed instrumentation is charged conservatively to the reserved bound, never refunded speculatively.
      return {
        receipt: receiptClaims({
          value: JSON.parse(effect.value),
          usage: operation.reservation,
        }),
      };
    });
    if (outcome.complete !== undefined) return outcome.complete;
    this.recordReceipt(request, outcome.receipt!, 'complete', true);
    return outcome.receipt!;
  }

  private liveBudget(key: string): {
    limits: IOrganizationBudget;
    spent: IOrganizationUnits;
    held: IOrganizationUnits;
    active: number;
  } {
    const state = this.storedBudget(key);
    if (state.stopped) throw new OrganizationRefused('revoked');
    return state;
  }

  private storedBudget(key: string): {
    limits: IOrganizationBudget;
    spent: IOrganizationUnits;
    held: IOrganizationUnits;
    active: number;
    stopped: boolean;
  } {
    const row = this.db.prepare('SELECT * FROM budgets WHERE key=?').get(key);
    if (
      row === undefined ||
      (row.stopped !== 0 && row.stopped !== 1) ||
      typeof row.limits !== 'string' ||
      typeof row.spent !== 'string' ||
      typeof row.held !== 'string'
    )
      throw new OrganizationRefused('revoked');
    return {
      limits: budget(JSON.parse(row.limits)),
      spent: units(JSON.parse(row.spent)),
      held: units(JSON.parse(row.held)),
      active: integer(row.active),
      stopped: row.stopped === 1,
    };
  }

  private operation(key: string): IOperationRow | undefined {
    const row = this.db.prepare('SELECT * FROM operations WHERE key=?').get(key);
    if (row === undefined) return undefined;
    if (
      typeof row.digest !== 'string' ||
      typeof row.grantId !== 'string' ||
      typeof row.status !== 'string' ||
      typeof row.scopes !== 'string' ||
      typeof row.reservation !== 'string'
    )
      throw new OrganizationRefused('policy-unavailable');
    const scopes: unknown = JSON.parse(row.scopes);
    if (
      !Array.isArray(scopes) ||
      scopes.length < 4 ||
      scopes.some((scope) => typeof scope !== 'string') ||
      new Set(scopes).size !== scopes.length ||
      !['running', 'unknown', 'complete', 'refused'].includes(row.status) ||
      !/^[a-f0-9]{64}$/.test(row.digest)
    )
      throw new OrganizationRefused('policy-unavailable');
    return {
      digest: row.digest,
      grantId: row.grantId,
      status: row.status,
      scopes: scopes as string[],
      reservation: units(JSON.parse(row.reservation)),
      receipt: typeof row.receipt === 'string' ? receiptClaims(JSON.parse(row.receipt)) : null,
    };
  }

  reserve(
    envelope: IOrganizationEnvelope<IOrganizationRequest>,
    reservation: IOrganizationUnits,
    approval: IOrganizationEnvelope<IOrganizationApproval> | null,
    requiresApproval: boolean,
  ): TOrganizationReservation {
    units(reservation);
    return this.transaction(() => {
      const { request, grant, grants } = this.authenticateInside(envelope);
      const digest = organizationOperationDigest(request);
      const nonce = this.db
        .prepare('SELECT nonce FROM nonces WHERE tenant=? AND actor=? AND nonce=?')
        .get(request.tenant, request.actor, request.nonce);
      if (nonce !== undefined) throw new OrganizationRefused('replayed');
      const key =
        scopeKey('task', grant.tenant, grant.task) + ':' + request.operation.idempotencyKey;
      const previous = this.operation(key);
      if (previous !== undefined) {
        if (previous.digest !== digest || previous.grantId !== grant.id)
          throw new OrganizationRefused('operation-conflict');
        if (!['complete', 'refused'].includes(previous.status) || previous.receipt === null)
          throw new OrganizationRefused(
            previous.status === 'unknown' ? 'outcome-unknown' : 'operation-pending',
          );
        this.db
          .prepare('INSERT INTO nonces VALUES (?,?,?)')
          .run(request.tenant, request.actor, request.nonce);
        if (previous.status === 'refused') {
          const value = record(previous.receipt.value, ['refused']);
          return {
            kind: 'refused',
            digest,
            reason: noEffectReason(value.refused),
          };
        }
        return { kind: 'complete', digest, receipt: previous.receipt };
      }
      if (requiresApproval && approval === null) throw new OrganizationRefused('approval-required');
      if (approval !== null) {
        try {
          verifyEnvelope('approval', approval, this.approvalKey);
          const claims = approvalClaims(approval.claims);
          currentTime(claims, this.now(), this.maxGrantTtlMs);
          if (
            claims.tenant !== grant.tenant ||
            claims.task !== grant.task ||
            claims.actor !== grant.actor ||
            claims.audience !== grant.audience ||
            claims.epoch !== grant.epoch ||
            claims.environment !== request.operation.environment ||
            claims.operationDigest !== digest
          )
            throw new OrganizationRefused('approval-invalid');
          if (this.db.prepare('SELECT id FROM approvals WHERE id=?').get(claims.id))
            throw new OrganizationRefused('approval-reused');
          this.db.prepare('INSERT INTO approvals VALUES (?,?)').run(claims.id, digest);
        } catch (error) {
          if (error instanceof OrganizationRefused && error.reason === 'approval-reused')
            throw error;
          throw new OrganizationRefused('approval-invalid');
        }
      }
      const scopes = [
        scopeKey('global'),
        scopeKey('tenant', grant.tenant),
        scopeKey('task', grant.tenant, grant.task),
        ...grants.map((item) => scopeKey('grant', item.id)),
      ];
      for (const scope of scopes) {
        const state = this.liveBudget(scope);
        if (
          state.active >= state.limits.concurrency ||
          UNIT_KEYS.some(
            (unit) => reservation[unit] > state.limits[unit] - state.spent[unit] - state.held[unit],
          )
        )
          throw new OrganizationRefused('budget-exhausted');
        const held = Object.fromEntries(
          UNIT_KEYS.map((unit) => [unit, state.held[unit] + reservation[unit]]),
        );
        this.db
          .prepare('UPDATE budgets SET held=?,active=active+1 WHERE key=?')
          .run(organizationCanonical(held), scope);
      }
      this.db
        .prepare('INSERT INTO nonces VALUES (?,?,?)')
        .run(request.tenant, request.actor, request.nonce);
      this.db
        .prepare("INSERT INTO operations VALUES (?,?,?,'running',?,?,NULL)")
        .run(
          key,
          digest,
          grant.id,
          organizationCanonical(scopes),
          organizationCanonical(reservation),
        );
      return {
        kind: 'reserved',
        digest,
        grant,
        reservation: Object.freeze({ ...reservation }),
      };
    });
  }

  private key(request: IOrganizationRequest): string {
    return scopeKey('task', request.tenant, request.task) + ':' + request.operation.idempotencyKey;
  }

  /** A crash/unknown effect keeps every reservation. No request route can refund or retry it. */
  markUnknown(request: IOrganizationRequest): void {
    this.transaction(() => {
      const key = this.key(request);
      const row = this.operation(key);
      if (
        row === undefined ||
        row.digest !== organizationOperationDigest(request) ||
        !['running', 'unknown'].includes(row.status)
      )
        throw new OrganizationRefused('operation-conflict');
      this.db.prepare("UPDATE operations SET status='unknown' WHERE key=?").run(key);
    });
  }

  settle(request: IOrganizationRequest, receipt: IOrganizationReceipt): void {
    this.recordReceipt(request, receipt, 'complete');
  }

  /** External asset owner only: confirm an exact unknown effect, charge its retained bound, never restore authority. */
  reconcileExternalOperation(value: IOrganizationRequest, confirmedValue: TOrganizationJson): IOrganizationReceipt {
    const request = requestClaims(value);
    const outcome = this.transaction(() => {
      const row = this.operation(this.key(request));
      const digest = organizationOperationDigest(request);
      if (!row || row.digest !== digest ||
        this.db.prepare('SELECT digest FROM state_effects WHERE digest=?').get(digest) ||
        this.db.prepare('SELECT digest FROM git_intents WHERE digest=?').get(digest))
        throw new OrganizationRefused('operation-conflict');
      if (row.status === 'complete' && row.receipt !== null) {
        if (organizationCanonical(row.receipt.value) !== organizationCanonical(confirmedValue))
          throw new OrganizationRefused('operation-conflict');
        return { cached: row.receipt };
      }
      if (!['running', 'unknown'].includes(row.status)) throw new OrganizationRefused('operation-conflict');
      return { receipt: receiptClaims({ value: confirmedValue, usage: row.reservation }) };
    });
    if (outcome.cached) return outcome.cached;
    this.recordReceipt(request, outcome.receipt!, 'complete', true);
    return outcome.receipt!;
  }

  /** Trusted asset owner only: a proved no-effect outcome, never a worker-provided refund assertion. */
  confirmNoEffect(
    request: IOrganizationRequest,
    reason: TOrganizationNoEffectReason,
    usage: IOrganizationUnits,
  ): void {
    this.recordReceipt(request, { value: { refused: noEffectReason(reason) }, usage }, 'refused');
  }

  private recordReceipt(
    request: IOrganizationRequest,
    receipt: IOrganizationReceipt,
    status: 'complete' | 'refused',
    allowUnknown = false,
  ): void {
    const validReceipt = receiptClaims(receipt);
    const usage = validReceipt.usage;
    const encoded = organizationCanonical(validReceipt);
    this.transaction(() => {
      const key = this.key(request);
      const row = this.operation(key);
      if (
        row === undefined ||
        row.digest !== organizationOperationDigest(request) ||
        (row.status !== 'running' && !(allowUnknown && row.status === 'unknown'))
      )
        throw new OrganizationRefused('operation-conflict');
      if (UNIT_KEYS.some((unit) => usage[unit] > row.reservation[unit]))
        throw new OrganizationRefused('outcome-unknown');
      if (
        status === 'refused' &&
        (this.db.prepare('SELECT digest FROM state_effects WHERE digest=?').get(row.digest) ||
          this.db.prepare('SELECT digest FROM git_intents WHERE digest=?').get(row.digest))
      )
        throw new OrganizationRefused('outcome-unknown');
      for (const scope of row.scopes) {
        // Stop/revoke never releases accounting; known completion still records actual usage.
        const stored = this.db
          .prepare('SELECT spent,held,active FROM budgets WHERE key=?')
          .get(scope);
        if (
          stored === undefined ||
          typeof stored.spent !== 'string' ||
          typeof stored.held !== 'string'
        )
          throw new OrganizationRefused('policy-unavailable');
        const spent = units(JSON.parse(stored.spent));
        const held = units(JSON.parse(stored.held));
        integer(stored.active, 1);
        const nextSpent = Object.fromEntries(
          UNIT_KEYS.map((unit) => [unit, integer(spent[unit] + usage[unit])]),
        );
        const nextHeld = Object.fromEntries(
          UNIT_KEYS.map((unit) => [unit, integer(held[unit] - row.reservation[unit])]),
        );
        this.db
          .prepare('UPDATE budgets SET spent=?,held=?,active=active-1 WHERE key=?')
          .run(organizationCanonical(nextSpent), organizationCanonical(nextHeld), scope);
      }
      this.db
        .prepare('UPDATE operations SET status=?,receipt=? WHERE key=?')
        .run(status, encoded, key);
    });
  }

  revokeGrant(grantId: string): void {
    this.transaction(() => {
      this.db.prepare('UPDATE grants SET revoked=1 WHERE id=?').run(identifier(grantId));
    });
  }
  stopTask(tenant: string, task: string): void {
    this.transaction(() => {
      this.db
        .prepare('UPDATE budgets SET stopped=1 WHERE key=?')
        .run(scopeKey('task', identifier(tenant), identifier(task)));
    });
  }
  stopTenant(tenant: string): void {
    this.transaction(() => {
      this.db
        .prepare('UPDATE budgets SET stopped=1 WHERE key=?')
        .run(scopeKey('tenant', identifier(tenant)));
    });
  }
  emergencyStop(): void {
    this.transaction(() => {
      this.db.exec('UPDATE metadata SET active=0,epoch=epoch+1 WHERE id=1');
    });
  }
  advanceEpoch(epoch: number): void {
    integer(epoch, 1);
    this.transaction(() => {
      if (epoch <= this.metadata().epoch) throw new OrganizationRefused('operation-conflict');
      this.db.prepare('UPDATE metadata SET epoch=? WHERE id=1').run(epoch);
    });
  }
  budgetState(
    kind: 'global' | 'tenant' | 'task' | 'grant',
    ...identity: string[]
  ): {
    limits: IOrganizationBudget;
    spent: IOrganizationUnits;
    held: IOrganizationUnits;
    active: number;
    stopped: boolean;
  } {
    return this.transaction(() => this.storedBudget(scopeKey(kind, ...identity.map(identifier))));
  }
  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.db.close();
    }
  }
}
