/** Owner-selected connector tools a case may propose, kept separately from service content. */
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { ConnectorRefusedError } from '@robota-sdk/agent-product/personal';
import { lock } from 'proper-lockfile';

export interface ICaseActionScope {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  tools(connectorId: string): Promise<readonly string[]>;
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

const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/u;
const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_TOOL_NAME = 128;
const MAX_TOOLS = 200;

/** A missing scope grants nothing; an unreadable or malformed scope is never replaced by a guess. */
export function createCaseActionScope(directory: string): ICaseActionScope {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockDirectory = join(directory, '.locks');
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  const lockTarget = join(realpathSync(lockDirectory), 'connector-state');
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
      let release: () => Promise<void>;
      try {
        release = await lock(lockTarget, {
          realpath: false,
          stale: 60_000,
          update: 10_000,
          retries: { retries: 100, factor: 1, minTimeout: 50, maxTimeout: 50 },
        });
      } catch {
        throw new ConnectorRefusedError('Connector settings are busy or cannot be locked');
      }
      try {
        return await work();
      } finally {
        await release();
      }
    },
    tools: async (connectorId) => read(connectorId).tools,
    version: (connectorId, tool) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const current = read(connectorId);
      if (current.revision !== '0') return current.revision;
      const path = pathOf(connectorId);
      const initial = { revision: randomUUID(), tools: [] };
      try {
        mkdirSync(path, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return read(connectorId).revision;
        throw new ConnectorRefusedError('The case action settings could not be saved');
      }
      try {
        writeFileSync(join(path, 'scope.json'), `${JSON.stringify(initial)}\n`, {
          flag: 'wx',
          mode: 0o600,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return read(connectorId).revision;
        throw new ConnectorRefusedError('The case action settings could not be saved');
      }
      return initial.revision;
    },
    set: async (connectorId, tool, allowed, expected) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const current = read(connectorId);
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
