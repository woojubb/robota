import { createHash } from 'node:crypto';
import { OrganizationRefused } from './types.js';
import { identifier, integer } from './verification.js';
import type { ISqlDatabase, TSqlValue } from './sql.js';

export interface IOrganizationLedgerHead {
  readonly version: 1;
  readonly ledger: string;
  readonly revision: number;
  readonly digest: string;
}

/** Trusted owner capability outside the mutable policy store and every worker checkpoint. */
export interface IOrganizationLedgerAnchor {
  readonly ledger: string;
  /** Consistent authenticated read of independently retained authority state. */
  read(): IOrganizationLedgerHead | undefined;
  /** Atomic, durable CAS; confirmation must be readable before this call returns. */
  compareAndSet(expected: IOrganizationLedgerHead | undefined, next: IOrganizationLedgerHead): void;
}

const tables = [
  ['metadata', 'id'], ['budgets', 'key'], ['grants', 'id'],
  ['nonces', 'tenant,actor,nonce'], ['approvals', 'id'], ['operations', 'key'],
  ['shared_state', 'key'], ['state_effects', 'digest'], ['git_intents', 'digest'],
] as const;

/** Hash typed, length-delimited fields without exposing policy, parameters or receipts to the anchor. */
function digest(db: ISqlDatabase, ledger: string): string {
  const hash = createHash('sha256');
  const field = (value: TSqlValue): void => {
    if (typeof value === 'number' && !Number.isSafeInteger(value))
      throw new OrganizationRefused('policy-unavailable');
    const bytes = Buffer.from(value === null ? '' : String(value));
    hash.update(`${value === null ? 'null' : typeof value}:${bytes.length}:`).update(bytes);
  };
  field('robota/organization-ledger-anchor/v1'); field(ledger);
  for (const [table, order] of tables) {
    field(table);
    const schema = db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(table);
    if (typeof schema?.sql !== 'string') throw new OrganizationRefused('policy-unavailable');
    field(schema.sql);
    // SQL identifiers are a closed source-owned schema, never input from the port or a worker.
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
    field(rows.length);
    for (const row of rows) {
      const keys = Object.keys(row).sort();
      field(keys.length);
      for (const key of keys) { field(key); field(row[key]!); }
    }
  }
  return hash.digest('hex');
}

/** Anchor advances before SQLite commit; uncertain confirmation freezes authority rather than refunds it. */
export class OrganizationLedgerIntegrity {
  private readonly ledger: string;
  private readonly port: IOrganizationLedgerAnchor;

  constructor(private readonly db: ISqlDatabase, port: IOrganizationLedgerAnchor) {
    this.ledger = identifier(port.ledger);
    if (typeof port.read !== 'function' || typeof port.compareAndSet !== 'function')
      throw new OrganizationRefused('policy-unavailable');
    this.port = Object.freeze({ ledger: this.ledger, read: port.read.bind(port), compareAndSet: port.compareAndSet.bind(port) });
  }

  private read(): IOrganizationLedgerHead | undefined {
    const head = this.port.read();
    if (head === undefined) return undefined;
    if (head === null || Object.keys(head).sort().join(',') !== 'digest,ledger,revision,version' ||
      head.version !== 1 || head.ledger !== this.ledger || typeof head.digest !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(head.digest)) throw new OrganizationRefused('policy-unavailable');
    return Object.freeze({ version: 1, ledger: this.ledger, revision: integer(head.revision, 1), digest: head.digest });
  }

  initialize(create: boolean): void {
    if (!create) { this.verify(); return; }
    if (this.read() !== undefined) throw new OrganizationRefused('policy-unavailable');
    this.commit(undefined, { version: 1, ledger: this.ledger, revision: 1, digest: digest(this.db, this.ledger) });
  }

  verify(): IOrganizationLedgerHead {
    const head = this.read();
    if (head === undefined || head.digest !== digest(this.db, this.ledger))
      throw new OrganizationRefused('policy-unavailable');
    return head;
  }

  advance(previous: IOrganizationLedgerHead): void {
    const nextDigest = digest(this.db, this.ledger);
    if (nextDigest === previous.digest) return;
    this.commit(previous, { version: 1, ledger: this.ledger,
      revision: integer(previous.revision + 1, 1), digest: nextDigest });
  }

  private commit(expected: IOrganizationLedgerHead | undefined, next: IOrganizationLedgerHead): void {
    this.port.compareAndSet(expected, Object.freeze(next));
    const confirmed = this.read();
    if (confirmed?.revision !== next.revision || confirmed.digest !== next.digest)
      throw new OrganizationRefused('policy-unavailable');
  }
}
