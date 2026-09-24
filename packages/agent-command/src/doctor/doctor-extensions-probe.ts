/**
 * Plugin, skill, hook and MCP probes (OBSERVABILITY-1991) — each over the owner's inspection API.
 *
 * Statuses follow the spec: a plugin the user installed that cannot load is `fail`; a hooks.json the
 * schema refuses is `warn` (report-only — the loader still loads it); an MCP structural fault is
 * `warn` until the CLI has an MCP consumer; MCP connection and hook execution are the enumerated
 * `not-probed` exclusions of a read-only doctor.
 */
import {
  inspectSkillSources,
  loadHostBundlePluginInspectionFromScopes,
} from '@robota-sdk/agent-framework';

import type { IDoctorCheck, IDoctorDeps, IDoctorInputs } from './doctor-types.js';
import type {
  IBundlePluginInspection,
  IBundlePluginMcpServer,
  ISettingsInspection,
} from '@robota-sdk/agent-framework';

const SKIP_CAUSE: Record<string, string> = {
  'manifest-unreadable': 'manifest could not be parsed',
  'manifest-invalid': 'manifest is not a valid plugin.json (name, version, description required)',
  'load-failed': 'plugin assets could not be loaded',
};

function pluginChecks(inspections: readonly IBundlePluginInspection[]): IDoctorCheck[] {
  const checks: IDoctorCheck[] = [];
  const loaded = inspections.reduce((n, i) => n + i.loaded.length, 0);
  const present = inspections.filter((i) => i.cacheDirPresent);
  checks.push(
    present.length === 0
      ? {
          id: 'plugins',
          label: 'Plugins',
          status: 'not-configured',
          cause: 'no plugin cache directory',
          detail: inspections.map((i) => i.pluginsDir),
        }
      : {
          id: 'plugins',
          label: 'Plugins',
          status: 'ok',
          cause: `${loaded} plugin(s) loaded`,
          detail: present.map(
            (i) => `${i.pluginsDir}: ${i.loaded.length} loaded, ${i.skipped.length} skipped`,
          ),
        },
  );
  for (const inspection of inspections) {
    for (const skip of inspection.skipped) {
      if (skip.reason === 'disabled') continue;
      checks.push({
        id: `plugin.${skip.pluginId}`,
        label: 'Plugin',
        status: 'fail',
        path: skip.manifestPath,
        cause: SKIP_CAUSE[skip.reason] ?? skip.reason,
        ...(skip.detail === undefined ? {} : { detail: [skip.detail] }),
      });
    }
    for (const issue of inspection.hookIssues) {
      checks.push({
        id: `plugin.${issue.pluginId}.hooks`,
        label: 'Plugin hooks',
        status: 'warn',
        path: issue.hooksPath,
        cause: `hooks.json fails the hooks schema: ${issue.issues.map((i) => `${i.path} (${i.code})`).join(', ')}`,
        detail: ['Report-only: the plugin still loads; these hooks may not run.'],
      });
    }
  }
  return checks;
}

function skillChecks(inputs: IDoctorInputs): IDoctorCheck[] {
  const inspection = inspectSkillSources(inputs.contributionSources, inputs.skillRoots);
  const present = inspection.roots.filter((root) => root.present);
  const discovered = present.reduce((n, root) => n + root.discovered.length, 0);
  const checks: IDoctorCheck[] = [
    present.length === 0
      ? {
          id: 'skills',
          label: 'Skills and commands',
          status: 'not-configured',
          cause: 'no skill or command root present',
        }
      : {
          id: 'skills',
          label: 'Skills and commands',
          status: 'ok',
          cause: `${discovered} discovered`,
          detail: present.map(
            (root) => `${root.sourceDisplayName}: ${root.root} (${root.discovered.length})`,
          ),
        },
  ];
  for (const root of present) {
    for (const skip of root.skipped) {
      // A value the parser refuses ends session discovery with a throw; every other skip is tolerated.
      checks.push({
        id: `skill.${skip.path}`,
        label: 'Skill definition',
        status: skip.reason === 'frontmatter-invalid' ? 'fail' : 'warn',
        path: `${root.sourceDisplayName}: ${skip.path}`,
        cause: skip.reason,
        ...(skip.detail === undefined ? {} : { detail: [skip.detail] }),
      });
    }
  }
  return checks;
}

/** The shape of a hook group as both settings layers and plugin `hooks.json` carry it. */
interface IHookGroupLike {
  readonly hooks?: ReadonlyArray<{ readonly type?: string; readonly command?: string }>;
}

function commandHooks(
  settings: ISettingsInspection,
  plugins: readonly IBundlePluginInspection[],
): string[] {
  const commands: string[] = [];
  const collect = (hooks: object | undefined): void => {
    if (hooks === undefined) return;
    for (const groups of Object.values(
      hooks as Record<string, readonly IHookGroupLike[] | undefined>,
    )) {
      for (const group of groups ?? []) {
        for (const hook of group.hooks ?? []) {
          if (hook.type === 'command' && typeof hook.command === 'string')
            commands.push(hook.command);
        }
      }
    }
  };
  collect(settings.merged.hooks);
  for (const inspection of plugins) for (const plugin of inspection.loaded) collect(plugin.hooks);
  return commands;
}

