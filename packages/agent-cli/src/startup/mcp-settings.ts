/**
 * MCP-004 S3: read the `mcp` settings object (`autoBackgroundMs`, `callTimeoutMs`) from the SAME
 * layered settings documents `mcpServers` is read from (`mcp-definition-sources.ts`).
 *
 * `agent-framework`'s `SettingsSchema` does not declare `mcp` (same reason `mcpServers` is read this
 * way — see `mcp-definition-sources.ts`'s module doc), so this module reads each source's raw text
 * itself via `readSettingsSourceText` + `JSON.parse`, exactly mirroring `mcp-definition-sources.ts`.
 * `SettingsSchema` is NOT touched by this unit.
 *
 * Layering is PER KEY, not whole-object like `mcpServers` (the agent-mcp SPEC's rule that entries
 * are never field-merged is about one server DEFINITION; `autoBackgroundMs` and `callTimeoutMs` are two independent
 * scalars, and a host commonly sets one in a managed policy and leaves the other to the user layer).
 * Sources are folded from LOWEST to HIGHEST precedence (`MCP_SOURCE_PRECEDENCE`, reversed) so a
 * higher-precedence document overrides a lower one key by key.
 *
 * Validation policy (decided here, since the spec leaves the exact behaviour to this module):
 * a negative or non-integer value for EITHER key makes that document's WHOLE `mcp` object refused —
 * both keys it declared are ignored, one problem is reported per invalid key, and folding continues
 * as if that document had never declared an `mcp` object at all (the running value from the next
 * lower-precedence document, or the built-in default, is kept). This mirrors `resolveByPrecedence`'s
 * "a malformed winner still shadows, never falls through to a partially-decoded value" rule: a
 * managed policy that got one field wrong must not have its OTHER field trusted either, and a lower
 * layer must not silently inherit responsibility for a value the higher layer clearly meant to set.
 */

import { readSettingsSourceText } from '@robota-sdk/agent-framework';
import { MCP_SOURCE_PRECEDENCE } from '@robota-sdk/agent-mcp';

import { definitionSourceOf, describeJsonParseFailure } from './mcp-definition-sources.js';

import type { TSettingsSource } from '@robota-sdk/agent-framework';
import type { TMCPDefinitionSource } from '@robota-sdk/agent-mcp';

/** Built-in defaults (spec § Budget and threshold). */
export const DEFAULT_MCP_AUTO_BACKGROUND_MS = 120_000;
export const DEFAULT_MCP_CALL_TIMEOUT_MS = 600_000;

const MCP_SETTINGS_KEYS = ['autoBackgroundMs', 'callTimeoutMs'] as const;
export type TMcpSettingsKey = (typeof MCP_SETTINGS_KEYS)[number];

/** Why a document's `mcp` object (or one of its keys) could not be used — reported, never guessed at. */
export interface IMcpSettingsProblem {
  readonly key: TMcpSettingsKey | '*';
  readonly source: TMCPDefinitionSource;
  readonly origin: string;
  readonly reason: string;
}

/** What settings resolution produced. */
export interface IMcpSettingsResolution {
  readonly autoBackgroundMs: number;
  readonly callTimeoutMs: number;
  /** `false` when `autoBackgroundMs` is `0`, or when `autoBackgroundMs >= callTimeoutMs`. */
  readonly handoffEnabled: boolean;
  /** Every rejected document/key, one entry each — never silently defaulted. */
  readonly problems: readonly IMcpSettingsProblem[];
  /** Non-error notices (currently: the `autoBackgroundMs >= callTimeoutMs` degradation). */
  readonly diagnostics: readonly string[];
}

/** Lowest precedence first, so folding left-to-right lets a later (higher-precedence) source win. */
const ASCENDING_PRECEDENCE: readonly TMCPDefinitionSource[] = [...MCP_SOURCE_PRECEDENCE].reverse();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidMcpSettingValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

interface IParsedMcpSource {
  readonly source: TMCPDefinitionSource;
  readonly origin: string;
  readonly mcp: Record<string, unknown>;
}

