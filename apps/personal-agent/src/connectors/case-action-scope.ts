/** Owner-selected connector tools a case may propose, kept separately from service content. */
import { createHash, randomUUID } from 'node:crypto';
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
  version(
    connectorId: string,
    tool: string,
  ): Promise<{ readonly scope: string; readonly tool: string }>;
  set(connectorId: string, tool: string, allowed: boolean): Promise<void>;
  reset(connectorId: string): Promise<void>;
  clear(connectorId: string): Promise<void>;
}

const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/u;
const MAX_TOOL_NAME = 128;
const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

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
  const nameOf = (tool: string): string =>
    `${createHash('sha256').update(tool).digest('hex')}.json`;
  const toolVersionName = (tool: string): string => `.${nameOf(tool).slice(0, -5)}.version`;
  const readVersion = (path: string, name: string): string => {
    try {
      if (!statSync(directory).isDirectory()) throw new Error('not a directory');
      let value: string;
      try {
        value = readFileSync(join(path, name), 'utf8').trim();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '0';
        throw error;
      }
      if (!VERSION.test(value)) throw new Error('invalid version');
      return value;
    } catch {
      throw new ConnectorRefusedError('The case action settings cannot be read');
    }
  };
  const writeAtomic = (path: string, name: string, value: string): void => {
    const temporary = join(path, `.${randomUUID()}.tmp`);
    try {
      mkdirSync(path, { recursive: true, mode: 0o700 });
      writeFileSync(temporary, value, { mode: 0o600 });
      renameSync(temporary, join(path, name));
    } catch {
      throw new ConnectorRefusedError('The case action settings could not be saved');
    } finally {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // An unfinished temporary file is never an active permission.
      }
    }
  };
  const read = (connectorId: string): string[] => {
    const path = pathOf(connectorId);
    try {
      // The base directory is created at startup. Losing access to it is not an empty scope.
      if (!statSync(directory).isDirectory()) throw new Error('not a directory');
      let files: string[];
      try {
        files = readdirSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          if (!statSync(directory).isDirectory()) throw new Error('not a directory');
          return [];
        }
        throw error;
      }
      const tools: string[] = [];
      for (const file of files) {
        // A crash can leave an unfinished temporary file, which grants nothing.
        if (file.startsWith('.') && file.endsWith('.tmp')) continue;
        let contents: string;
        try {
          contents = readFileSync(join(path, file), 'utf8');
        } catch (error) {
          // Another process may have revoked this one after the directory was read.
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        if (file === '.scope-version' || /^\.[0-9a-f]{64}\.version$/u.test(file)) {
          if (!VERSION.test(contents.trim())) throw new Error('invalid version');
          continue;
        }
        const value: unknown = JSON.parse(contents);
        if (
          typeof value !== 'object' ||
          value === null ||
          Array.isArray(value) ||
          !validTool((value as Record<string, unknown>)['tool'])
        )
          throw new Error('invalid tool');
        const tool = (value as { tool: string }).tool;
        if (file !== nameOf(tool)) throw new Error('invalid tool file');
        tools.push(tool);
      }
      return tools.sort();
    } catch {
      throw new ConnectorRefusedError('The case action settings cannot be read');
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
    tools: async (connectorId) => read(connectorId),
    version: async (connectorId, tool) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const path = pathOf(connectorId);
      return {
        scope: readVersion(path, '.scope-version'),
        tool: readVersion(path, toolVersionName(tool)),
      };
    },
    set: async (connectorId, tool, allowed) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const path = pathOf(connectorId);
      const current = read(connectorId);
      if (allowed && current.includes(tool)) return;
      const target = join(path, nameOf(tool));
      try {
        if (allowed) {
          writeAtomic(path, nameOf(tool), `${JSON.stringify({ tool })}\n`);
        } else {
          // Even an absent grant may have an older allow still discovering the service.
          writeAtomic(path, toolVersionName(tool), `${randomUUID()}\n`);
          rmSync(target, { force: true });
        }
      } catch {
        throw new ConnectorRefusedError('The case action settings could not be saved');
      }
    },
    reset: async (connectorId) => {
      const path = pathOf(connectorId);
      try {
        if (!statSync(directory).isDirectory()) throw new Error('not a directory');
        rmSync(path, { recursive: true, force: true });
        writeAtomic(path, '.scope-version', `${randomUUID()}\n`);
      } catch {
        throw new ConnectorRefusedError('The case action settings could not be reset');
      }
    },
    clear: async (connectorId) => {
      // Check the base first: an inaccessible directory is not successful cleanup.
      try {
        if (!statSync(directory).isDirectory()) throw new Error('not a directory');
        rmSync(pathOf(connectorId), { recursive: true, force: true });
      } catch {
        throw new ConnectorRefusedError('The case action settings could not be cleared');
      }
    },
  };
}
