/**
 * The host allowlist for MCP header helpers: `mcpHeaderHelpers` in the user's own settings.
 *
 * A header helper is a program a definition asks the host to run, so the authority to run it cannot
 * come from a definition, a repository or a plugin. Only user settings may list one, and a listing
 * anywhere else is reported and ignored rather than merged. An entry is an exact executable and an
 * exact argument list — the same shape a definition's `headersHelper` has — so the user allows one
 * command line, never a program with whatever arguments a definition supplies.
 *
 * A malformed list is refused whole: a partially read allowlist would allow less than the user
 * wrote without saying which part was dropped.
 */

import { isAbsolute } from 'node:path';

import { readSettingsSourceText } from '@robota-sdk/agent-framework';

import type { TSettingsSource } from '@robota-sdk/agent-framework';
import type { IMCPHeadersHelper } from '@robota-sdk/agent-mcp';

export const MCP_HEADER_HELPERS_KEY = 'mcpHeaderHelpers';

export interface IMcpHeaderHelperAllowlist {
  readonly allowed: readonly IMCPHeadersHelper[];
  /** One line per refused or ignored listing; none quotes a command or argument. */
  readonly diagnostics: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArgv(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((part) => typeof part === 'string');
}

function decodeEntry(value: unknown): IMCPHeadersHelper | undefined {
  if (!isPlainObject(value)) return undefined;
  if (Object.keys(value).some((key) => key !== 'command' && key !== 'args')) return undefined;
  const command = value['command'];
  const args = value['args'] ?? [];
  if (typeof command !== 'string' || !isAbsolute(command) || !isArgv(args)) return undefined;
  return { command, args: [...args] };
}

/** Read every user settings source's `mcpHeaderHelpers`, and report any other source's. */
export function resolveMcpHeaderHelperAllowlist(
  settingsSources: readonly TSettingsSource[],
): IMcpHeaderHelperAllowlist {
  const allowed: IMCPHeadersHelper[] = [];
  const diagnostics: string[] = [];
  for (const source of settingsSources) {
    const text = readSettingsSourceText(source, 'resolve MCP header helper allowlist');
    if (text === undefined || text.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // allow-fallback: an unreadable file allows nothing. Its parse failure is already reported,
      // once, by the definition sourcing that reads the same text.
      continue;
    }
    if (!isPlainObject(parsed) || parsed[MCP_HEADER_HELPERS_KEY] === undefined) continue;
    if (source.kind !== 'host' || source.scope !== 'user') {
      diagnostics.push(
        `"${MCP_HEADER_HELPERS_KEY}" in ${source.displayName} was ignored: only user settings may allow a header helper.`,
      );
      continue;
    }
    const listed = parsed[MCP_HEADER_HELPERS_KEY];
    const entries = Array.isArray(listed) ? listed.map(decodeEntry) : undefined;
    if (entries === undefined || entries.some((entry) => entry === undefined)) {
      diagnostics.push(
        `"${MCP_HEADER_HELPERS_KEY}" in ${source.displayName} was refused: it must be an array of ` +
          '{"command": "/absolute/path", "args": [...]} objects.',
      );
      continue;
    }
    allowed.push(...(entries as IMCPHeadersHelper[]));
  }
  return { allowed, diagnostics };
}
