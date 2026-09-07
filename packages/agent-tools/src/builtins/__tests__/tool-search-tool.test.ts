/**
 * CLI-1990 TC-05 — the `ToolSearch` builtin: what a query matches, what `limit` does, and the order.
 *
 * The tool is driven through its real `FunctionTool.execute`, against a stub `IDeferredToolCatalog`
 * standing in for the runtime's port, so what is asserted is the tool's own contract rather than a
 * re-implementation of it: the four match surfaces the spec names (name, description, a parameter's
 * name, a parameter's description), the default and the cap, deterministic ordering, and the two
 * outcomes that must NOT be confused — an empty match is a normal result, an unknown name is an error.
 */

import { describe, expect, it } from 'vitest';

import { createToolSearchTool, TOOL_SEARCH_NAME } from '../tool-search-tool';

import type {
  IDeferredToolCatalog,
  IToolExecutionContext,
  IToolSchema,
  TToolParameters,
} from '@robota-sdk/agent-core';

interface IToolSearchOutcome {
  loaded: Array<{ name: string; description: string }>;
  unavailableSources: string[];
}

function schema(
  name: string,
  description: string,
  properties: IToolSchema['parameters']['properties'] = {},
): IToolSchema {
  return { name, description, parameters: { type: 'object', properties }, deferLoading: true };
}

/** Each tool is reachable by exactly ONE of the four surfaces, so a match names its surface. */
const BY_NAME = schema('postgres_query', 'runs a statement against the primary store');
const BY_DESCRIPTION = schema('warehouse_read', 'reads a spreadsheet from the finance drive');
const BY_PARAMETER_NAME = schema('generic_fetch', 'retrieves a record', {
  invoiceId: { type: 'string', description: 'which record' },
});
const BY_PARAMETER_DESCRIPTION = schema('generic_put', 'stores a record', {
  target: { type: 'string', description: 'the kubernetes namespace to write into' },
});

const CATALOG_TOOLS = [BY_NAME, BY_DESCRIPTION, BY_PARAMETER_NAME, BY_PARAMETER_DESCRIPTION];

/**
 * The runtime's port, reduced to what this tool uses. `loadDeferredTools` resolves against the same
 * set and throws on an unknown name — the behaviour agent-core's `Tools` implements.
 */
function createCatalog(tools: readonly IToolSchema[] = CATALOG_TOOLS): {
  catalog: IDeferredToolCatalog;
  loaded: string[][];
} {
  const loaded: string[][] = [];
  const catalog: IDeferredToolCatalog = {
    listDeferredTools: () => [...tools],
    loadDeferredTools: (names) => {
      loaded.push([...names]);
      return names.map((name) => {
        const found = tools.find((tool) => tool.name === name);
        if (!found) throw new Error(`Tool "${name}" is not registered, so it cannot be loaded`);
        return found;
      });
    },
  };
  return { catalog, loaded };
}

async function search(
  args: TToolParameters,
  catalog: IDeferredToolCatalog,
): Promise<IToolSearchOutcome> {
  const tool = createToolSearchTool();
  const context = { deferredTools: catalog } as unknown as IToolExecutionContext;
  const result = await tool.execute(args, context);
  const invocation = JSON.parse(String(result.data)) as { success: boolean; output: string };
  expect(invocation.success).toBe(true);
  return JSON.parse(invocation.output) as IToolSearchOutcome;
}

function loadedNames(outcome: IToolSearchOutcome): string[] {
  return outcome.loaded.map((entry) => entry.name);
}

