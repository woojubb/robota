/**
 * `robota --attach`'s renderer: the full TUI on the daemon's session, with the presentation the plain
 * TUI resolves — settings, screen reader, theme, keybindings, terminal, focus reporting, prompt
 * history search, the CLI adapter and the process guards. Nothing that shapes a session is resolved:
 * the daemon owns it. The terminal's own commands run here too, as the plain TUI runs them.
 */
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';
import { createTerminalClientCommands } from '@robota-sdk/agent-command';
import { applyAppearanceSettings } from '@robota-sdk/agent-framework';

import { reloadPluginCommandSource } from '../plugins/default-plugin-command-source-loader.js';
import { ROBOTA_EDITOR_TEMPORARY_DIRECTORY_PREFIX } from '../product/robota-command-vocabulary.js';
import { resolveRobotaShellExecutable } from '../product/robota-shell.js';
import { robotaUserSettingsPath } from '../product/robota-user-settings.js';
import { resolveShellPresetOrExit } from './preset-selection.js';
import { resolveScreenReaderRenderFields } from './screen-reader-enablement.js';
import {
  createRobotaTuiCliAdapter,
  createTuiPresentationSources,
  resolveTuiRenderFields,
} from './tui-presentation.js';
import { readUserSettingsOrExit } from './user-settings.js';
import { readVersion } from './version.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import type { TDaemonAttachRender } from '../session-inventory/daemon-attach-command.js';
import type { ITuiPresentationFactories } from './tui-presentation.js';

/** What the full CLI supplies to render an attached TUI. */
export interface IAttachedAppPresentation extends ITuiPresentationFactories {
  renderAttachedApp: typeof import('@robota-sdk/agent-ui-terminal').renderAttachedApp;
  installTuiProcessGuards: typeof import('../process-guards.js').installTuiProcessGuards;
}

export interface IAttachedAppContext {
  readonly cwd: string;
  readonly projectAccess: TWorkspaceProjectAccess;
  /** The caller's provider catalogue, for display names; the built-in one otherwise. */
  readonly providerDefinitions?: readonly IProviderDefinition[];
  /** `--safe-mode` loads no plugin commands. */
  readonly safeMode?: boolean;
}

export function createAttachedAppRender(
  presentation: IAttachedAppPresentation,
  context: IAttachedAppContext,
): TDaemonAttachRender {
  return async ({ connection, driverId, sessionLabel, screenReaderFlag }) => {
    const { cwd, projectAccess } = context;
    const settings = readUserSettingsOrExit();
    const env = process.env;
    const { keybindingsSource, theme } = createTuiPresentationSources(presentation, {
      enabled: true,
      cwd,
      projectAccess,
      settings,
      reducedMotionFlag: undefined,
      env,
    });
    for (const { fileName, reason } of theme.skipped) {
      process.stderr.write(`Skipped theme "${fileName}": ${reason}\n`);
    }
    // The plain TUI's preset resolution, for its command-module selection only: a module it turns
    // off is not a command this terminal offers. `--attach` takes no preset flag, so the user's
    // settings choose.
    const { enabledCommandModules, disabledCommandModules } = resolveShellPresetOrExit({
      args: {},
      settings,
      safeMode: context.safeMode === true,
      writeError: (message) => process.stderr.write(`${message}\n`),
    }).options;
    // The session-side prompt-history writer belongs to the session, and the daemon's is its own.
    const { promptHistory: _sessionWriter, ...fields } = resolveTuiRenderFields({
      screenReader: resolveScreenReaderRenderFields(settings, screenReaderFlag, env),
      settings,
      env,
      access: projectAccess,
      cwd,
    });
    // The plain TUI's survival guards (ERR-001 G1): an error it survives must not end this terminal.
    // No session runs in this process to show the error in, so it is written to the terminal.
    presentation.installTuiProcessGuards();
    return presentation.renderAttachedApp({
      cwd,
      productDisplayName: 'Robota',
      version: readVersion(),
      cliAdapter: createRobotaTuiCliAdapter(presentation.createDefaultTuiCliAdapter, {
        providerDefinitions: context.providerDefinitions ?? createDefaultProviderDefinitions(),
        reloadPluginCommandSource: (registry) =>
          reloadPluginCommandSource(registry, cwd, projectAccess, context.safeMode !== true),
      }),
      ...fields,
      keybindingsSource,
      // `/shell`, `/editor`, `/keybindings` and `/theme` belong to this terminal, not the daemon's
      // process: each gets the port and module selection the plain TUI gives it, and a theme it picks
      // is written where the plain TUI's session writes it.
      clientCommands: {
        commands: createTerminalClientCommands({
          shellExecutable: resolveRobotaShellExecutable(),
          editorTemporaryDirectoryPrefix: ROBOTA_EDITOR_TEMPORARY_DIRECTORY_PREFIX,
          keybindingsFile: keybindingsSource,
          themeCatalogue: theme.cataloguePort,
          ...(enabledCommandModules !== undefined ? { enabledCommandModules } : {}),
          ...(disabledCommandModules !== undefined ? { disabledCommandModules } : {}),
        }),
        writeAppearanceSettings: (patch) => {
          applyAppearanceSettings(robotaUserSettingsPath(), patch);
        },
      },
      themeRegistry: theme.registry,
      reducedMotion: theme.reducedMotion,
      reducedMotionOverride: theme.reducedMotionOverride,
      connection,
      sessionLabel,
      driverId,
    });
  };
}
