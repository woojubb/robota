import { access, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { HostError } from '../errors.js';
import { assertOwnerOnly, ensurePrivateDir, isNotFound, writeFileAtomic } from '../fs-util.js';
import type { IUnitSecrets } from '../runtime/port.js';
import type { IAccountRecord } from './types.js';
import { validateAccountId, validateApiKey } from './validate.js';

const SECRET_VERSION = 1;

/**
 * Model keys, one owner-only file per account, apart from the account records so that listing and
 * showing accounts never loads one. A key is read only to start that account's unit.
 */
export class SecretStore {
  private constructor(private readonly dir: string) {}

  static async open(stateDir: string): Promise<SecretStore> {
    const dir = join(stateDir, 'secrets');
    await ensurePrivateDir(dir);
    return new SecretStore(dir);
  }

  private accountPath(id: string): string {
    return join(this.dir, `${validateAccountId(id)}.json`);
  }

  private operatorPath(): string {
    return join(this.dir, '..', 'operator-key.json');
  }

  private async write(path: string, modelApiKey: string): Promise<void> {
    validateApiKey(modelApiKey);
    await writeFileAtomic(path, `${JSON.stringify({ version: SECRET_VERSION, modelApiKey })}\n`);
  }

  private async read(path: string, label: string): Promise<string | undefined> {
    let text: string;
    try {
      await assertOwnerOnly(path, label);
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HostError('store-corrupt', `${label} is not valid JSON`);
    }
    const file = raw as { version?: unknown; modelApiKey?: unknown } | null;
    if (!file || file.version !== SECRET_VERSION || typeof file.modelApiKey !== 'string') {
      throw new HostError('store-corrupt', `${label} is malformed`);
    }
    return file.modelApiKey;
  }

  async writeAccountKey(id: string, key: string): Promise<void> {
    await this.write(this.accountPath(id), key);
  }

  async readAccountKey(id: string): Promise<string | undefined> {
    return this.read(this.accountPath(id), `Secret file for ${id}`);
  }

  async hasAccountKey(id: string): Promise<boolean> {
    try {
      await access(this.accountPath(id));
      return true;
    } catch {
      return false;
    }
  }

  async removeAccountKey(id: string): Promise<void> {
    try {
      await unlink(this.accountPath(id));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async writeOperatorKey(key: string): Promise<void> {
    await this.write(this.operatorPath(), key);
  }

  async hasOperatorKey(): Promise<boolean> {
    try {
      await access(this.operatorPath());
      return true;
    } catch {
      return false;
    }
  }

  /** The secrets a unit of this account is started with, by the account's key source. */
  async resolve(record: IAccountRecord): Promise<IUnitSecrets> {
    if (record.keySource === 'none') return {};
    const key =
      record.keySource === 'account'
        ? await this.readAccountKey(record.id)
        : await this.read(this.operatorPath(), 'Operator key file');
    if (key === undefined) {
      throw new HostError(
        'secret-missing',
        record.keySource === 'account'
          ? `The model key of ${record.id} is missing from the store`
          : 'The operator-wide model key is not set',
      );
    }
    return { modelApiKey: key };
  }
}