describe('CLI-1990 TC-05 — ToolSearch', () => {
  it('registers under the name the execution layer names in its unknown-tool remedy', () => {
    expect(TOOL_SEARCH_NAME).toBe('ToolSearch');
    expect(createToolSearchTool().schema.name).toBe('ToolSearch');
  });

  it('is itself resident — a search tool the model cannot see is a catalog with no way in', () => {
    expect(createToolSearchTool().schema.deferLoading).toBeUndefined();
  });

  it.each([
    ['a tool name', 'postgres', BY_NAME.name],
    ['a description', 'spreadsheet', BY_DESCRIPTION.name],
    ["a parameter's name", 'invoiceId', BY_PARAMETER_NAME.name],
    ["a parameter's description", 'kubernetes', BY_PARAMETER_DESCRIPTION.name],
  ])('matches the query against %s', async (_surface, query, expected) => {
    const { catalog } = createCatalog();
    expect(loadedNames(await search({ query }, catalog))).toEqual([expected]);
  });

  it('matches case-insensitively, so the model need not know the exact casing', async () => {
    const { catalog } = createCatalog();
    expect(loadedNames(await search({ query: 'POSTGRES' }, catalog))).toEqual([BY_NAME.name]);
  });

  it('loads exactly the matches and nothing else', async () => {
    const { catalog, loaded } = createCatalog();
    await search({ query: 'spreadsheet' }, catalog);
    expect(loaded).toEqual([[BY_DESCRIPTION.name]]);
  });

  it('defaults limit to 5 and caps the result at it', async () => {
    // Eight tools all matching on name, so only the cap can decide how many come back.
    const many = Array.from({ length: 8 }, (_, index) =>
      schema(`report_${index}`, 'a matching tool'),
    );
    const { catalog } = createCatalog(many);
    expect(loadedNames(await search({ query: 'report' }, catalog))).toHaveLength(5);
    expect(loadedNames(await search({ query: 'report', limit: 2 }, catalog))).toHaveLength(2);
    expect(loadedNames(await search({ query: 'report', limit: 8 }, catalog))).toHaveLength(8);
  });

  it('orders results deterministically — same catalog and query, same sequence', async () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      schema(`report_${index}`, 'a matching tool'),
    );
    const { catalog } = createCatalog(many);
    const first = loadedNames(await search({ query: 'report' }, catalog));
    const second = loadedNames(await search({ query: 'report' }, catalog));
    expect(first).toEqual(second);
    // And by the stated key: rank, then name. All eight tie on rank, so it is name order.
    expect(first).toEqual(['report_0', 'report_1', 'report_2', 'report_3', 'report_4']);
  });

  it('ranks a name match above a description match, so the cap keeps the better answers', async () => {
    const named = schema('invoice_tool', 'unrelated text');
    const described = schema('aaa_first_alphabetically', 'handles an invoice');
    const { catalog } = createCatalog([described, named]);
    // `described` sorts first by name; it comes second, so rank — not name — is the primary key.
    expect(loadedNames(await search({ query: 'invoice' }, catalog))).toEqual([
      named.name,
      described.name,
    ]);
  });

  it('loads exact names without searching, skipping the ranking entirely', async () => {
    const { catalog, loaded } = createCatalog();
    const outcome = await search({ names: [BY_PARAMETER_NAME.name, BY_NAME.name] }, catalog);
    expect(loadedNames(outcome)).toEqual([BY_PARAMETER_NAME.name, BY_NAME.name]);
    expect(loaded).toEqual([[BY_PARAMETER_NAME.name, BY_NAME.name]]);
  });

  it('returns an empty result for a query that matches nothing — a normal answer, not an error', async () => {
    const { catalog } = createCatalog();
    expect(await search({ query: 'nothing matches this' }, catalog)).toEqual({
      loaded: [],
      unavailableSources: [],
    });
  });

  it('reports an unknown name as an error naming the entry', async () => {
    const { catalog } = createCatalog();
    const context = { deferredTools: catalog } as unknown as IToolExecutionContext;
    // The execution layer turns a thrown tool error into the `Error: …` tool message the model
    // reads; what this tool owes is that the entry it could not resolve is named in it.
    await expect(
      createToolSearchTool().execute({ names: ['NoSuchTool'] }, context),
    ).rejects.toThrow(/NoSuchTool/);
  });

  it('reports an empty result and an unknown name DIFFERENTLY — the distinction is the contract', async () => {
    const { catalog } = createCatalog();
    const context = { deferredTools: catalog } as unknown as IToolExecutionContext;
    // A query with no match resolves, carrying an empty list...
    await expect(search({ query: 'nothing matches this' }, catalog)).resolves.toEqual({
      loaded: [],
      unavailableSources: [],
    });
    // ...while a name that cannot exist rejects. One is an answer, the other is a mistake.
    await expect(
      createToolSearchTool().execute({ names: ['NoSuchTool'] }, context),
    ).rejects.toThrow(/NoSuchTool/);
  });

  it('loads nothing when any name in the batch is unknown', async () => {
    const { catalog, loaded } = createCatalog();
    const context = { deferredTools: catalog } as unknown as IToolExecutionContext;
    await expect(
      createToolSearchTool().execute({ names: [BY_NAME.name, 'NoSuchTool'] }, context),
    ).rejects.toThrow(/NoSuchTool/);
    // The catalog resolves every name before loading the first, so a partial load is impossible.
    expect(loaded).toEqual([[BY_NAME.name, 'NoSuchTool']]);
  });

  it('carries unavailableSources from day one so MCP-003 fills it without a contract change', async () => {
    const { catalog } = createCatalog();
    expect(await search({ query: 'postgres' }, catalog)).toHaveProperty('unavailableSources', []);
  });

  it('refuses a call with neither query nor names rather than guessing one', async () => {
    const { catalog, loaded } = createCatalog();
    const context = { deferredTools: catalog } as unknown as IToolExecutionContext;
    await expect(createToolSearchTool().execute({}, context)).rejects.toThrow(/query.*names/);
    expect(loaded).toEqual([]);
  });

  it('refuses to run outside the execution loop rather than reporting an empty catalog', async () => {
    // No port at all: reporting "nothing matched" here would describe a search never run.
    await expect(
      createToolSearchTool().execute({ query: 'postgres' }, {} as unknown as IToolExecutionContext),
    ).rejects.toThrow(/deferred-tool catalog/);
  });
});
