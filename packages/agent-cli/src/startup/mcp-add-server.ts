/**
 * Adding an MCP server to the user's own settings, approved by the person who asked for it.
 *
 * Web search for a model without native search comes from an MCP server the user picks, so this is
 * the one place the product names two such services and the one writer of `mcpServers`. Two
 * entries share it: the first-start question (`first-run-web-search.ts`) and `mcp add`.
 * Both are a person acting at a terminal, which is why the server is approved here rather than left
 * `pending`; no slash command and no model-invocable path reaches this.
 */

import { createNodeHostSettingsStore } from '@robota-sdk/agent-framework';
import { MCPActivationAdmissionService, MCPDefinitionRegistry } from '@robota-sdk/agent-mcp';

import { productUserSettingsPath } from '../product/user-settings.js';
import { resolveMcpDefinitions } from './mcp-definition-sources.js';

import type { TSettingsData, TSettingsSource } from '@robota-sdk/agent-framework';
import type { IMCPActivationApprovalStore, IMCPActivationRequest } from '@robota-sdk/agent-mcp';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

export interface IWebSearchMcpChoice {
  /** The name the server is stored under, and the word `mcp add` accepts. */
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

/** Keyless web search over MCP. Product choices live here, not in a package under `packages/`. */
export const WEB_SEARCH_MCP_CATALOG: readonly IWebSearchMcpChoice[] = Object.freeze([
  Object.freeze({ id: 'exa', label: 'Exa', url: 'https://mcp.exa.ai/mcp' }),
  Object.freeze({ id: 'parallel', label: 'Parallel', url: 'https://mcp.parallel.ai/mcp' }),
]);

/**
 * The alphabet MCP tool names expose (`<server>__<tool>`): any other character in a server name is
 * rewritten there, so two names could end up as one tool prefix.
 */
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;

export function isMcpServerName(name: string): boolean {
  return SERVER_NAME.test(name);
}

export interface IMcpAddRequest {
  readonly name: string;
  /** Absolute `https:` URL, already normalised. */
  readonly url: string;
}

/** What the command line asked for, or why it cannot be answered. */
export type TMcpAddParse =
  | { readonly ok: true; readonly request: IMcpAddRequest }
  | { readonly ok: false; readonly reason: string };

/**
 * `<exa|parallel>` or `<name> <https-url>`: the words after `mcp add`.
 * A name that is not in the catalog needs its URL; a catalog word alone fills it in.
 */
export function parseMcpAddArguments(args: readonly string[]): TMcpAddParse {
  const catalogIds = WEB_SEARCH_MCP_CATALOG.map((choice) => choice.id).join('|');
  const [name, url, ...rest] = args;
  if (name === undefined || rest.length > 0 || args.some((word) => word.startsWith('-'))) {
    return { ok: false, reason: `expected <${catalogIds}> or <name> <https-url>` };
  }
  if (!isMcpServerName(name)) {
    return {
      ok: false,
      reason: `"${name}" is not a usable server name (letters, digits, "_" and "-"; at most 32 characters, starting with a letter or digit)`,
    };
  }
  if (url === undefined) {
    const choice = WEB_SEARCH_MCP_CATALOG.find((candidate) => candidate.id === name);
    if (choice === undefined) {
      return { ok: false, reason: `"${name}" needs a URL: <name> <https-url>, or one of ${catalogIds}` };
    }
    return { ok: true, request: { name: choice.id, url: choice.url } };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'the URL is not a valid absolute URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'the URL must use https' };
  }
  return { ok: true, request: { name, url: parsed.href } };
}

/** The URL without its query or fragment, which may carry a key the user typed. */
function displayUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

export interface IAddUserMcpServerDeps {
  readonly productRuntime: ICliRuntimeContext;
  /** The settings sources a startup resolves MCP definitions from: approval is matched against them. */
  readonly settingsSources: readonly TSettingsSource[];
  readonly env: NodeJS.ProcessEnv;
  readonly approvalStore: IMCPActivationApprovalStore;
}

export type TAddUserMcpServerResult =
  | {
      /** `added`: written now. `unchanged`: the identical entry was already there. */
      readonly outcome: 'added' | 'unchanged';
      readonly name: string;
      readonly url: string;
      readonly settingsPath: string;
    }
  | { readonly outcome: 'refused'; readonly reason: string };

function isSettingsObject(value: TSettingsData[string]): value is TSettingsData {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function isSameHttpEntry(entry: TSettingsData[string], request: IMcpAddRequest): boolean {
  if (!isSettingsObject(entry)) return false;
  const keys = Object.keys(entry);
  return keys.length === 2 && entry['type'] === 'http' && entry['url'] === request.url;
}

/**
 * Write `{ "type": "http", "url" }` under `mcpServers.<name>` in the product's user settings and
 * record the user's approval of exactly that definition.
 *
 * Every other key survives. A different entry under the same name is refused, never replaced; the
 * identical one is kept and approved again. The approval is built from the same resolved sources a
 * startup reads, so the record matches by server, source, origin file and definition — `/mcp` and the
 * next start inspect it as `approved`. A name a higher-precedence source (project, local, managed)
 * also defines is refused: approving here would grant nothing, and must never grant that source.
 */
export function addUserMcpServer(
  request: IMcpAddRequest,
  deps: IAddUserMcpServerDeps,
): TAddUserMcpServerResult {
  const settingsPath = productUserSettingsPath(deps.productRuntime);
  const store = createNodeHostSettingsStore('user', settingsPath);
  const document = store.read();
  if (!isSettingsObject(document)) {
    return { outcome: 'refused', reason: `${settingsPath} does not hold a JSON object` };
  }
  const servers = document['mcpServers'];
  if (servers !== undefined && !isSettingsObject(servers)) {
    return { outcome: 'refused', reason: `\`mcpServers\` in ${settingsPath} is not an object` };
  }

  const current = resolveMcpDefinitions(deps.settingsSources, deps.env).entries.find(
    (entry) => entry.name === request.name,
  );
  const stored = servers === undefined ? undefined : servers[request.name];
  const identical = stored !== undefined && isSameHttpEntry(stored, request);
  if (stored !== undefined && !identical) {
    return {
      outcome: 'refused',
      reason: `an MCP server named "${request.name}" is already configured in ${settingsPath} with a different definition; nothing was changed`,
    };
  }
  const ours = current?.source === 'user' && current.origin === settingsPath;
  if (current !== undefined && !ours) {
    return {
      outcome: 'refused',
      reason: `an MCP server named "${request.name}" is already defined by the ${current.source} settings (${current.origin}); nothing was changed`,
    };
  }

  if (!identical) {
    store.write({
      ...document,
      mcpServers: { ...servers, [request.name]: { type: 'http', url: request.url } },
    });
  }

  const approvalRequest = approvalRequestFor(request.name, settingsPath, deps);
  const admission = new MCPActivationAdmissionService(deps.approvalStore);
  const inspected = admission.inspect(approvalRequest);
  const status = inspected.status === 'approved' ? inspected : admission.approve(approvalRequest, 'user');
  if (status.status !== 'approved') {
    throw new Error(
      `MCP server "${request.name}" was written to ${settingsPath} but could not be approved (${status.reason})`,
    );
  }
  return {
    outcome: identical ? 'unchanged' : 'added',
    name: request.name,
    url: request.url,
    settingsPath,
  };
}

/** The activation request a startup would build for this user entry, from the same sources. */
function approvalRequestFor(
  name: string,
  settingsPath: string,
  deps: IAddUserMcpServerDeps,
): IMCPActivationRequest {
  const { entries } = resolveMcpDefinitions(deps.settingsSources, deps.env);
  const found = new MCPDefinitionRegistry(entries, {})
    .list()
    .find(
      (candidate) =>
        candidate.serverId === name &&
        candidate.source === 'user' &&
        candidate.provenance.id === settingsPath,
    );
  if (found === undefined) {
    throw new Error(
      `MCP server "${name}" was written to ${settingsPath} but is not an activatable user definition; run /mcp status in a session`,
    );
  }
  return found;
}

export interface IMcpAddCommandDeps extends IAddUserMcpServerDeps {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** What a successful add says, shared by the command and the first-start question. */
export function describeAddedMcpServer(
  result: Extract<TAddUserMcpServerResult, { outcome: 'added' | 'unchanged' }>,
  cliName: string,
  connectsNow: boolean,
): string {
  const lead =
    result.outcome === 'added'
      ? `Added MCP server "${result.name}" (${displayUrl(result.url)}) to ${result.settingsPath}.`
      : `MCP server "${result.name}" (${displayUrl(result.url)}) was already in ${result.settingsPath}.`;
  const when = connectsNow ? 'in this session' : `the next time ${cliName} starts`;
  return `${lead}\nIt is approved and connects ${when}; withdraw it with /mcp revoke ${result.name}.\n`;
}

/** `mcp add <exa|parallel|name url>`; the exit code. */
export function runMcpAddCommand(args: readonly string[], deps: IMcpAddCommandDeps): number {
  const cliName = deps.productRuntime.config.identity.cliName;
  const parsed = parseMcpAddArguments(args);
  if (!parsed.ok) {
    deps.stderr(`${parsed.reason}\nUsage: ${cliName} mcp add <${WEB_SEARCH_MCP_CATALOG.map((choice) => choice.id).join('|')}> | ${cliName} mcp add <name> <https-url>\n`);
    return 1;
  }
  try {
    const result = addUserMcpServer(parsed.request, deps);
    if (result.outcome === 'refused') {
      deps.stderr(`${result.reason}\n`);
      return 1;
    }
    deps.stdout(describeAddedMcpServer(result, cliName, false));
    return 0;
  } catch (error) {
    // allow-fallback: a failed write or approval is reported, and the command exits non-zero
    deps.stderr(`${error instanceof Error ? error.message : 'The MCP server could not be added.'}\n`);
    return 1;
  }
}
