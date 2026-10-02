import { basename, join } from 'node:path';
import type { ILoadedBundlePlugin } from '../plugins/bundle-plugin-types.js';
import type { IContributionDescriptor } from './contribution-descriptor.js';

/** Normalize parsed bundle assets without importing code, exposing credentials, or admitting effects. */
export function describeBundleContribution(
  plugin: ILoadedBundlePlugin,
  installedIdentity: string,
): IContributionDescriptor {
  const diagnostics: IContributionDescriptor['diagnostics'][number][] = [];
  const contributions: IContributionDescriptor['contributions'][number][] = [];
  const add = (
    kind: IContributionDescriptor['contributions'][number]['kind'],
    name: string,
    source: string,
    requiredCapabilities: string[],
    reason?: string,
    disposition: 'supported' | 'unavailable' | 'unsupported' = 'supported',
  ) => {
    contributions.push({
      identity: `${plugin.manifest.name}:${kind}:${name}`,
      kind,
      source,
      requiredCapabilities,
      disposition,
      ...(reason ? { reason } : {}),
    });
  };
  for (const command of plugin.commands)
    add(
      'command',
      command.name.startsWith(`${plugin.manifest.name}:`)
        ? command.name.slice(plugin.manifest.name.length + 1)
        : command.name,
      command.skillDirectory ?? join(plugin.pluginDir, 'commands'),
      ['command-router'],
    );
  for (const skill of plugin.skills)
    add('skill', skill.name, skill.skillDirectory ?? join(plugin.pluginDir, 'skills'), [
      'skill-reader',
    ]);
  const hooks =
    typeof plugin.hooks.hooks === 'object' && plugin.hooks.hooks !== null
      ? plugin.hooks.hooks
      : plugin.hooks;
  for (const hook of Object.keys(hooks))
    add('hook', hook, join(plugin.pluginDir, 'hooks', 'hooks.json'), ['hook-executor']);
  for (const agent of plugin.agents)
    add(
      'agent',
      agent,
      join(plugin.pluginDir, 'agents'),
      ['agent-router'],
      'Agent names are inspected; execution definitions are unavailable from this adapter',
      'unavailable',
    );
  const config = plugin.mcpConfig;
  if (
    typeof config === 'object' &&
    config !== null &&
    !Array.isArray(config) &&
    !(config instanceof Date)
  ) {
    const servers = config.mcpServers;
    if (
      typeof servers === 'object' &&
      servers !== null &&
      !Array.isArray(servers) &&
      !(servers instanceof Date)
    ) {
      for (const [name, entry] of Object.entries(servers)) {
        const capabilities = ['mcp-client'];
        let usable = false;
        if (
          typeof entry === 'object' &&
          entry !== null &&
          !Array.isArray(entry) &&
          !(entry instanceof Date)
        ) {
          const transport =
            entry.type ??
            (typeof entry.command === 'string'
              ? 'stdio'
              : typeof entry.url === 'string'
                ? 'http'
                : undefined);
          if (transport === 'stdio') {
            capabilities.push('stdio-authority');
            usable = typeof entry.command === 'string';
          } else if (transport === 'http') {
            capabilities.push('http-transport');
            usable = typeof entry.url === 'string';
          }
        }
        add(
          'mcp',
          name,
          plugin.mcpSourcePaths?.[name] ?? join(plugin.pluginDir, '.mcp.json'),
          capabilities,
          usable ? undefined : 'No supported transport declaration',
          usable ? 'supported' : 'unsupported',
        );
        if (!usable) diagnostics.push({ component: 'mcp', code: 'unsupported-transport' });
      }
    }
  }
  if (
    config !== undefined &&
    (typeof config !== 'object' ||
      config === null ||
      Array.isArray(config) ||
      config instanceof Date ||
      typeof config.mcpServers !== 'object' ||
      config.mcpServers === null ||
      Array.isArray(config.mcpServers) ||
      config.mcpServers instanceof Date)
  ) {
    diagnostics.push({ component: 'mcp', code: 'invalid-configuration' });
  }
  for (const component of ['commands', 'skills', 'hooks', 'agents'] as const) {
    if (plugin.manifest[component] !== undefined) {
      diagnostics.push({ component, code: 'unsupported-component-declaration' });
      contributions.push({
        identity: `${plugin.manifest.name}:declaration:${component}`,
        kind:
          component === 'commands'
            ? 'command'
            : component === 'skills'
              ? 'skill'
              : component === 'hooks'
                ? 'hook'
                : 'agent',
        source: join(plugin.pluginDir, '.claude-plugin', 'plugin.json'),
        requiredCapabilities: [],
        disposition: 'unsupported',
        reason: 'Declared component paths are not consumed by this adapter',
      });
    }
  }
  const installedRevision = basename(plugin.pluginDir);
  return {
    schemaVersion: 1,
    identity: installedIdentity,
    installedRevision,
    generation: JSON.stringify([installedIdentity, installedRevision, plugin.pluginDir]),
    source: { kind: 'bundle', location: plugin.pluginDir },
    requiredCapabilities: [...new Set(contributions.flatMap((item) => item.requiredCapabilities))],
    contributions,
    lifecycle: { activation: 'unadmitted', activeCalls: 'host-owned' },
    diagnostics,
  };
}
