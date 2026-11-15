/**
 * Where the token a person typed for a connector is kept: one owner-only file per connector in an
 * owner-only directory, written atomically and deleted when the connector is disconnected or removed.
 * It is the only place a token lives; a connector record, an API answer and a log never hold one.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/;

export interface ITokenStore {
  get(connectorId: string): string | undefined;
  set(connectorId: string, token: string): void;
  /** Whether a token is held, without reading it. */
  has(connectorId: string): boolean;
  delete(connectorId: string): boolean;
}

export function createFileTokenStore(directory: string): ITokenStore {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // A directory that already existed keeps no looser mode than the one asked for.
  chmodSync(directory, 0o700);
  const pathOf = (id: string): string => {
    if (!CONNECTOR_ID.test(id)) throw new Error('Invalid connector id');
    return join(directory, `${id}.json`);
  };
  return {
    get(id) {
      const path = pathOf(id);
      if (!existsSync(path)) return undefined;
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { token?: unknown };
      return typeof parsed.token === 'string' && parsed.token !== '' ? parsed.token : undefined;
    },
    set(id, token) {
      const path = pathOf(id);
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ token })}\n`, { mode: 0o600 });
      renameSync(temporary, path);
    },
    has(id) {
      return existsSync(pathOf(id));
    },
    delete(id) {
      const path = pathOf(id);
      const held = existsSync(path);
      rmSync(path, { force: true });
      return held;
    },
  };
}
