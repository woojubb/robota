import type { ICliRuntimeContext } from '../product/runtime-context.js';
/**
 * The attached terminal's renderer, for `the product --attach`, `the product session attach` and an attach
 * from `the product session view`: the full TUI on a session another process runs, in drive or observe
 * mode, with the presentation the plain TUI resolves — settings, screen reader, theme, keybindings,
 * terminal, focus reporting, prompt history search, the CLI adapter and the process guards. Nothing
 * that shapes a session is resolved: the process running it owns it. The terminal's own commands
 * run here too, as the plain TUI runs them.
 */
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';
import { createTerminalClientCommands } from '@robota-sdk/agent-command';
import { applyAppearanceSettings } from '@robota-sdk/agent-framework';

import { reloadPluginCommandSource } from '../plugins/default-plugin-command-source-loader.js';
import { resolveProductShellExecutable } from '../product/shell.js';
import { productUserSettingsPath } from '../product/user-settings.js';
import { resolveShellPresetOrExit } from './preset-selection.js';
import { resolveScreenReaderRenderFields } from './screen-reader-enablement.js';
import {
  createProductTuiCliAdapter,
  createTuiPresentationSources,
  resolveTuiRenderFields,
} from './tui-presentation.js';
import { readUserSettingsOrExit } from './user-settings.js';
import { readVersion } from './version.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import type { TAttachedAppRender } from '../session-inventory/session-attach-command.js';
import type { ITuiPresentationFactories } from './tui-presentation.js';

/** What the full CLI supplies to render an attached TUI. */
export interface IAttachedAppPresentation extends ITuiPresentationFactories {
  renderAttachedApp: typeof import('@robota-sdk/agent-ui-terminal').renderAttachedApp;
  installTuiProcessGuards: typeof import('../process-guards.js').installTuiProcessGuards;
}

export interface IAttachedAppContext {
  readonly productRuntime: ICliRuntimeContext;
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
): TAttachedAppRender {
  return async ({ connection, driverId, sessionLabel, screenReaderFlag, mode, announce }) => {
    const { cwd, projectAccess } = context;
    const settings = readUserSettingsOrExit(context.productRuntime);
    const env = context.productRuntime.environment;
    const { keybindingsSource, theme } = createTuiPresentationSources(presentation, {
      productRuntime: context.productRuntime,
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
    // off is not a command this terminal offers. An attach takes no preset flag, so the user's
    // settings choose.
    const { enabledCommandModules, disabledCommandModules } = resolveShellPresetOrExit({
      productRuntime: context.productRuntime,
      args: {},
      settings,
      safeMode: context.safeMode === true,
      writeError: (message) => process.stderr.write(`${message}\n`),
    }).options;
    // The session-side prompt-history writer belongs to the session, which has its own.
    const { promptHistory: _sessionWriter, ...fields } = resolveTuiRenderFields({
      productRuntime: context.productRuntime,
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
      productDisplayName: context.productRuntime.vocabulary.displayName,
      version: readVersion(),
      cliAdapter: createProductTuiCliAdapter(presentation.createDefaultTuiCliAdapter, {
        productRuntime: context.productRuntime,
        providerDefinitions: context.providerDefinitions ?? createDefaultProviderDefinitions(),
        reloadPluginCommandSource: (registry) =>
          reloadPluginCommandSource(registry, context.productRuntime, cwd, projectAccess, context.safeMode !== true),
      }),
      ...fields,
      keybindingsSource,
      // `/shell`, `/editor`, `/keybindings` and `/theme` belong to this terminal, not the session's
      // process: each gets the port and module selection the plain TUI gives it, and a theme it picks
      // is written where the plain TUI's session writes it.
      clientCommands: {
        commands: createTerminalClientCommands({
          shellExecutable: resolveProductShellExecutable(context.productRuntime.environment),
          editorTemporaryDirectoryPrefix: context.productRuntime.vocabulary.editorTemporaryDirectoryPrefix,
          keybindingsFile: keybindingsSource,
          themeCatalogue: theme.cataloguePort,
          ...(enabledCommandModules !== undefined ? { enabledCommandModules } : {}),
          ...(disabledCommandModules !== undefined ? { disabledCommandModules } : {}),
        }),
        writeAppearanceSettings: (patch) => {
          applyAppearanceSettings(productUserSettingsPath(context.productRuntime), patch);
        },
      },
      themeRegistry: theme.registry,
      reducedMotion: theme.reducedMotion,
      reducedMotionOverride: theme.reducedMotionOverride,
      connection,
      sessionLabel,
      driverId,
      mode,
      ...(announce !== undefined ? { announce } : {}),
    });
  };
}
