import { join } from 'node:path';

import {
  checkSettingsDocument,
  readMergedProviderSettings,
  readSettings,
  writeSettings,
  resolveSettingsPathForScope,
  getProviderSettingsPaths,
  applyProviderConfiguration,
} from '@robota-sdk/agent-framework';

import {
  formatProviderSetupSelectionPrompt,
  resolveProviderSetupSelection,
  runProviderSetupPromptFlow,
  type TPromptInput,
} from './provider-setup-flow.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { ITerminalOutput } from '@robota-sdk/agent-core';
import type { TSettingsScope } from '@robota-sdk/agent-framework';

export interface IProviderStartupContext {
  provider?: string;
  settingsScope?: TSettingsScope;
}

export interface IEnsureProviderConfigOptions {
  formatError: (defs: readonly IProviderDefinition[]) => string;
  isInteractive?: () => boolean;
}

export async function runProviderStartupSetup(
  cwd: string,
  ctx: IProviderStartupContext,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[],
): Promise<void> {
  const providerChoice = await promptInput(formatProviderSetupSelectionPrompt(providerDefinitions));
  const type = resolveProviderSetupSelection(providerChoice, providerDefinitions);
  const settingsPath = resolveSettingsPathForScope(cwd, ctx.settingsScope);
  const input = await runProviderSetupPromptFlow(type, promptInput, providerDefinitions, {
    existingProfileNames: Object.keys(readMergedProviderSettings(cwd).providers ?? {}),
  });
  applyProviderConfiguration(settingsPath, input, { providerDefinitions });
  const language = await promptInput('  Response language (ko/en/ja/zh, default: en): ');
  if (language) {
    const settings = readSettings(settingsPath);
    settings.language = language;
    writeSettings(settingsPath, settings);
  }
  terminal.writeLine(`\n  Config saved to ${settingsPath}\n`);
}

export async function ensureProviderConfig(
  cwd: string,
  ctx: IProviderStartupContext,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[],
  options: IEnsureProviderConfigOptions,
): Promise<void> {
  const merged = readMergedProviderSettings(cwd);
  const selectedSettings =
    ctx.provider !== undefined ? { ...merged, currentProvider: ctx.provider } : merged;
  if (checkSettingsDocument(selectedSettings, providerDefinitions) === 'valid') {
    return;
  }
  const checkInteractive = options.isInteractive ?? (() => false);
  if (!checkInteractive()) {
    throw new Error(options.formatError(providerDefinitions));
  }
  await runProviderStartupSetup(
    cwd,
    selectStartupContext(cwd, ctx),
    promptInput,
    terminal,
    providerDefinitions,
  );
  const updated = readMergedProviderSettings(cwd);
  const updatedSettings =
    ctx.provider !== undefined ? { ...updated, currentProvider: ctx.provider } : updated;
  if (checkSettingsDocument(updatedSettings, providerDefinitions) !== 'valid') {
    throw new Error(options.formatError(providerDefinitions));
  }
}

function selectStartupContext(cwd: string, ctx: IProviderStartupContext): IProviderStartupContext {
  if (ctx.settingsScope !== undefined || ctx.provider !== undefined) return ctx;
  const currentProviderPath = findHighestPriorityCurrentProviderPath(getProviderSettingsPaths(cwd));
  if (currentProviderPath === undefined) return ctx;
  const projectSettingsPath = join(cwd, '.robota', 'settings.json');
  const projectLocalSettingsPath = join(cwd, '.robota', 'settings.local.json');
  if (
    currentProviderPath === projectSettingsPath ||
    currentProviderPath === projectLocalSettingsPath
  ) {
    return { ...ctx, settingsScope: 'project-local' };
  }
  return ctx;
}

function findHighestPriorityCurrentProviderPath(
  settingsPaths: readonly string[],
): string | undefined {
  for (let index = settingsPaths.length - 1; index >= 0; index -= 1) {
    const settingsPath = settingsPaths[index];
    if (settingsPath === undefined) continue;
    const settings = readSettings(settingsPath);
    if (typeof settings.currentProvider === 'string') {
      return settingsPath;
    }
  }
  return undefined;
}
