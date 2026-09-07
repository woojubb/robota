import { FunctionTool } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOOL_DESCRIPTIONS,
  DEFERRED_TOOL_ROSTER_HEADER,
  buildSessionSystemPrompt,
  formatDeferredToolRoster,
} from '../create-session-runtime.js';

import type { ICreateSessionOptions } from '../create-session-types.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type { ITerminalOutput } from '@robota-sdk/agent-session';

/**
 * ARCH-035 SPLIT this file rather than moving it. The tool-assembly cases went to
 * `@robota-sdk/agent-tool-defaults` with the aggregator; these two stayed, because
 * `DEFAULT_TOOL_DESCRIPTIONS` stayed — its only consumer builds the system prompt synchronously.
 *
 * What these cases do NOT check, stated because the gap is the point: nothing here ties a description
 * to a tool that is actually assembled. The list is hard-coded and the coupling is now cross-package.
 * Filed separately; asserting it here would be asserting the defect.
 *
 * CLI-1990 adds the one part that IS derived — the deferred roster below. It has to be: which tools
 * a session withholds is a per-session fact, and a deferred tool the model is never told about
 * cannot be searched for, so the roster is the only thing making the withheld half reachable.
 */
describe('DEFAULT_TOOL_DESCRIPTIONS', () => {
  it('describes the web tools as local tools, which is how the prompt presents them', () => {
    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain('WebFetch — fetch URL content as text');
    expect(DEFAULT_TOOL_DESCRIPTIONS).toContain(
      'WebSearch — search the internet through the configured local tool',
    );
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
    '/tmp/cli-1990-roster',
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

describe('CLI-1990 TC-16 — the deferred roster reaches the assembled system prompt', () => {
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
