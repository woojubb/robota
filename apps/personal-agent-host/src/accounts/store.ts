import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { HostError } from '../errors.js';
import { assertOwnerOnly, ensurePrivateDir, isNotFound, writeFileAtomic } from '../fs-util.js';
import type { IAccountRecord } from './types.js';
import { parseAccountRecord } from './validate.js';

const STORE_VERSION = 2;
const INSTALL_ID = /^[a-f0-9]{8}$/u;

interface IStoreFile {
  version: typeof STORE_VERSION;
  /** Generated once; prefixes every object the engine holds for this install. */
  installId: string;
  accounts: IAccountRecord[];
}

function parseStore(text: string, path: string): IStoreFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HostError('store-corrupt', `${path} is not valid JSON; refusing to use it`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new HostError('store-corrupt', `${path} must hold an object`);
  }
  const file = raw as Record<string, unknown>;
  if (file.version !== STORE_VERSION) {
    throw new HostError('store-corrupt', `${path} has an unsupported version`);
  }
  if (typeof file.installId !== 'string' || !INSTALL_ID.test(file.installId)) {
    throw new HostError('store-corrupt', `${path} has an invalid install id`);
  }
  if (!Array.isArray(file.accounts)) {
    throw new HostError('store-corrupt', `${path} must hold an accounts list`);
  }
  const accounts = file.accounts.map((entry, index) =>
    parseAccountRecord(entry, `${path} accounts[${index}]`),
  );
  const seen = new Set<string>();
  const slots = new Set<number>();
  for (const account of accounts) {
    for (const key of [account.id, account.hostname]) {
      if (seen.has(key)) throw new HostError('store-corrupt', `${path} repeats ${key}`);
      seen.add(key);
    }
    if (slots.has(account.subnetSlot)) {
      throw new HostError('store-corrupt', `${path} repeats subnet slot ${account.subnetSlot}`);
    }
    slots.add(account.subnetSlot);
  }
  return { version: STORE_VERSION, installId: file.installId, accounts };
}

/** Account records in one owner-only file, written atomically and checked on every load. */
export class AccountStore {
  private constructor(
    private readonly path: string,
    private file: IStoreFile,
  ) {}

  static async open(stateDir: string): Promise<AccountStore> {
    await ensurePrivateDir(stateDir);
    const path = join(stateDir, 'accounts.json');
    try {
      await assertOwnerOnly(path, 'Account store');
      const file = parseStore(await readFile(path, 'utf8'), path);
      return new AccountStore(path, file);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const store = new AccountStore(path, {
      version: STORE_VERSION,
      installId: randomBytes(4).toString('hex'),
      accounts: [],
    });
    await store.persist(store.file);
    return store;
  }

  get installId(): string {
    return this.file.installId;
  }

  list(): IAccountRecord[] {
    return this.file.accounts.map((a) => structuredClone(a));
  }

  get(id: string): IAccountRecord | undefined {
    const found = this.file.accounts.find((a) => a.id === id);
    return found ? structuredClone(found) : undefined;
  }

  /** Inserts or replaces a record. The in-memory view changes only after the file is on disk. */
  async put(record: IAccountRecord): Promise<void> {
    const accounts = this.file.accounts.filter((a) => a.id !== record.id);
    accounts.push(structuredClone(record));
    accounts.sort((a, b) => a.id.localeCompare(b.id));
    await this.persist({ ...this.file, accounts });
  }

  async remove(id: string): Promise<void> {
    const accounts = this.file.accounts.filter((a) => a.id !== id);
    if (accounts.length === this.file.accounts.length) return;
    await this.persist({ ...this.file, accounts });
  }

  private async persist(next: IStoreFile): Promise<void> {
    await writeFileAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`);
    this.file = next;
  }
}
