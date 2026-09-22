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
 * kept a source or an entry from contributing — reported, never silently dropped. */
export interface IMcpDefinitionResolution {
  readonly entries: readonly IMCPResolvedEntry[];
  readonly problems: readonly IMCPDefinitionProblem[];
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
 * Maps a settings source to the `TMCPDefinitionSource` `agent-mcp`'s precedence order is keyed by.
 * A host source's scope (`'managed' | 'user'`) already spells the same two `TMCPDefinitionSource`
 * members; a workspace project source's two scopes each name a different member.
 */
function definitionSourceOf(source: TSettingsSource): TMCPDefinitionSource {
  if (source.kind === 'host') return source.scope;
  switch (source.scope) {
    case 'project':
      return 'project';
    case 'project-local':
      return 'local';
  }
}

/**
 * One settings source's contribution: usable `mcpServers` candidates, a source-level problem (the
 * text failed to parse as JSON), or nothing (an absent source, or a source that parses but declares
 * no `mcpServers` — neither is a problem; there is nothing to report on).
 */
function candidatesOf(
  source: TSettingsSource,
): IMCPSourceCandidates | IMCPDefinitionProblem | undefined {
  const text = readSettingsSourceText(source, 'resolve MCP server definitions');
  if (text === undefined || text.trim() === '') return undefined;

  const definitionSource = definitionSourceOf(source);
  const origin = source.displayName;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // allow-fallback: a corrupt settings file is reported as a named problem, never treated as "no
    // MCP servers configured" — the parse error is used (`reason`), not dropped.
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: '*',
      source: definitionSource,
      origin,
      reason: `invalid JSON: ${message}`,
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

function isSourceCandidates(
  value: IMCPSourceCandidates | IMCPDefinitionProblem,
): value is IMCPSourceCandidates {
  return 'definitions' in value;
}

/**
 * Read every settings source, decode the `mcpServers` object each one declares, and resolve
 * precedence across all of them into the entries `createMcpClientComposition` needs.
 *
 * `env` is used only to materialize `${VAR}` templates in the winning definitions
 * (`agent-mcp`'s `materializeDefinition`) — never to decide which source wins.
 */
export function resolveMcpDefinitions(
  settingsSources: readonly TSettingsSource[],
  env: NodeJS.ProcessEnv,
): IMcpDefinitionResolution {
  const candidates: IMCPSourceCandidates[] = [];
  const problems: IMCPDefinitionProblem[] = [];

  for (const source of settingsSources) {
    const result = candidatesOf(source);
    if (result === undefined) continue;
    if (isSourceCandidates(result)) {
      candidates.push(result);
      problems.push(...result.problems);
    } else {
      problems.push(result);
    }
  }

  const entries = resolveByPrecedence(candidates, (definition) =>
    materializeDefinition(definition, env),
  );
  return { entries, problems };
}
