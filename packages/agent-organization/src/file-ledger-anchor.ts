import { constants, closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { organizationCanonical } from './canonical.js';
import { OrganizationRefused } from './types.js';
import { identifier } from './verification.js';
import type { IOrganizationLedgerAnchor, IOrganizationLedgerHead } from './ledger-anchor.js';

/** Owner-selected independent custody directory. Never include it in a worker or authority-store backup. */
export class OrganizationFileLedgerAnchor implements IOrganizationLedgerAnchor {
  readonly ledger: string;
  private readonly directory: string;
  private readonly file: string;
  private readonly lock: string;

  constructor(options: { readonly directory: string; readonly ledger: string }) {
    this.ledger = identifier(options.ledger);
    if (!isAbsolute(options.directory)) throw new OrganizationRefused('policy-unavailable');
    this.directory = realpathSync(options.directory);
    const stat = lstatSync(this.directory);
    if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 ||
      (process.getuid !== undefined && stat.uid !== process.getuid()))
      throw new OrganizationRefused('policy-unavailable');
    this.file = join(this.directory, 'head.json');
    this.lock = join(this.directory, 'head.lock');
  }

  read(): IOrganizationLedgerHead | undefined {
    let fd: number | undefined;
    try {
      fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077) !== 0 ||
        (process.getuid !== undefined && stat.uid !== process.getuid()))
        throw new OrganizationRefused('policy-unavailable');
      const value: unknown = JSON.parse(readFileSync(fd, 'utf8'));
      this.validate(value as IOrganizationLedgerHead);
      return Object.freeze({ ...value as IOrganizationLedgerHead });
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined;
      throw new OrganizationRefused('policy-unavailable');
    } finally { if (fd !== undefined) closeSync(fd); }
  }

  private validate(head: IOrganizationLedgerHead): void {
    if (!head || Object.keys(head).sort().join(',') !== 'digest,ledger,revision,version' ||
      head.version !== 1 || head.ledger !== this.ledger || !Number.isSafeInteger(head.revision) ||
      head.revision < 1 || typeof head.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(head.digest))
      throw new OrganizationRefused('policy-unavailable');
  }

  compareAndSet(expected: IOrganizationLedgerHead | undefined, next: IOrganizationLedgerHead): void {
    this.validate(next);
    if (expected !== undefined) this.validate(expected);
    if (next.revision !== (expected?.revision ?? 0) + 1)
      throw new OrganizationRefused('policy-unavailable');
    let locked = false;
    let temporary: string | undefined;
    try {
      // A crash-held lock requires owner reconciliation. Never guess that a lock is stale.
      mkdirSync(this.lock, { mode: 0o700 });
      locked = true;
      const current = this.read();
      if ((current === undefined) !== (expected === undefined) ||
        (current !== undefined && organizationCanonical(current) !== organizationCanonical(expected)))
        throw new OrganizationRefused('policy-unavailable');
      temporary = join(this.directory, `head-${randomUUID()}.tmp`);
      const fd = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(fd, organizationCanonical(next)); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(temporary, this.file);
      temporary = undefined;
      const directory = openSync(this.directory, constants.O_RDONLY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } catch { throw new OrganizationRefused('policy-unavailable'); }
    finally {
      if (temporary !== undefined) { try { unlinkSync(temporary); } catch { /* Preserve uncertain evidence for the owner. */ } }
      if (locked) rmdirSync(this.lock);
    }
  }
}
