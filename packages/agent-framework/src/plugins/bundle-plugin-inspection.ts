/**
 * Read-only classification of what `BundlePluginLoader` found (OBSERVABILITY-1991): the skip
 * vocabulary, hook-schema issues and typed `.mcp.json` server entries. Nothing here reads a file —
 * the loader hands over what it already parsed, so a pre-session doctor and the session itself
 * describe the same document.
 */
import { join } from 'node:path';

import { HooksSchema } from '../config/config-types.js';

import type {
  IBundlePluginHookIssue,
  IBundlePluginMcpFault,
  IBundlePluginMcpServer,
  IBundlePluginSkip,
  ILoadedBundlePlugin,
} from './bundle-plugin-types.js';
import type { IUniversalObjectValue, TUniversalValue } from '@robota-sdk/agent-core';

export const SKIP_MESSAGES: Record<IBundlePluginSkip['reason'], string> = {
  'manifest-unreadable': 'plugin manifest could not be read — skipping this plugin',
  'manifest-invalid': 'plugin manifest is not a valid plugin.json — skipping this plugin',
  disabled: 'plugin is disabled',
  'load-failed': 'plugin failed to load — skipping this plugin',
};

const JSON_POSITION = /position (\d+)/;

/**
 * The owner error's class plus the parser offset when it reported one — never its message text,
 * which a JSON parser fills with a quoted snippet of the file (OBSERVABILITY-1991 redaction rule).
 */
export function skipDetail(error: Error | undefined): string {
  if (error === undefined) return 'Error';
  const position = JSON_POSITION.exec(error.message);
  return position === null ? error.name : `${error.name} at position ${position[1]}`;
}

/** Where one inspection pass accumulates; `IBundlePluginInspection` minus the directory facts. */
export interface IInspectionSink {
  readonly loaded: ILoadedBundlePlugin[];
  readonly skipped: IBundlePluginSkip[];
  readonly hookIssues: IBundlePluginHookIssue[];
  readonly mcpServers: IBundlePluginMcpServer[];
  readonly mcpFaults: IBundlePluginMcpFault[];
}

function isObjectValue(value: TUniversalValue | undefined): value is IUniversalObjectValue {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

/** One `.mcp.json` server entry, typed with env KEY names only. */
function toMcpServer(
  pluginId: string,
  mcpPath: string,
  name: string,
  value: TUniversalValue | undefined,
): IBundlePluginMcpServer {
  const entry = isObjectValue(value) ? value : {};
  const command = typeof entry.command === 'string' ? entry.command : undefined;
  const url = typeof entry.url === 'string' ? entry.url : undefined;
  return {
    pluginId,
    mcpPath,
    name,
    transport: command !== undefined ? 'stdio' : url !== undefined ? 'http' : 'unknown',
    ...(command === undefined ? {} : { command }),
    ...(url === undefined ? {} : { url }),
    envKeys: isObjectValue(entry.env) ? Object.keys(entry.env) : [],
  };
}

/** Report-only: a hooks.json the settings hooks schema would refuse. Loading is unaffected. */
export function inspectHooks(
  pluginId: string,
  pluginDir: string,
  hooks: Record<string, unknown>,
  out: IBundlePluginHookIssue[],
): void {
  if (Object.keys(hooks).length === 0) return;
  const result = HooksSchema.safeParse(hooks);
  if (result.success) return;
  out.push({
    pluginId,
    hooksPath: join(pluginDir, 'hooks', 'hooks.json'),
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
    })),
  });
}

/**
 * Type the plugin's already-parsed `.mcp.json` — names, transport, command/url and env KEY names
 * only. `undefined` means no file; an unparseable file never reaches here (the plugin is
 * `load-failed`).
 */
export function inspectMcpConfig(
  pluginId: string,
  pluginDir: string,
  mcpConfig: TUniversalValue | undefined,
  sink: IInspectionSink,
): void {
  if (mcpConfig === undefined) return;
  const mcpPath = join(pluginDir, '.mcp.json');
  if (!isObjectValue(mcpConfig)) {
    sink.mcpFaults.push({ pluginId, mcpPath, reason: 'not-an-object' });
    return;
  }
  const declared = mcpConfig.mcpServers;
  if (!isObjectValue(declared)) {
    sink.mcpFaults.push({ pluginId, mcpPath, reason: 'no-servers' });
    return;
  }
  for (const [name, value] of Object.entries(declared)) {
    sink.mcpServers.push(toMcpServer(pluginId, mcpPath, name, value));
  }
}
