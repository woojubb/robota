import { loadHostBundlePluginInspectionFromScopes } from '@robota-sdk/agent-framework';
import { decodeSource } from '@robota-sdk/agent-mcp';
import { pluginScopeDirs } from '../plugins/default-plugin-command-source-loader.js';
import { productUserSettingsPath } from '../product/user-settings.js';
import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import type { IMCPSourceCandidates } from '@robota-sdk/agent-mcp';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function pluginRootValues(value: unknown, root: string): unknown {
  if (typeof value === 'string') return value.replaceAll('${CLAUDE_PLUGIN_ROOT}', root);
  if (Array.isArray(value)) return value.map((member) => pluginRootValues(member, root));
  if (object(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, pluginRootValues(member, root)]),
    );
  return value;
}

/** Inspection only. Activation still uses the existing plugin trust, approval and host authority gates. */
export function pluginMcpCandidates(
  runtime: ICliRuntimeContext,
  cwd: string,
  projectAccess: TWorkspaceProjectAccess,
): IMCPSourceCandidates[] {
  const results: IMCPSourceCandidates[] = [];
  const seen = new Set<string>();
  for (const inspection of loadHostBundlePluginInspectionFromScopes(
    pluginScopeDirs(cwd, runtime, projectAccess),
    { settingsPath: productUserSettingsPath(runtime) },
  )) {
    for (const skipped of inspection.skipped) {
      if (skipped.reason === 'disabled') continue;
      const origin = skipped.manifestPath;
      results.push({
        source: 'plugin',
        origin,
        definitions: [],
        problems: [
          {
            name: '',
            source: 'plugin',
            origin,
            reason: `bundle ${skipped.reason}${skipped.detail ? `: ${skipped.detail}` : ''}`,
          },
        ],
      });
    }
    for (const plugin of inspection.loaded) {
      if (seen.has(plugin.manifest.name)) continue;
      seen.add(plugin.manifest.name);
      if (plugin.mcpConfig === undefined) continue;
      const config = plugin.mcpConfig;
      if (!object(config) || !object(config.mcpServers)) {
        const origin = plugin.pluginDir;
        results.push({ ...decodeSource(config, 'plugin', origin), source: 'plugin', origin });
        continue;
      }
      for (const [name, raw] of Object.entries(config.mcpServers)) {
        const serverId = `${plugin.manifest.name}:${name}`;
        const origin =
          plugin.mcpSourcePaths && Object.hasOwn(plugin.mcpSourcePaths, name)
            ? plugin.mcpSourcePaths[name]!
            : plugin.pluginDir;
        const entry =
          object(raw) && raw.type === undefined
            ? {
                ...raw,
                type:
                  typeof raw.command === 'string'
                    ? 'stdio'
                    : typeof raw.url === 'string'
                      ? 'http'
                      : undefined,
              }
            : raw;
        results.push({
          ...decodeSource(
            { mcpServers: { [serverId]: pluginRootValues(entry, plugin.pluginDir) } },
            'plugin',
            origin,
          ),
          source: 'plugin',
          origin,
        });
      }
    }
  }
  return results;
}
