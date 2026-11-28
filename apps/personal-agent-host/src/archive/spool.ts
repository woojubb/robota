import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { ensurePrivateDir, PRIVATE_DIR_MODE } from '../fs-util.js';

export interface ISpoolFile {
  path: string;
  /** Deletes the file; safe to call twice. */
  remove(): Promise<void>;
}

/**
 * Where archives wait while they are checked: a private directory inside the state directory, so
 * an archive (which holds an access code) is never readable by another user and never lands on the
 * control plane's read-only root. The server empties it once it holds the single-instance lock,
 * so a crash leaves nothing behind and a second start never wipes a running server's files.
 */
export class Spool {
  private constructor(private readonly dir: string) {}

  static async open(stateDir: string): Promise<Spool> {
    const dir = join(stateDir, 'spool');
    await ensurePrivateDir(dir);
    return new Spool(dir);
  }

  /** Removes every file left in the directory. */
  async clear(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: PRIVATE_DIR_MODE });
    for (const name of await readdir(this.dir)) {
      await rm(join(this.dir, name), { recursive: true, force: true });
    }
  }

  /** A path for a new file; the file itself is created by whoever writes it, owner-only. */
  file(label: string): ISpoolFile {
    const path = join(this.dir, `${label}-${randomBytes(8).toString('hex')}.tar`);
    return { path, remove: () => rm(path, { force: true }) };
  }
}
