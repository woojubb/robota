/** Owner-selected connector tools a case may propose, kept separately from service content. */
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { ConnectorRefusedError } from '@robota-sdk/agent-product/personal';

export interface ICaseActionScope {
  tools(connectorId: string): Promise<readonly string[]>;
  set(connectorId: string, tool: string, allowed: boolean): Promise<void>;
  clear(connectorId: string): Promise<void>;
}

const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/u;
const MAX_TOOL_NAME = 128;

/** A missing scope grants nothing; an unreadable or malformed scope is never replaced by a guess. */
export function createCaseActionScope(directory: string): ICaseActionScope {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pathOf = (connectorId: string): string => {
    if (!CONNECTOR_ID.test(connectorId)) throw new ConnectorRefusedError('Invalid connector id');
    return join(directory, connectorId);
  };
  const validTool = (tool: unknown): tool is string =>
    typeof tool === 'string' && tool.length > 0 && tool.length <= MAX_TOOL_NAME;
  const nameOf = (tool: string): string =>
    `${createHash('sha256').update(tool).digest('hex')}.json`;
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
    tools: async (connectorId) => read(connectorId),
    set: async (connectorId, tool, allowed) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const path = pathOf(connectorId);
      const current = read(connectorId);
      if (current.includes(tool) === allowed) return;
      const target = join(path, nameOf(tool));
      const temporary = join(path, `.${randomUUID()}.tmp`);
      try {
        if (allowed) {
          mkdirSync(path, { recursive: true, mode: 0o700 });
          writeFileSync(temporary, `${JSON.stringify({ tool })}\n`, { mode: 0o600 });
          renameSync(temporary, target);
        } else {
          rmSync(target, { force: true });
        }
      } catch {
        throw new ConnectorRefusedError('The case action settings could not be saved');
      } finally {
        if (allowed) {
          try {
            rmSync(temporary, { force: true });
          } catch {
            // An unfinished temporary file is never an active permission.
          }
        }
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
