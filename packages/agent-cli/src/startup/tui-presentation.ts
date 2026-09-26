/**
 * The presentation a terminal UI renders with, resolved the same way for every entry that renders
 * one: the TUI that builds its own session, and the TUI attached to a daemon's (`robota --attach`).
 * Only presentation lives here — nothing that shapes a session — so an attached terminal looks and
 * reads the way the plain one does without resolving a runtime it does not run.
 *
 * The TUI implementation is referenced by type only: the headless entry reaches this module and
 * must never load it. The full CLI supplies the factories.
 */
import { homedir } from 'node:os';

import { formatRobotaResumeCommand } from '../product/robota-command-vocabulary.js';
import { createRobotaKeybindingsOptions } from '../product/robota-keybindings.js';
import {
  createRobotaUserSettingsSources,
  robotaUserSettingsPath,
} from '../product/robota-user-settings.js';
import { resolveFocusReportingOverride } from './focus-reporting-enablement.js';
import { resolvePromptHistoryRenderFields } from './prompt-history-enablement.js';
import { resolveRobotaScreenReaderPacing } from './screen-reader-pacing-projection.js';
import { resolveRobotaTerminalCapabilities } from './terminal-capabilities-projection.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  CommandRegistry,
  TSettingsData,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type {
  IKeybindingsSource,
  IScreenReaderPacingOverrides,
  ITerminalCapabilityOverrides,
  ITuiCliAdapter,
} from '@robota-sdk/agent-ui-terminal';
import type { IPromptHistorySurface } from './prompt-history-enablement.js';
import type { IScreenReaderRenderFields } from './screen-reader-enablement.js';
import type { IThemeSurface } from './theme-surface.js';

type TEnv = Readonly<Record<string, string | undefined>>;

/** The presentation factories the full CLI supplies. */
export interface ITuiPresentationFactories {
  createThemeSurface: typeof import('./theme-surface.js').createThemeSurface;
  createNodeKeybindingsSource: typeof import('@robota-sdk/agent-ui-terminal').createNodeKeybindingsSource;
  createDefaultTuiCliAdapter: typeof import('@robota-sdk/agent-ui-terminal').createDefaultTuiCliAdapter;
}

export interface ITuiPresentationSources {
  /** Absent when the run renders no terminal UI. */
  readonly keybindingsSource: IKeybindingsSource | undefined;
  readonly theme: IThemeSurface;
}

/** The keybindings file and the theme catalogue a run renders from. */
export function createTuiPresentationSources(
  presentation: Pick<ITuiPresentationFactories, 'createThemeSurface' | 'createNodeKeybindingsSource'>,
  inputs: {
    /** Whether this run renders a terminal UI at all; print, goal and serve runs do not. */
    readonly enabled: boolean;
    readonly cwd: string;
    readonly projectAccess: TWorkspaceProjectAccess;
    readonly settings: TSettingsData;
    readonly reducedMotionFlag: boolean | undefined;
    readonly env: TEnv;
  },
): ITuiPresentationSources {
  const keybindingsSource = inputs.enabled
    ? presentation.createNodeKeybindingsSource({
        ...createRobotaKeybindingsOptions(homedir()),
        onDiagnostic: (diagnostic) =>
          process.stderr.write(
            `Keybindings ${diagnostic.file} ${diagnostic.path}: ${diagnostic.message}\n`,
          ),
      })
    : undefined;
  // SCREEN-2002: one registry, reaching both `/theme` (through its port) and the renderer.
  const theme = presentation.createThemeSurface({
    cwd: inputs.cwd,
    projectAccess: inputs.projectAccess,
    userHome: homedir(),
    enabled: keybindingsSource !== undefined,
    settings: inputs.settings,
    reducedMotionFlag: inputs.reducedMotionFlag,
    env: inputs.env,
  });
  return { keybindingsSource, theme };
}

export type TTuiRenderFields = IScreenReaderRenderFields &
  IPromptHistorySurface & {
    readonly screenReaderPacing: IScreenReaderPacingOverrides;
    readonly terminalCapabilities: ITerminalCapabilityOverrides;
    readonly focusReporting: boolean | undefined;
  };

/** What the renderer takes from the settings and the environment, beside the theme and keybindings. */
export function resolveTuiRenderFields(inputs: {
  readonly screenReader: IScreenReaderRenderFields;
  readonly settings: TSettingsData;
  readonly env: TEnv;
  readonly access: TWorkspaceProjectAccess;
  readonly cwd: string;
}): TTuiRenderFields {
  return {
    // CLI-2004: off ⇒ today's byte stream is unchanged.
    ...inputs.screenReader,
    screenReaderPacing: resolveRobotaScreenReaderPacing(inputs.env),
    terminalCapabilities: resolveRobotaTerminalCapabilities(inputs.env),
    // SCREEN-1992: the focus-reporting kill switch is the shell's; the TUI's TTY gate decides otherwise.
    focusReporting: resolveFocusReportingOverride(inputs.env),
    // SCREEN-1993: prompt history is a TUI-only surface (print and serve receive no writer).
    ...resolvePromptHistoryRenderFields({
      settings: inputs.settings,
      env: inputs.env,
      access: inputs.access,
      cwd: inputs.cwd,
    }),
  };
}

/** The renderer's read-only seam to Robota's settings, provider names and resume command. */
export function createRobotaTuiCliAdapter(
  createDefaultTuiCliAdapter: ITuiPresentationFactories['createDefaultTuiCliAdapter'],
  inputs: {
    readonly providerDefinitions: readonly IProviderDefinition[];
    readonly reloadPluginCommandSource: (registry: CommandRegistry) => void;
  },
): ITuiCliAdapter {
  return createDefaultTuiCliAdapter({
    providerDefinitions: inputs.providerDefinitions,
    reloadPluginCommandSource: inputs.reloadPluginCommandSource,
    userSettingsPath: robotaUserSettingsPath(),
    settingsSources: createRobotaUserSettingsSources(),
    formatResumeCommand: formatRobotaResumeCommand,
  });
}
