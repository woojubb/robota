/**
 * `robota --attach`'s renderer: the full TUI on the daemon's session, with the presentation the plain
 * TUI resolves — settings, screen reader, theme, keybindings, terminal, focus reporting, prompt
 * history search and the CLI adapter. Nothing that shapes a session is resolved: the daemon owns it.
 */
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';

import { reloadPluginCommandSource } from '../plugins/default-plugin-command-source-loader.js';
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
    // The session-side prompt-history writer belongs to the session, and the daemon's is its own.
    const { promptHistory: _sessionWriter, ...fields } = resolveTuiRenderFields({
      screenReader: resolveScreenReaderRenderFields(settings, screenReaderFlag, env),
      settings,
      env,
      access: projectAccess,
      cwd,
    });
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
      themeRegistry: theme.registry,
      reducedMotion: theme.reducedMotion,
      reducedMotionOverride: theme.reducedMotionOverride,
      connection,
      sessionLabel,
      driverId,
    });
  };
}
