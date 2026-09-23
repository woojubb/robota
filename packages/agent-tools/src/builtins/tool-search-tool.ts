/**
 * ToolSearch — the model-facing half of client-side tool deferral (CLI-1990 § Solution 4).
 *
 * A tool that declares `deferLoading` is withheld from the request entirely while the tool-search
 * policy is engaged, so the model never sees its schema. This tool is how the model gets it back:
 * it searches the withheld catalog by query, or loads an exact list by name, and the runtime marks
 * the matches loaded — so the NEXT round's `tools` array carries their full definitions and they
 * stay callable for the rest of the session.
 *
 * Deliberately an ordinary function tool rather than a vendor block. Anthropic and OpenAI each ship
 * a server-side tool search, but neither reduces the request payload (the API needs every definition
 * to run the search), Gemini has no equivalent at all, and both vendors document a client-executed
 * search as the portable form. One shape therefore runs everywhere and saves both wire bytes and
 * context tokens.
 *
 * Two results are NOT errors, and the distinction is the contract:
 * - a query that matches nothing returns `{ loaded: [], unavailableSources: [] }` — a normal empty
 *   answer, mirroring the vendor's own empty `tool_references` array;
 * - an unknown entry in `names` throws, naming the entry, and loads nothing — asking for a tool that
 *   does not exist is a mistake to correct, not an empty search.
 *
 * `unavailableSources` is present and empty from day one. MCP-003 (the connection and capability
 * supervisor) fills it with servers that failed or need auth, so a model told "nothing matched" can
 * tell that apart from "the server holding it is down" — without a contract change here.
 */

import { TOOL_SEARCH_TOOL_NAME } from '@robota-sdk/agent-core';
import { z } from 'zod';

import { DEFAULT_TOOL_SEARCH_LIMIT, matchDeferredTools } from './tool-search-matching.js';
import { createZodFunctionTool } from '../implementations/function-tool';

import type { IBuiltinToolDescriptionOptions } from './tool-options.js';
import type { IToolInvocationResult } from '../types/tool-result.js';
import type {
  FunctionTool,
  IDeferredToolCatalog,
  IToolExecutionContext,
  IToolSchema,
} from '@robota-sdk/agent-core';

// CORE-030: defining a tool and telling the permission system what it does arrive together.
import '../tool-permission-profiles.js';

/**
 * The registered name — agent-core's own constant, re-exported under this package's name so the
 * execution layer's unknown-tool remedy and this tool can never name two different things.
 */
export const TOOL_SEARCH_NAME = TOOL_SEARCH_TOOL_NAME;

const ToolSearchSchema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Text matched case-insensitively against each withheld tool's name, description, and its " +
        "parameters' names and descriptions. An exact tool name is a valid query.",
    ),
  names: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Exact tool names to load, skipping the search. An unknown name is an error naming it.',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Maximum tools to load from a query match (default ${DEFAULT_TOOL_SEARCH_LIMIT}).`),
});

type TToolSearchArgs = z.infer<typeof ToolSearchSchema>;

/** What the model gets back: what is now callable, and what could not be consulted. */
export interface IToolSearchOutput {
  loaded: Array<{ name: string; description: string }>;
  unavailableSources: string[];
}

const TOOL_SEARCH_DESCRIPTION = [
  'Load tools whose definitions are withheld from your tool list, so you can call them.',
  '',
  'Some tools are deferred: they exist and are callable, but their schemas are not sent to you until',
  'you load them here. If a capability you need is not in your tool list, search for it before',
  'concluding it is unavailable — and if a tool call fails as "deferred and not yet loaded", load it',
  'with this tool and call it again.',
  '',
  ' - query: what you are trying to do (e.g. "read a spreadsheet", "postgres"). Matched against tool',
  '   names, descriptions, and parameter names and descriptions. An exact tool name works too.',
  ` - names: load exactly these tools, skipping the search. Unknown names are an error.`,
  ` - limit: how many matches to load (default ${DEFAULT_TOOL_SEARCH_LIMIT}).`,
  '',
  'The result lists what is now loaded; those tools appear in your tool list from your next turn and',
  'stay available. A query that matches nothing returns an empty list — that is a normal answer, not',
  'a failure. `unavailableSources` names any tool source that could not be consulted.',
].join('\n');

/**
 * The catalog the runtime injects, or a thrown wiring error.
 *
 * Its absence is not a runtime condition to degrade around: `ToolExecutionService` attaches this
 * port to every tool call it issues, so a missing one means this tool was invoked outside the
 * execution loop. Guessing an empty catalog there would report "nothing matched" for a search that
 * was never actually run.
 */
function requireCatalog(context: IToolExecutionContext | undefined): IDeferredToolCatalog {
  const catalog = context?.deferredTools;
  if (!catalog) {
    throw new Error(
      `${TOOL_SEARCH_NAME} requires the deferred-tool catalog, which the execution runtime injects; ` +
        'it was not present, so this tool was called outside the agent execution loop.',
    );
  }
  return catalog;
}

/** Which schemas this call loads: the exact `names`, else the query's ranked matches. */
function selectTools(args: TToolSearchArgs, catalog: IDeferredToolCatalog): IToolSchema[] {
  if (args.names !== undefined) {
    // Loaded by name, not searched: an unknown entry throws from the catalog, naming it.
    return catalog.loadDeferredTools(args.names);
  }
  if (args.query === undefined) {
    throw new Error(
      `${TOOL_SEARCH_NAME} needs either "query" to search for tools or "names" to load exact ones.`,
    );
  }
  const matches = matchDeferredTools(
    catalog.listDeferredTools(),
    args.query,
    args.limit ?? DEFAULT_TOOL_SEARCH_LIMIT,
  );
  // An empty match loads nothing, and that is the answer — not an error and not the whole catalog.
  return catalog.loadDeferredTools(matches.map((schema) => schema.name));
}

/**
 * Create a `ToolSearch` tool instance — register it RESIDENT with the agent's tool registry.
 *
 * It must never itself be deferred: a search tool the model cannot see is a catalog with no way in,
 * which is the state the vendor's own "at least one tool must stay resident" invariant forbids.
 */
export function createToolSearchTool(options: IBuiltinToolDescriptionOptions = {}): FunctionTool {
  return createZodFunctionTool(
    TOOL_SEARCH_NAME,
    options.description ?? TOOL_SEARCH_DESCRIPTION,
    ToolSearchSchema,
    async (params, context) => {
      const loaded = selectTools(params, requireCatalog(context));
      const output: IToolSearchOutput = {
        loaded: loaded.map(({ name, description }) => ({ name, description })),
        unavailableSources: [],
      };
      const result: IToolInvocationResult = { success: true, output: JSON.stringify(output) };
      return JSON.stringify(result);
    },
  );
}

/** `ToolSearch` tool instance — register with the Robota agent tools registry. */
export const toolSearchTool = createToolSearchTool();
