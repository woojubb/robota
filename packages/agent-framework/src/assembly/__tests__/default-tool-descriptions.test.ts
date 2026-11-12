import { FunctionTool } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOOL_DESCRIPTIONS,
  DEFERRED_TOOL_ROSTER_HEADER,
  buildSessionSystemPrompt,
  formatDeferredToolRoster,
} from '../create-session-runtime.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type { ICreateSessionOptions } from '../create-session-types.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type { ITerminalOutput } from '@robota-sdk/agent-session';

const testHost = createTestFrameworkHost();

/**
 * The tool-assembly cases live with `createDefaultTools` in `@robota-sdk/agent-tools/defaults`; these
 * two live here because `DEFAULT_TOOL_DESCRIPTIONS` belongs to this package — its only consumer
 * builds the system prompt synchronously.
 *
 * What these cases do NOT check, stated because the gap is the point: nothing here ties a description
 * to a tool that is actually assembled. The list is hard-coded and the coupling is cross-package.
 * Filed separately; asserting it here would be asserting the defect.
 *
 * The deferred roster below is the one part that IS derived. It has to be: which tools
 * a session withholds is a per-session fact, and a deferred tool the model is never told about
 * cannot be searched for, so the roster is the only thing making the withheld half reachable.
 */
describe('DEFAULT_TOOL_DESCRIPTIONS', () => {
  it('describes WebFetch as a local tool, which is how the prompt presents it', () => {
    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain('WebFetch — fetch URL content as text');
  });

  it("describes no web search tool — search is the provider's or an MCP server's, not a local tool", () => {
    expect(DEFAULT_TOOL_DESCRIPTIONS.some((line) => line.startsWith('WebSearch'))).toBe(false);
  });
});

const NOOP_TERMINAL: ITerminalOutput = {
  write: () => undefined,
  writeLine: () => undefined,
  writeMarkdown: () => undefined,
  writeError: () => undefined,
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop: () => undefined, update: () => undefined }),
};

function makeOptions(): ICreateSessionOptions {
  return {
    host: testHost,
    cwd: process.cwd(),
    config: {
      defaultTrustLevel: 'safe',
      provider: { name: 'test', model: 'test-model', apiKey: undefined },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: 'A0', projectNotesMd: 'C0' },
    terminal: NOOP_TERMINAL,
  };
}

function tool(name: string, description: string, deferLoading?: boolean): IToolWithEventService {
  return new FunctionTool(
    {
      name,
      description,
      parameters: { type: 'object', properties: {} },
      ...(deferLoading !== undefined && { deferLoading }),
    },
    async () => 'ok',
  );
}

/** The assembled system prompt for a session holding exactly these tools. */
function promptFor(tools: readonly IToolWithEventService[]): string {
  const { finalSystemMessage } = buildSessionSystemPrompt(
    makeOptions(),
    '/tmp/tool-roster',
    [],
    undefined,
    undefined,
    [],
    [],
    tools,
  );
  return finalSystemMessage;
}

const DEFERRED_A = tool('postgres_query', 'Run a SQL statement against the primary store.', true);
const DEFERRED_B = tool('sheets_read', 'Read a range from a spreadsheet.', true);
const RESIDENT = tool('Read', 'read file contents with line numbers');

describe('the deferred roster reaches the assembled system prompt', () => {
  it('names each deferred tool as `name — description` under the roster header', () => {
    const prompt = promptFor([RESIDENT, DEFERRED_A, DEFERRED_B]);
    expect(prompt).toContain(DEFERRED_TOOL_ROSTER_HEADER);
    expect(prompt).toContain('postgres_query — Run a SQL statement against the primary store.');
    expect(prompt).toContain('sheets_read — Read a range from a spreadsheet.');
  });

  it('tells the model which tool loads them, or the roster is a list it cannot act on', () => {
    expect(DEFERRED_TOOL_ROSTER_HEADER).toContain('ToolSearch');
  });

  it('omits resident tools from the roster — they are already in the tool list', () => {
    expect(formatDeferredToolRoster([RESIDENT, DEFERRED_A])).toEqual([
      DEFERRED_TOOL_ROSTER_HEADER,
      'postgres_query — Run a SQL statement against the primary store.',
    ]);
  });

  it("is byte-identical to today's prompt when nothing is deferred", () => {
    // The whole no-regression claim in one assertion: a session of resident tools — every session in
    // the tree today — produces exactly the prompt it produced before the roster existed.
    expect(promptFor([RESIDENT])).toBe(promptFor([]));
    expect(promptFor([RESIDENT])).not.toContain(DEFERRED_TOOL_ROSTER_HEADER);
    expect(formatDeferredToolRoster([RESIDENT])).toEqual([]);
  });

  it('summarises a long description to its first line rather than reprinting the schema', () => {
    const verbose = tool('verbose_tool', `First line.\nSecond line.\n${'x'.repeat(400)}`, true);
    const [, entry] = formatDeferredToolRoster([verbose]);
    expect(entry).toBe('verbose_tool — First line.');
  });
});
