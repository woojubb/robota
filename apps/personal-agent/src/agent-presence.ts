/** Keep a second agent from recovering work that another live agent still owns. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { ownerHasExited, tryDirectoryLock } from './connectors/directory-lock.js';

export function createAgentPresence(stateDir: string) {
  const root = join(realpathSync(stateDir), '.agent-presence');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const name = `${randomUUID()}.live`;
  const path = join(root, name);
  let active: { release(): void } | undefined;
  const others = (): boolean => {
    try {
      for (const entry of readdirSync(root)) {
        if (entry === name || !entry.endsWith('.live')) continue;
        const other = join(root, entry);
        if (!ownerHasExited(other)) return true;
      }
      return false;
    } catch {
      // An unobservable agent may still own a prompt.
      return true;
    }
  };
  const locked = async <T>(work: () => Promise<T>): Promise<T> => {
    const startupPath = join(root, 'startup.lock');
    let startup: { release(): void } | undefined;
    for (let attempt = 0; attempt <= 100; attempt += 1) {
      startup = tryDirectoryLock(startupPath);
      if (startup !== undefined) break;
      if (attempt === 100)
        throw new Error('Agent startup is busy; recover the state folder offline');
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    if (startup === undefined) throw new Error('Agent startup cannot be locked');
    try {
      return await work();
    } finally {
      startup.release();
    }
  };
  return {
    id: name,
    ownerExited(ownerId: string): boolean {
      if (!/^[0-9a-f-]{36}\.live$/u.test(ownerId) || ownerId === name) return false;
      return ownerHasExited(join(root, ownerId));
    },
    others,
    async enter(recover: () => Promise<unknown>): Promise<void> {
      if (active !== undefined) throw new Error('The agent is already attached');
      await locked(async () => {
        active = tryDirectoryLock(path);
        if (active === undefined) throw new Error('The agent presence cannot be recorded');
        try {
          if (!others()) await recover();
        } catch (error) {
          active.release();
          active = undefined;
          throw error;
        }
      });
    },
    async whenAlone(work: () => Promise<void>): Promise<boolean> {
      return locked(async () => {
        if (others()) return false;
        await work();
        return true;
      });
    },
    close(): void {
      active?.release();
      active = undefined;
    },
  };
}
