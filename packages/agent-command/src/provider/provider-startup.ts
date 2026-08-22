import {
  checkSettingsDocument,
  createDefaultUserSettingsSources,
  createNodeHostSettingsStore,
  getUserSettingsPath,
  ProviderConfigError,
  readMergedProviderSettings,
  resolveEnvDefaultProvider,
  applyProviderConfiguration,
  resolveProviderSettingsWriteTarget,
  WorkspaceAuthorityRequiredError,
} from '@robota-sdk/agent-framework';

import { runOnboardingBranch } from './provider-onboarding.js';
import {
  formatProviderSetupSelectionPrompt,
  resolveProviderSetupSelection,
  runProviderSetupPromptFlow,
  type TPromptInput,
} from './provider-setup-flow.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { ITerminalOutput } from '@robota-sdk/agent-core';
import type {
  ISettingsDocumentStore,
  TSettingsScope,
  TSettingsSource,
} from '@robota-sdk/agent-framework';

export interface IProviderStartupContext {
  provider?: string;
  settingsScope?: TSettingsScope;
  settingsSources?: readonly TSettingsSource[];
  settingsStores?: readonly ISettingsDocumentStore[];
}

export interface IEnsureProviderConfigOptions {
  formatError: (defs: readonly IProviderDefinition[]) => string;
  isInteractive?: () => boolean;
  /** Environment map for env-default synthesis (test seam, default: process.env). */
  env?: Record<string, string | undefined>;
}

export async function runProviderStartupSetup(
  cwd: string,
  ctx: IProviderStartupContext,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[],
): Promise<void> {
  const onboarding = await runOnboardingBranch(promptInput, terminal);
  const access = resolveSettingsAccess(ctx);
  const existingProfileNames = Object.keys(
    readMergedProviderSettings(access.sources).providers ?? {},
  );
  const settingsStore = selectSettingsStore(access.stores, ctx.settingsScope);

  let type: string;
  if (onboarding.preselectedType !== undefined) {
    type = onboarding.preselectedType;
  } else {
    const providerChoice = await promptInput(
      formatProviderSetupSelectionPrompt(providerDefinitions),
    );
    type = resolveProviderSetupSelection(providerChoice, providerDefinitions);
  }

  const input = await runProviderSetupPromptFlow(type, promptInput, providerDefinitions, {
    existingProfileNames,
  });
  applyProviderConfiguration(settingsStore, input, { providerDefinitions });
  const language = await promptInput('  Response language (ko/en/ja/zh, default: en): ');
  if (language) {
    const settings = settingsStore.read();
    settings.language = language;
    settingsStore.write(settings);
  }
  terminal.writeLine(`\n  Config saved to ${settingsStore.displayName}\n`);
}

export async function ensureProviderConfig(
  cwd: string,
  ctx: IProviderStartupContext,
  promptInput: TPromptInput,
  terminal: ITerminalOutput,
  providerDefinitions: readonly IProviderDefinition[],
  options: IEnsureProviderConfigOptions,
): Promise<void> {
  const access = resolveSettingsAccess(ctx);
  const merged = readMergedProviderSettings(access.sources);
  const selectedSettings =
    ctx.provider !== undefined ? { ...merged, currentProvider: ctx.provider } : merged;
  if (checkSettingsDocument(selectedSettings, providerDefinitions) === 'valid') {
    return;
  }
  // Zero-config startup: a recognized provider env key with complete definition defaults
  // makes setup unnecessary — resolution will synthesize an env-default config.
  if (
    ctx.provider === undefined &&
    resolveEnvDefaultProvider(providerDefinitions, options.env) !== undefined
  ) {
    return;
  }
  const checkInteractive = options.isInteractive ?? (() => false);
  if (!checkInteractive()) {
    throw new ProviderConfigError(options.formatError(providerDefinitions));
  }
  await runProviderStartupSetup(
    cwd,
    selectStartupContext(ctx, access.stores),
    promptInput,
    terminal,
    providerDefinitions,
  );
  const updated = readMergedProviderSettings(access.sources);
  const updatedSettings =
    ctx.provider !== undefined ? { ...updated, currentProvider: ctx.provider } : updated;
  if (checkSettingsDocument(updatedSettings, providerDefinitions) !== 'valid') {
    throw new ProviderConfigError(options.formatError(providerDefinitions));
  }
}

function resolveSettingsAccess(ctx: IProviderStartupContext): {
  sources: readonly TSettingsSource[];
  stores: readonly ISettingsDocumentStore[];
} {
  const stores = ctx.settingsStores ?? [createNodeHostSettingsStore('user', getUserSettingsPath())];
  return {
    sources: ctx.settingsSources ?? createDefaultUserSettingsSources(),
    stores,
  };
}

function selectSettingsStore(
  stores: readonly ISettingsDocumentStore[],
  scope: TSettingsScope | undefined,
): ISettingsDocumentStore {
  if (scope === undefined) return resolveProviderSettingsWriteTarget(stores);
  const targetScope = scope === 'user' ? 'user' : 'project-local';
  const store = stores.findLast((candidate) => candidate.scope === targetScope);
  if (store !== undefined) return store;
  throw new WorkspaceAuthorityRequiredError(
    `No authorized ${targetScope} settings store is available.`,
  );
}

function selectStartupContext(
  ctx: IProviderStartupContext,
  stores: readonly ISettingsDocumentStore[],
): IProviderStartupContext {
  if (ctx.settingsScope !== undefined || ctx.provider !== undefined) return ctx;
  const currentProviderStore = findHighestPriorityCurrentProviderStore(stores);
  if (currentProviderStore?.kind === 'project') return { ...ctx, settingsScope: 'project-local' };
  return ctx;
}

function findHighestPriorityCurrentProviderStore(
  stores: readonly ISettingsDocumentStore[],
): ISettingsDocumentStore | undefined {
  for (let index = stores.length - 1; index >= 0; index -= 1) {
    const store = stores[index];
    if (store === undefined) continue;
    const settings = store.read();
    if (typeof settings.currentProvider === 'string') {
      return store;
    }
  }
  return undefined;
}
