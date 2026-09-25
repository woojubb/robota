/**
 * MCP-002 sourcing: turn the product's already-layered settings sources into the
 * `IMCPResolvedEntry[]` `@robota-sdk/agent-mcp`'s `MCPDefinitionRegistry` (and this product's
 * `createMcpClientComposition`) need.
 *
 * `agent-mcp` owns decoding one `mcpServers` object and resolving precedence across sources
 * (MCP-001, ADR-005); this module owns exactly one thing neither of those does: reading the
 * product's OWN settings sources (`@robota-sdk/agent-framework`'s `readSettingsSourceText`) and
 * mapping each one to the source/origin pair `agent-mcp`'s decoder expects.
 *
 * `inspectSettingsLayers`/`readSettingsLayers` are NOT used here: their layers expose only the
 * SCHEMA-TYPED `settings` document, and `SettingsSchema` does not declare `mcpServers` — a key it
 * does not know about is stripped before this module would ever see it. `readSettingsSourceText`
 * is the one exported reader that hands back the source's un-stripped text, so this module parses
 * it itself. No file I/O beyond that one call — the settings sources already know how to read — and
 * no network.
 */

import { readSettingsSourceText } from '@robota-sdk/agent-framework';
import { decodeSource, materializeDefinition, resolveByPrecedence } from '@robota-sdk/agent-mcp';

import type { TSettingsSource } from '@robota-sdk/agent-framework';
import type {
  IMCPDefinitionProblem,
  IMCPResolvedEntry,
  IMCPSourceCandidates,
  TMCPDefinitionSource,
} from '@robota-sdk/agent-mcp';

/** What sourcing produced: the entries `MCPDefinitionRegistry` can resolve, and everything that
 * kept a source or an entry from contributing — reported, never silently dropped.
 *
 * `problems` is every refused entry AND every source-level problem, for the one-line-per-problem
 * startup diagnostic (`mcp-startup.ts`). `sourceProblems` is the source-scoped subset alone
 * (`resolveByPrecedence`'s carrier for issue #2794: a config root that is not an object, no
 * `mcpServers`, `mcpServers` not an object, or invalid JSON) — kept separate so a LIVE view (the
 * `/mcp` command) can say which source could not be read without re-deriving it from `problems` by
 * an empty-name convention. When `sourceProblems` names the MANAGED tier, `entries` already reflects
 * `resolveByPrecedence`'s fail-closed rule: nothing resolves from ANY source while it is broken, not
 * only the names managed happens to declare — this module does not re-derive or relax that. */
export interface IMcpDefinitionResolution {
  readonly entries: readonly IMCPResolvedEntry[];
  readonly problems: readonly IMCPDefinitionProblem[];
  readonly sourceProblems: readonly IMCPDefinitionProblem[];
}

/**
 * The one JSON boundary in this module: a settings source's raw text has no schema at this point
 * (that is the whole reason it is read this way — see the module doc), so its parsed shape has to
 * be read through an `unknown`-shaped guard rather than a typed accessor.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A fixed, value-free description of a `JSON.parse` failure — never `Error#message` itself.
 *
 * Node's JSON parser echoes a fragment of the SOURCE TEXT into that message for several malformed
 * inputs — not only the unterminated/unquoted-value cases: `JSON.parse('not json at all')` throws
 * `Unexpected token 'o', "not json at all" is not valid JSON`. A settings file corrupted mid-secret
 * (`"API_KEY": sk-live-...` with a missing closing quote) throws a message containing that secret
 * text verbatim, which this module would otherwise carry, unredacted, into a diagnostic and into
 * `/mcp status`'s rendered output. Only the position Node's OWN generated suffix names — never any
 * substring the regex did not anchor to that suffix — survives here; every other input yields the
 * fixed string with no position at all, rather than risk echoing content that happens to also match.
 */