function hookChecks(
  settings: ISettingsInspection,
  plugins: readonly IBundlePluginInspection[],
  deps: IDoctorDeps,
): IDoctorCheck[] {
  const commands = commandHooks(settings, plugins);
  const missing = commands.filter((command) => !deps.resolveCommand(command));
  return [
    commands.length === 0
      ? {
          id: 'hooks',
          label: 'Hooks',
          status: 'not-configured',
          cause: 'no command hooks configured',
        }
      : missing.length === 0
        ? {
            id: 'hooks',
            label: 'Hooks',
            status: 'ok',
            cause: `${commands.length} command hook(s); every executable resolves`,
          }
        : {
            id: 'hooks',
            label: 'Hooks',
            status: 'warn',
            cause: `${missing.length} command hook executable(s) not found on PATH`,
            detail: missing.map((command) => command.split(/\s+/)[0] ?? command),
          },
    {
      id: 'hooks.execution',
      label: 'Hook execution',
      status: 'not-probed',
      cause: 'the doctor does not run hooks',
    },
  ];
}

function mcpServerCheck(server: IBundlePluginMcpServer, deps: IDoctorDeps): IDoctorCheck {
  const id = `mcp.plugin.${server.pluginId}.${server.name}`;
  if (server.transport === 'stdio' && server.command !== undefined) {
    return deps.resolveCommand(server.command)
      ? {
          id,
          label: 'MCP server (plugin)',
          status: 'ok',
          path: server.mcpPath,
          cause: `stdio command ${server.command} resolves`,
        }
      : {
          id,
          label: 'MCP server (plugin)',
          status: 'warn',
          path: server.mcpPath,
          cause: `stdio command ${server.command} not found on PATH`,
          detail: server.envKeys.length === 0 ? [] : [`env keys: ${server.envKeys.join(', ')}`],
        };
  }
  if (server.transport === 'http' && server.url !== undefined) {
    try {
      new URL(server.url);
      return {
        id,
        label: 'MCP server (plugin)',
        status: 'ok',
        path: server.mcpPath,
        cause: `url ${server.url}`,
      };
    } catch {
      // allow-fallback: an unparseable url is the finding
      return {
        id,
        label: 'MCP server (plugin)',
        status: 'warn',
        path: server.mcpPath,
        cause: 'url is not parseable',
      };
    }
  }
  return {
    id,
    label: 'MCP server (plugin)',
    status: 'warn',
    path: server.mcpPath,
    cause: 'neither command nor url declared',
  };
}

function mcpChecks(
  inputs: IDoctorInputs,
  plugins: readonly IBundlePluginInspection[],
  deps: IDoctorDeps,
): IDoctorCheck[] {
  const checks: IDoctorCheck[] = [];
  if (inputs.mcpActivation === undefined) {
    checks.push({
      id: 'mcp.activation',
      label: 'MCP activation',
      status: 'not-configured',
      cause: 'this CLI composes no MCP activation adapter',
    });
  } else {
    const summaries = inputs.mcpActivation.list();
    checks.push({
      id: 'mcp.activation',
      label: 'MCP activation',
      status: 'ok',
      cause: `${summaries.length} server(s) known`,
    });
    for (const summary of summaries) {
      checks.push({
        id: `mcp.${summary.serverId}`,
        label: 'MCP server',
        status: summary.allowed ? 'ok' : 'warn',
        cause: `${summary.status} (${summary.source}): ${summary.reason}`,
      });
    }
  }
  for (const inspection of plugins) {
    for (const server of inspection.mcpServers) checks.push(mcpServerCheck(server, deps));
    for (const fault of inspection.mcpFaults) {
      checks.push({
        id: `mcp.plugin.${fault.pluginId}`,
        label: 'MCP declaration (plugin)',
        status: 'warn',
        path: fault.mcpPath,
        cause: `.mcp.json ${fault.reason}`,
      });
    }
  }
  checks.push({
    id: 'mcp.connection',
    label: 'MCP connection',
    status: 'not-probed',
    cause: 'the doctor does not connect to MCP servers',
  });
  return checks;
}

/** Plugins, skills, hooks and MCP — in that order. */
export function probeExtensions(
  inputs: IDoctorInputs,
  deps: IDoctorDeps,
  settings: ISettingsInspection,
): IDoctorCheck[] {
  // Enablement is read the way the session loader reads it — from the user settings file through the
  // plugin settings store — so the doctor and the session agree even where that store's own policy is
  // a separate open item (recorded on #2670).
  const plugins = loadHostBundlePluginInspectionFromScopes(inputs.pluginsDirs, {
    settingsPath: inputs.userSettingsPath,
  });
  return [
    ...pluginChecks(plugins),
    ...skillChecks(inputs),
    ...hookChecks(settings, plugins, deps),
    ...mcpChecks(inputs, plugins, deps),
  ];
}
