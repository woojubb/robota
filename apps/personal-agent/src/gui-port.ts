import { randomBytes } from 'node:crypto';
import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureStateDir } from './config.js';

const FILE = 'gui-port';

/** The URL omits the default HTTP port even when the listener bound it. */
export function boundGuiPort(requested: number, url: string): number {
  return requested || Number(new URL(url).port || '80');
}

/** The remembered local GUI port, or undefined before the first local start. */
export function loadGuiPort(stateDir: string): number | undefined {
  const path = join(stateDir, FILE);
  let value: string;
  try {
    value = readFileSync(path, 'utf8').trim();
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
  const port = Number(value);
  if (!/^\d{1,5}$/u.test(value) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('The saved GUI port is invalid');
  return port;
}

/** Keep a port without overwriting a concurrent first start; an explicit choice can replace it. */
export function saveGuiPort(stateDir: string, port: number, replace: boolean): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('The GUI port is invalid');
  ensureStateDir(stateDir);
  const path = join(stateDir, FILE);
  const temporary = join(stateDir, `.gui-port-${randomBytes(12).toString('hex')}.tmp`);
  try {
    writeFileSync(temporary, `${port}\n`, { mode: 0o600, flag: 'wx' });
    if (replace) {
      renameSync(temporary, path);
      return port;
    }
    try {
      linkSync(temporary, path);
      return port;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        const current = loadGuiPort(stateDir);
        if (current !== undefined) return current;
      }
      throw error;
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}
