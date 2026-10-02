import { organizationCanonical } from './canonical.js';
import { OrganizationRefused } from './types.js';
import { identifier, integer, record } from './verification.js';
import type { ISqlDatabase } from './sql.js';
import type { IOrganizationGrant, IOrganizationRequest, TOrganizationJson } from './types.js';

export interface IOrganizationStateLease {
  readonly revision: number;
  readonly fence: number;
  readonly expiresAt: number;
}

export interface IOrganizationStateValue {
  readonly revision: number;
  readonly value: TOrganizationJson;
}

/** Internal SQLite owner: every call is made inside the ledger's authenticated operation transaction. */
export class OrganizationSharedStateSql {
  constructor(private readonly db: ISqlDatabase) {}

  initialize(): void {
    this.db.exec(`CREATE TABLE shared_state (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, revision INTEGER NOT NULL, fence INTEGER NOT NULL,
      holder TEXT, epoch INTEGER NOT NULL, expiresAt INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE state_effects (digest TEXT PRIMARY KEY, grantId TEXT NOT NULL, value TEXT NOT NULL) STRICT;`);
  }

  private key(tenant: string, task: string, resource: string): string {
    return organizationCanonical([identifier(tenant), identifier(task), identifier(resource)]);
  }

  create(tenant: string, task: string, resource: string, value: TOrganizationJson): void {
    const key = this.key(tenant, task, resource);
    if (this.db.prepare('SELECT key FROM shared_state WHERE key=?').get(key))
      throw new OrganizationRefused('operation-conflict');
    this.db
      .prepare('INSERT INTO shared_state VALUES (?,?,0,0,NULL,0,0)')
      .run(key, organizationCanonical(value));
  }

  private row(request: IOrganizationRequest): {
    key: string;
    value: TOrganizationJson;
    revision: number;
    fence: number;
    holder: string | null;
    epoch: number;
    expiresAt: number;
  } {
    const key = this.key(request.tenant, request.task, request.operation.resource);
    const row = this.db.prepare('SELECT * FROM shared_state WHERE key=?').get(key);
    if (row === undefined) throw new OrganizationRefused('not-authorized');
    if (typeof row.value !== 'string' || (row.holder !== null && typeof row.holder !== 'string'))
      throw new OrganizationRefused('policy-unavailable');
    const value: unknown = JSON.parse(row.value);
    organizationCanonical(value);
    return {
      key,
      value: value as TOrganizationJson,
      revision: integer(row.revision),
      fence: integer(row.fence),
      holder: row.holder,
      epoch: integer(row.epoch),
      expiresAt: integer(row.expiresAt),
    };
  }

  lease(
    request: IOrganizationRequest,
    grant: IOrganizationGrant,
    now: number,
  ): IOrganizationStateLease {
    if (request.operation.operation !== 'state.lease')
      throw new OrganizationRefused('not-authorized');
    const parameters = record(request.operation.parameters, ['expectedRevision', 'ttlMs']);
    const revision = integer(parameters.expectedRevision);
    const ttl = integer(parameters.ttlMs, 1);
    if (ttl > 30_000) throw new OrganizationRefused('invalid-schema');
    const expiresAt = integer(now + ttl, 1);
    if (expiresAt > request.expiresAt || expiresAt > grant.expiresAt)
      throw new OrganizationRefused('expired');
    const row = this.row(request);
    if (revision !== row.revision) throw new OrganizationRefused('operation-conflict');
    if (row.holder !== null && row.epoch === grant.epoch && row.expiresAt > now)
      throw new OrganizationRefused('operation-pending');
    const fence = integer(row.fence + 1, 1);
    this.db
      .prepare('UPDATE shared_state SET fence=?,holder=?,epoch=?,expiresAt=? WHERE key=?')
      .run(fence, grant.id, grant.epoch, expiresAt, row.key);
    return Object.freeze({ revision, fence, expiresAt });
  }

  read(request: IOrganizationRequest): IOrganizationStateValue {
    if (request.operation.operation !== 'state.read')
      throw new OrganizationRefused('not-authorized');
    record(request.operation.parameters, []);
    const row = this.row(request);
    return Object.freeze({ revision: row.revision, value: row.value });
  }

  write(
    request: IOrganizationRequest,
    grant: IOrganizationGrant,
    now: number,
  ): IOrganizationStateValue {
    if (request.operation.operation !== 'state.write')
      throw new OrganizationRefused('not-authorized');
    const parameters = record(request.operation.parameters, ['expectedRevision', 'fence', 'value']);
    this.assertFence(
      request,
      grant,
      now,
      integer(parameters.expectedRevision),
      integer(parameters.fence, 1),
    );
    return this.replace(request, parameters.value as TOrganizationJson);
  }

  assertFence(
    request: IOrganizationRequest,
    grant: IOrganizationGrant,
    now: number,
    revision: number,
    fence: number,
  ): TOrganizationJson {
    const row = this.row(request);
    if (
      row.holder !== grant.id ||
      row.epoch !== grant.epoch ||
      row.fence !== fence ||
      row.expiresAt <= now ||
      row.revision !== revision
    )
      throw new OrganizationRefused('operation-conflict');
    return row.value;
  }

  replace(request: IOrganizationRequest, value: TOrganizationJson): IOrganizationStateValue {
    const row = this.row(request);
    const encoded = organizationCanonical(value);
    const revision = integer(row.revision + 1, 1);
    this.db
      .prepare('UPDATE shared_state SET value=?,revision=? WHERE key=?')
      .run(encoded, revision, row.key);
    return Object.freeze({ revision, value: JSON.parse(encoded) as TOrganizationJson });
  }

  recoverGit(
    request: IOrganizationRequest,
    expectedRevision: number,
    expectedOid: string,
    publishedOid: string,
  ): IOrganizationStateValue {
    const row = this.row(request);
    const value = record(row.value, ['oid']);
    if (row.revision !== expectedRevision || value.oid !== expectedOid)
      throw new OrganizationRefused('operation-conflict');
    // A new live lease on the old revision cannot overwrite this proved past publication.
    return this.replace(request, { oid: publishedOid });
  }
}
