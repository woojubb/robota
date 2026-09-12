import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

export const GENERATION_DIRECTORY = '.robota-artifacts';

export function validateOutputName(value = 'dist') {
  if (typeof value !== 'string' || !/^dist(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new Error('artifact: invalid output name; expected dist or dist-<variant>');
  }
  return value;
}

export function generationStore(owner) {
  const store = path.join(owner, GENERATION_DIRECTORY);
  mkdirSync(store, { recursive: true });
  if (!lstatSync(store).isDirectory())
    throw new Error(`artifact: owned directory required: ${store}`);
  return store;
}

/** No stale-lock guessing: an interrupted publisher retains its record for explicit recovery. */
export async function withArtifactLock(owner, operation) {
  const store = generationStore(owner);
  const lock = path.join(store, 'writer.lock');
  try {
    mkdirSync(lock);
  } catch (error) {
    throw new Error(
      `artifact: writer lock unavailable: ${lock}; inspect recovery records before retrying`,
      { cause: error },
    );
  }
  writeFileSync(
    path.join(lock, 'owner.json'),
    JSON.stringify({ pid: process.pid, host: hostname() }),
  );
  try {
    if (existsSync(path.join(store, 'transaction.json'))) {
      throw new Error(`artifact: recovery required: ${store}/transaction.json`);
    }
    return await operation(store);
  } finally {
    if (!existsSync(path.join(store, 'transaction.json'))) rmSync(lock, { recursive: true });
  }
}
