/** Owner-selected connector tools a case may propose, kept separately from service content. */
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

import { ConnectorRefusedError } from '@robota-sdk/agent-product/personal';
import Database from 'better-sqlite3';

export interface ICaseActionScope {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** Hold `exclusive` while using this result to authorize an action. */
  tools(connectorId: string): Promise<readonly string[]>;
  /** Read the allowed tools and their shared revision as one snapshot. */
  snapshot(connectorId: string): { readonly revision: string; readonly tools: readonly string[] };
  /** Issue a stable recovery revision while this connector's scope is unreadable. Caller holds the lock. */
  errorRevision(connectorId: string): string;
  /** Fence a revision without changing a newer setting. Caller holds the lock. */
  fence(connectorId: string, expected?: string): Promise<void>;
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
  reset(connectorId: string, expected?: string): Promise<void>;
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
  // Keep the lock beside scope data so an unreadable scope cannot stop the owner blocking a tool.
  // The transaction holds an OS file lock even when a shared volume has different mount paths.
  const canonical = realpathSync(directory);
  const lockPath = join(dirname(canonical), `.${basename(canonical)}-connector-settings.sqlite`);
  const recoveryDirectory = join(dirname(canonical), `.${basename(canonical)}-recovery`);
  const pathOf = (connectorId: string): string => {
    if (!CONNECTOR_ID.test(connectorId)) throw new ConnectorRefusedError('Invalid connector id');
    return join(directory, connectorId);
  };
  const validTool = (tool: unknown): tool is string =>
    typeof tool === 'string' && tool.length > 0 && tool.length <= MAX_TOOL_NAME;
  const recoveryPath = (connectorId: string): string => {
    pathOf(connectorId);
    return join(recoveryDirectory, connectorId);
  };
  const clearRecovery = (connectorId: string): void => {
    try {
      rmSync(recoveryPath(connectorId), { force: true });
    } catch {
      throw new ConnectorRefusedError('The case action recovery setting could not be saved');
    }
  };
  const hasRecovery = (connectorId: string): boolean => {
    try {
      statSync(recoveryPath(connectorId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new ConnectorRefusedError('The case action recovery setting cannot be read');
    }
  };
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
  const authorized = (connectorId: string): IScopeState => {
    if (hasRecovery(connectorId)) {
      throw new ConnectorRefusedError('The case action settings require recovery');
    }
    const current = read(connectorId);
    if (hasRecovery(connectorId)) {
      throw new ConnectorRefusedError('The case action settings require recovery');
    }
    return current;
  };
  const isBroken = (connectorId: string): boolean => {
    try {
      read(connectorId);
      return false;
    } catch (error) {
      if (!(error instanceof ConnectorRefusedError)) throw error;
      return true;
    }
  };
  const errorRevision = (connectorId: string): string => {
    if (!isBroken(connectorId)) {
      throw new ConnectorRefusedError('Case action settings changed; try again');
    }
    try {
      mkdirSync(recoveryDirectory, { recursive: true, mode: 0o700 });
      const path = recoveryPath(connectorId);
      try {
        const token = readFileSync(path, 'utf8').trim();
        if (VERSION.test(token)) return `broken:${token}`;
      } catch {
        /* A fresh token also invalidates any recovery that could not be read. */
      }
      const token = randomUUID();
      const temporary = `${path}.${token}.tmp`;
      try {
        writeFileSync(temporary, `${token}\n`, { mode: 0o600 });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
      return `broken:${token}`;
    } catch {
      throw new ConnectorRefusedError('The case action recovery setting cannot be read');
    }
  };
  const reset = async (connectorId: string, expected?: string): Promise<void> => {
    if (expected?.startsWith('broken:') === true) {
      if (errorRevision(connectorId) !== expected) {
        throw new ConnectorRefusedError('Case action settings changed; try again');
      }
    } else if (expected !== undefined && authorized(connectorId).revision !== expected) {
      throw new ConnectorRefusedError('Case action settings changed; try again');
    }
    write(connectorId, { revision: randomUUID(), tools: [] });
    // Keep authority closed by the marker until the replacement is durable.
    clearRecovery(connectorId);
    const path = pathOf(connectorId);
    try {
      for (const file of readdirSync(path)) {
        if (file !== 'scope.json') rmSync(join(path, file), { recursive: true, force: true });
      }
    } catch {
      throw new ConnectorRefusedError('The case action settings could not be reset');
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
    tools: async (connectorId) => authorized(connectorId).tools,
    snapshot: (connectorId) => authorized(connectorId),
    errorRevision,
    fence: async (connectorId, expected) => {
      if (expected?.startsWith('broken:') === true) {
        if (isBroken(connectorId) && errorRevision(connectorId) === expected) {
          await reset(connectorId, expected);
        }
        return;
      }
      const current = read(connectorId);
      if (hasRecovery(connectorId)) {
        write(connectorId, { ...current, revision: randomUUID() });
        clearRecovery(connectorId);
        return;
      }
      if (current.revision === '0' || (expected !== undefined && expected !== current.revision))
        return;
      clearRecovery(connectorId);
      write(connectorId, { ...current, revision: randomUUID() });
    },
    initialize: async (connectorId) => {
      const current = read(connectorId);
      if (current.revision === '0') {
        write(connectorId, { revision: randomUUID(), tools: [] });
        clearRecovery(connectorId);
      } else if (hasRecovery(connectorId)) {
        write(connectorId, { ...current, revision: randomUUID() });
        clearRecovery(connectorId);
      }
    },
    version: (connectorId, tool) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const current = authorized(connectorId);
      if (current.revision === '0') {
        throw new ConnectorRefusedError('Open the connector settings before allowing case actions');
      }
      return current.revision;
    },
    set: async (connectorId, tool, allowed, expected) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const current = authorized(connectorId);
      if (allowed && current.revision === '0') {
        throw new ConnectorRefusedError('Open the connector settings before allowing case actions');
      }
      if (expected !== undefined && expected !== current.revision) {
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
    reset,
    clear: async (connectorId) => {
      try {
        if (!statSync(directory).isDirectory()) throw new Error('not a directory');
        rmSync(pathOf(connectorId), { recursive: true, force: true });
        clearRecovery(connectorId);
      } catch {
        throw new ConnectorRefusedError('The case action settings could not be cleared');
      }
    },
  };
}