/**
 * One settings source's `mcp` object, or a problem naming why it could not be read — mirrors
 * `mcp-definition-sources.ts`'s `candidatesOf`. `undefined` is a normal outcome: an absent source, a
 * source whose text is empty, or a source that parses but declares no `mcp` key.
 */
function mcpObjectOf(source: TSettingsSource): IParsedMcpSource | IMcpSettingsProblem | undefined {
  const text = readSettingsSourceText(source, 'resolve MCP background-handoff settings');
  if (text === undefined || text.trim() === '') return undefined;

  const definitionSource = definitionSourceOf(source);
  const origin = source.displayName;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // allow-fallback: a corrupt settings file is reported as a named problem, never treated as "no
    // mcp settings configured" — a fixed, value-free description is used (`reason`), never
    // `Error#message` itself, which can echo a fragment of the source text — including a secret
    // sitting beside a malformed value — verbatim (see `describeJsonParseFailure`'s doc).
    return { key: '*', source: definitionSource, origin, reason: describeJsonParseFailure(error) };
  }

  if (!isPlainObject(parsed) || parsed['mcp'] === undefined) return undefined;
  const mcp = parsed['mcp'];
  if (!isPlainObject(mcp)) {
    return {
      key: '*',
      source: definitionSource,
      origin,
      reason: `"mcp" must be an object, got ${typeof mcp}`,
    };
  }

  return { source: definitionSource, origin, mcp };
}

/**
 * Read every settings source, decode the `mcp` object each one declares, and fold `autoBackgroundMs`
 * / `callTimeoutMs` across all of them by precedence, one key at a time.
 */
export function resolveMcpSettings(
  settingsSources: readonly TSettingsSource[],
): IMcpSettingsResolution {
  const problems: IMcpSettingsProblem[] = [];
  const parsed: IParsedMcpSource[] = [];

  for (const source of settingsSources) {
    const result = mcpObjectOf(source);
    if (result === undefined) continue;
    if ('mcp' in result) parsed.push(result);
    else problems.push(result);
  }

  // Ascending-precedence fold: each source is checked for BOTH keys before any value is applied —
  // an invalid key refuses the WHOLE document's `mcp` object (see module doc), so a valid sibling
  // key in the same document must not be applied either.
  const rankOf = (source: TMCPDefinitionSource): number => ASCENDING_PRECEDENCE.indexOf(source);
  const ordered = [...parsed].sort((a, b) => rankOf(a.source) - rankOf(b.source));

  let autoBackgroundMs = DEFAULT_MCP_AUTO_BACKGROUND_MS;
  let callTimeoutMs = DEFAULT_MCP_CALL_TIMEOUT_MS;

  for (const candidate of ordered) {
    const values: Partial<Record<TMcpSettingsKey, number>> = {};
    let refused = false;

    for (const key of MCP_SETTINGS_KEYS) {
      const raw = candidate.mcp[key];
      if (raw === undefined) continue;
      if (!isValidMcpSettingValue(raw)) {
        refused = true;
        problems.push({
          key,
          source: candidate.source,
          origin: candidate.origin,
          reason: `"${key}" must be a non-negative integer, got ${JSON.stringify(raw)}`,
        });
        continue;
      }
      values[key] = raw;
    }

    if (refused) continue; // The whole document's `mcp` object is refused; the running values stand.
    if (values.autoBackgroundMs !== undefined) autoBackgroundMs = values.autoBackgroundMs;
    if (values.callTimeoutMs !== undefined) callTimeoutMs = values.callTimeoutMs;
  }

  const diagnostics: string[] = [];
  let handoffEnabled = autoBackgroundMs > 0;
  if (handoffEnabled && autoBackgroundMs >= callTimeoutMs) {
    handoffEnabled = false;
    diagnostics.push(
      `MCP tool-call handoff disabled: "mcp.autoBackgroundMs" (${autoBackgroundMs}) must be less than "mcp.callTimeoutMs" (${callTimeoutMs}).`,
    );
  }

  return { autoBackgroundMs, callTimeoutMs, handoffEnabled, problems, diagnostics };
}