export function describeJsonParseFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const located = /\bat position (\d+)(?: \(line (\d+) column (\d+)\))?/i.exec(message);
  if (located === undefined || located === null) return 'invalid JSON';
  const [, position, line, column] = located;
  if (line !== undefined && column !== undefined) {
    return `invalid JSON (line ${line}, column ${column})`;
  }
  return `invalid JSON (position ${position})`;
}

/**
 * Maps a settings source to the `TMCPDefinitionSource` `agent-mcp`'s precedence order is keyed by.
 * A host source's scope (`'managed' | 'user'`) already spells the same two `TMCPDefinitionSource`
 * members; a workspace project source's two scopes each name a different member.
 *
 * Exported for `mcp-settings.ts` (MCP-004 S3), which layers the `mcp` settings object across the
 * SAME sources by the SAME precedence — one mapping, not a second copy that could drift from this one.
 */
export function definitionSourceOf(source: TSettingsSource): TMCPDefinitionSource {
  if (source.kind === 'host') return source.scope;
  switch (source.scope) {
    case 'project':
      return 'project';
    case 'project-local':
      return 'local';
  }
}

/**
 * One settings source's contribution: usable `mcpServers` candidates (possibly none, alongside a
 * source-level problem when the text failed to parse as JSON), or nothing (an absent source, or a
 * source that parses but declares no `mcpServers` — neither is a problem; there is nothing to report
 * on).
 *
 * A parse failure becomes an `IMCPSourceCandidates` with zero definitions and one source-scoped
 * problem (`name: ''`, the same convention `decodeSource` uses for a container-level problem — issue
 * #2794) rather than being reported out-of-band: it must reach `resolveByPrecedence` exactly like
 * every other source-level problem so a parse failure in the MANAGED tier fails closed the same way
 * an unreadable-but-parseable managed policy does, instead of silently skipping that rule.
 */
function candidatesOf(source: TSettingsSource): IMCPSourceCandidates | undefined {
  const text = readSettingsSourceText(source, 'resolve MCP server definitions');
  if (text === undefined || text.trim() === '') return undefined;

  const definitionSource = definitionSourceOf(source);
  const origin = source.displayName;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // allow-fallback: a corrupt settings file is reported as a source-scoped problem, never treated
    // as "no MCP servers configured" — a fixed, value-free description is used (`reason`), never
    // `Error#message` itself (see `describeJsonParseFailure`'s doc for why).
    return {
      source: definitionSource,
      origin,
      definitions: [],
      problems: [
        { name: '', source: definitionSource, origin, reason: describeJsonParseFailure(error) },
      ],
    };
  }

  if (!isPlainObject(parsed) || parsed['mcpServers'] === undefined) return undefined;

  const decoded = decodeSource(parsed, definitionSource, origin);
  return {
    source: definitionSource,
    origin,
    definitions: decoded.definitions,
    problems: decoded.problems,
  } satisfies IMCPSourceCandidates;
}

/**
 * Read every settings source, decode the `mcpServers` object each one declares, and resolve
 * precedence across all of them into the entries `createMcpClientComposition` needs.
 *
 * `env` is used only to materialize `${VAR}` templates in the winning definitions
 * (`agent-mcp`'s `materializeDefinition`) — never to decide which source wins. `resolveByPrecedence`
 * is the SINGLE place that turns per-source problems into both `entries` (fail-closed on the managed
 * tier) and `sourceProblems`; this function does not re-derive either one.
 */
export function resolveMcpDefinitions(
  settingsSources: readonly TSettingsSource[],
  env: NodeJS.ProcessEnv,
): IMcpDefinitionResolution {
  const candidates: IMCPSourceCandidates[] = [];
  for (const source of settingsSources) {
    const result = candidatesOf(source);
    if (result !== undefined) candidates.push(result);
  }

  const problems = candidates.flatMap((candidate) => candidate.problems);
  const { entries, sourceProblems } = resolveByPrecedence(candidates, (definition) =>
    materializeDefinition(definition, env),
  );
  return { entries, problems, sourceProblems };
}
