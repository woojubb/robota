/** Owner-selected connector tools a case may propose, kept separately from service content. */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConnectorRefusedError } from '@robota-sdk/agent-product/personal';

export interface ICaseActionScope {
  tools(connectorId: string): Promise<readonly string[]>;
  set(connectorId: string, tool: string, allowed: boolean): Promise<void>;
  clear(connectorId: string): Promise<void>;
}

const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/u;
const MAX_TOOLS = 200;
const MAX_TOOL_NAME = 128;

/** A missing scope grants nothing; an unreadable or malformed scope is never replaced by a guess. */
export function createCaseActionScope(directory: string): ICaseActionScope {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pathOf = (connectorId: string): string => {
    if (!CONNECTOR_ID.test(connectorId)) throw new ConnectorRefusedError('Invalid connector id');
    return join(directory, `${connectorId}.json`);
  };
  const validTool = (tool: unknown): tool is string =>
    typeof tool === 'string' && tool.length > 0 && tool.length <= MAX_TOOL_NAME;
  const read = (connectorId: string): string[] => {
    const path = pathOf(connectorId);
    if (!existsSync(path)) return [];
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new ConnectorRefusedError('The case action settings cannot be read');
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !Array.isArray((value as Record<string, unknown>)['tools'])
    ) {
      throw new ConnectorRefusedError('The case action settings are invalid');
    }
    const tools: unknown[] = (value as { tools: unknown[] }).tools;
    if (
      tools.length > MAX_TOOLS ||
      !tools.every(validTool) ||
      new Set(tools).size !== tools.length
    ) {
      throw new ConnectorRefusedError('The case action settings are invalid');
    }
    return tools as string[];
  };
  return {
    tools: async (connectorId) => read(connectorId),
    set: async (connectorId, tool, allowed) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const path = pathOf(connectorId);
      const current = read(connectorId);
      if (current.includes(tool) === allowed) return;
      const next = new Set(current);
      if (allowed) next.add(tool);
      else next.delete(tool);
      if (next.size > MAX_TOOLS) throw new ConnectorRefusedError('Too many case action tools');
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, `${JSON.stringify({ tools: [...next].sort() })}\n`, {
          mode: 0o600,
        });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    },
    clear: async (connectorId) => {
      rmSync(pathOf(connectorId), { force: true });
    },
  };
}
