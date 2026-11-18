/** Owner-selected connector tools a case may propose, kept separately from service content. */
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { ConnectorRefusedError } from '@robota-sdk/agent-product/personal';
import Database from 'better-sqlite3';

export interface ICaseActionScope {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  tools(connectorId: string): Promise<readonly string[]>;
  /** Establish an empty scope only when none exists; caller holds the settings lock. */
  initialize(connectorId: string): Promise<void>;
  /** Captured synchronously before a request yields to another settings change. */
  version(connectorId: string, tool: string): string;
  set(
    connectorId: string,
    tool: string,
    allowed: boolean,
    expected?: string,
  ): Promise<string | undefined>;
  reset(connectorId: string): Promise<void>;
  clear(connectorId: string): Promise<void>;
}

interface IScopeState {
  readonly revision: string;
  readonly tools: readonly string[];
}

interface ILockDatabase {
  exec(sql: string): unknown;
  close(): void;
}

const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/u;
const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_TOOL_NAME = 128;
const MAX_TOOLS = 200;

// An addon installed under one Node major cannot be loaded under another. Choose one backend per
// process: different SQLite libraries in one process must not each believe they own the same lock.
let backend: 'undecided' | 'addon' | 'builtin' = 'undecided';
let builtinDatabase: typeof import('node:sqlite').DatabaseSync | undefined;
function openLockDatabase(path: string): ILockDatabase {
  if (backend === 'builtin' && builtinDatabase !== undefined) return new builtinDatabase(path);
  try {
    const database = new Database(path, { timeout: 0 });
    backend = 'addon';
    return database;
  } catch (error) {
    if (
      backend !== 'undecided' ||
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ERR_DLOPEN_FAILED'
    ) {
      throw error;
    }
    try {
      const sqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
      builtinDatabase = sqlite.DatabaseSync;
    } catch {
      throw new ConnectorRefusedError(
        'SQLite is unavailable for this Node version; reinstall dependencies with the Node version used to start the agent',
      );
    }
    backend = 'builtin';
    return new builtinDatabase(path);
  }
}

function lockIsBusy(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  if (error.code === 'SQLITE_BUSY') return true;
  return (
    error.code === 'ERR_SQLITE_ERROR' &&
    'errcode' in error &&
    typeof error.errcode === 'number' &&
    (error.errcode & 0xff) === 5
  );
}

/** A missing scope grants nothing; an unreadable or malformed scope is never replaced by a guess. */
export function createCaseActionScope(directory: string): ICaseActionScope {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // An uncommitted SQLite transaction holds the OS file lock until this process releases it or exits.
  // The database has no records; it names the shared lock even when a volume has different mount paths.
  const lockPath = join(directory, '.connector-settings.sqlite');
  const pathOf = (connectorId: string): string => {
    if (!CONNECTOR_ID.test(connectorId)) throw new ConnectorRefusedError('Invalid connector id');
    return join(directory, connectorId);
  };
  const validTool = (tool: unknown): tool is string =>
    typeof tool === 'string' && tool.length > 0 && tool.length <= MAX_TOOL_NAME;
  const read = (connectorId: string): IScopeState => {
    const path = pathOf(connectorId);
    try {
      if (!statSync(directory).isDirectory()) throw new Error('not a directory');
      try {
        readdirSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          if (!statSync(directory).isDirectory()) throw new Error('not a directory');
          return { revision: '0', tools: [] };
        }
        throw error;
      }
      // An existing directory without its state file is damaged, not a fresh empty scope.
      const value: unknown = JSON.parse(readFileSync(join(path, 'scope.json'), 'utf8'));
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('invalid scope');
      const { revision, tools } = value as { revision?: unknown; tools?: unknown };
      if (
        typeof revision !== 'string' ||
        !VERSION.test(revision) ||
        !Array.isArray(tools) ||
        tools.length > MAX_TOOLS ||
        !tools.every(validTool) ||
        new Set(tools).size !== tools.length
      ) {
        throw new Error('invalid scope');
      }
      return { revision, tools: tools as string[] };
    } catch {
      throw new ConnectorRefusedError('The case action settings cannot be read');
    }
  };
  const write = (connectorId: string, next: IScopeState): void => {
    const path = pathOf(connectorId);
    const temporary = join(path, `.${randomUUID()}.tmp`);
    try {
      mkdirSync(path, { recursive: true, mode: 0o700 });
      writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
      renameSync(temporary, join(path, 'scope.json'));
    } catch {
      throw new ConnectorRefusedError('The case action settings could not be saved');
    } finally {
      try {
        rmSync(temporary, { force: true });
      } catch {
        /* An unfinished file grants nothing. */
      }
    }
  };
  return {
    exclusive: async (work) => {
      let held: ILockDatabase | undefined;
      for (let attempt = 0; attempt <= 100; attempt += 1) {
        let candidate: ILockDatabase | undefined;
        try {
          candidate = openLockDatabase(lockPath);
          chmodSync(lockPath, 0o600);
          candidate.exec('BEGIN IMMEDIATE');
          held = candidate;
          break;
        } catch (error) {
          candidate?.close();
          if (error instanceof ConnectorRefusedError) throw error;
          if (!lockIsBusy(error) || attempt === 100) {
            throw new ConnectorRefusedError('Connector settings are busy or cannot be locked');
          }
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      if (held === undefined)
        throw new ConnectorRefusedError('Connector settings cannot be locked');
      try {
        return await work();
      } finally {
        try {
          held.exec('ROLLBACK');
        } finally {
          held.close();
        }
      }
    },
    tools: async (connectorId) => read(connectorId).tools,
    initialize: async (connectorId) => {
      if (read(connectorId).revision === '0') {
        write(connectorId, { revision: randomUUID(), tools: [] });
      }
    },
    version: (connectorId, tool) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const current = read(connectorId);
      if (current.revision === '0') {
        throw new ConnectorRefusedError('Open the connector settings before allowing case actions');
      }
      return current.revision;
    },
    set: async (connectorId, tool, allowed, expected) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const current = read(connectorId);
      if (allowed && current.revision === '0') {
        throw new ConnectorRefusedError('Open the connector settings before allowing case actions');
      }
      if (allowed && expected !== undefined && expected !== current.revision) {
        throw new ConnectorRefusedError('Case action settings changed; try again');
      }
      if (allowed && current.tools.includes(tool)) return current.revision;
      const tools = new Set(current.tools);
      if (allowed) tools.add(tool);
      else tools.delete(tool);
      if (tools.size > MAX_TOOLS) throw new ConnectorRefusedError('Too many case action tools');
      // A revoke advances the revision even when the tool is absent, cancelling older allows.
      const next = { revision: randomUUID(), tools: [...tools].sort() };
      write(connectorId, next);
      return allowed ? next.revision : undefined;
    },
    reset: async (connectorId) => {
      // Replace the whole authority in one rename. A failed write leaves the old file intact.
      write(connectorId, { revision: randomUUID(), tools: [] });
      const path = pathOf(connectorId);
      try {
        for (const file of readdirSync(path)) {
          if (file !== 'scope.json') rmSync(join(path, file), { recursive: true, force: true });
        }
      } catch {
        throw new ConnectorRefusedError('The case action settings could not be reset');
      }
    },
    clear: async (connectorId) => {
      try {
        if (!statSync(directory).isDirectory()) throw new Error('not a directory');
        rmSync(pathOf(connectorId), { recursive: true, force: true });
      } catch {
        throw new ConnectorRefusedError('The case action settings could not be cleared');
      }
    },
  };
}
