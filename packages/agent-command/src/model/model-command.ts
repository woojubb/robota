import { selectAction } from '@robota-sdk/agent-core';
import {
  buildModelListSnapshot,
  formatOrgPolicyViolationMessage,
  resolveModelListSelection,
  setCurrentProvider,
  upsertProviderProfile,
} from '@robota-sdk/agent-framework';
import { validateProviderConnection } from '../provider/provider-connection-validation.js';

import type { IUserInteraction } from '@robota-sdk/agent-core';
import type {
  ICommandHostSessionAccess,
  ICommandHostUserInteraction,
  IModelListSelection,
  IProviderCommandModuleOptions,
  IProviderProfileSettings,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { IModelListSnapshot } from '@robota-sdk/agent-interface-session';

type TModelCommandContext = ICommandHostSessionAccess & ICommandHostUserInteraction;

/** The current model, read from the live session; falls back to the profile's configured one. */
function readCurrentModel(
  context: ICommandHostSessionAccess,
  currentProfile: IProviderProfileSettings | undefined,
): string {
  return context.getSession().getModelId() ?? currentProfile?.model ?? '';
}

/**
 * `allowFiltered` controls whether a profile org policy disallows is left out of the snapshot.
 * The PICKER (no id typed) always filters: a disallowed profile must never be offered as a choice.
 * RESOLVING a typed/clicked id never filters: `switchModelAcrossProfiles` is the one place that
 * decides a disallowed target, exactly as `buildProviderSwitch` decides it for `/provider switch` —
 * a filtered resolution snapshot would turn that decision into an unreachable "Unknown model"
 * instead of the specific, actionable organization-policy refusal.
 */
function buildSnapshot(
  context: ICommandHostSessionAccess,
  settings: TProviderSettingsDocument,
  options: IProviderCommandModuleOptions,
  allowFiltered: boolean,
): IModelListSnapshot {
  const currentProfile =
    settings.currentProvider !== undefined
      ? settings.providers?.[settings.currentProvider]
      : undefined;
  return buildModelListSnapshot(
    settings.providers,
    settings.currentProvider,
    readCurrentModel(context, currentProfile),
    options.providerDefinitions,
    allowFiltered ? options.orgPolicy?.allowedProviders : undefined,
  );
}

export async function executeModelCommand(
  context: TModelCommandContext,
  args: string,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const settings = options.settings.readMergedSettings();
  const id = args.trim();

  if (id.length === 0) {
    const visible = buildSnapshot(context, settings, options, true);
    return pickModel(context.getUserInteraction(), visible, context, options);
  }

  const full = buildSnapshot(context, settings, options, false);
  const selection = resolveModelListSelection(full, id);
  if (selection === undefined) {
    return {
      message: `Unknown model "${id}". Run /model to see the choices.`,
      success: false,
    };
  }

  if (selection.profileName === settings.currentProvider) {
    return switchModelWithinCurrentProfile(context, selection, settings, options);
  }
  return switchModelAcrossProfiles(selection, settings, options);
}

/**
 * With an interactive renderer attached, drive the inline picker (CMD-004); without one — headless,
 * automation, or a model-invoked caller, though this command is never offered to a model — return the
 * list as plain text instead of guessing a choice.
 */
async function pickModel(
  ui: IUserInteraction | undefined,
  snapshot: IModelListSnapshot,
  context: TModelCommandContext,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  if (snapshot.groups.length === 0) {
    return {
      message: 'No provider profiles configured. Run /provider add to add one.',
      success: true,
    };
  }
  if (!ui) {
    return { message: formatModelListText(snapshot), success: true };
  }
  const modelOptions = snapshot.groups.flatMap((group) =>
    group.models.map((model) => ({
      value: model.id,
      label: formatModelOptionLabel(snapshot, group.profileName, group.providerLabel, model),
    })),
  );
  const response = await ui.ask(
    selectAction('model', 'Select model', modelOptions, { maxVisible: 8 }),
  );
  if (response.type !== 'answer' || response.values[0] === undefined) {
    return { message: 'Model selection cancelled.', success: true };
  }
  return executeModelCommand(context, response.values[0], options);
}

function formatModelListText(snapshot: IModelListSnapshot): string {
  const lines: string[] = [];
  for (const group of snapshot.groups) {
    lines.push(`${group.providerLabel} (${group.profileName})`);
    for (const model of group.models) {
      const marker =
        model.id === snapshot.currentModel && group.profileName === snapshot.currentProfile
          ? '*'
          : '-';
      lines.push(`  ${marker} ${model.label}`);
    }
  }
  return lines.join('\n');
}

function formatModelOptionLabel(
  snapshot: IModelListSnapshot,
  profileName: string,
  providerLabel: string,
  model: { id: string; label: string },
): string {
  const marker =
    model.id === snapshot.currentModel && profileName === snapshot.currentProfile ? '* ' : '';
  const sharedLabelCount = snapshot.groups.filter(
    (group) => group.providerLabel === providerLabel,
  ).length;
  const disambiguator = sharedLabelCount > 1 ? ` (${profileName})` : '';
  return `${marker}${providerLabel}: ${model.label}${disambiguator}`;
}

/**
 * The id belongs to the CURRENT profile's provider (#3282 §2): hot-swap the live model first, and
 * persist it to the current profile only once that succeeds — a failed swap must leave settings
 * exactly as they were.
 */
async function switchModelWithinCurrentProfile(
  context: ICommandHostSessionAccess,
  selection: IModelListSelection,
  settings: TProviderSettingsDocument,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const currentProfileName = selection.profileName;
  try {
    await context.getSession().applyModelOptions({ model: selection.model.id });
  } catch (error) {
    return {
      message: `Could not switch to "${selection.model.label}": ${error instanceof Error ? error.message : String(error)}`,
      success: false,
    };
  }
  const target = options.settings.readTargetSettings();
  // Based on MERGED (not target-only) so a profile that lives in a lower-priority settings layer
  // keeps its other fields (type, apiKey, baseURL) — only `model` changes at the target layer.
  const currentProfile =
    settings.providers?.[currentProfileName] ?? target.providers?.[currentProfileName] ?? {};
  options.settings.writeTargetSettings(
    upsertProviderProfile(target, currentProfileName, {
      ...currentProfile,
      model: selection.model.id,
    }),
  );
  return { message: `Model: ${selection.model.label}`, success: true };
}

/**
 * The id belongs to ANOTHER profile's provider (#3282 §2): switch to that profile through the same
 * validate-before-write path `/provider switch` uses, with the requested model folded into the same
 * settings write, then hot-swap through the existing `provider-hot-swap` host action — which re-reads
 * settings at execution time, so it picks up the model this write just persisted.
 */
async function switchModelAcrossProfiles(
  selection: IModelListSelection,
  settings: TProviderSettingsDocument,
  options: IProviderCommandModuleOptions,
): Promise<ICommandResult> {
  const { orgPolicy } = options;
  // Checked BEFORE anything is read or written — exactly buildProviderSwitch's order — so a switch
  // org policy refuses changes nothing on disk, the same guarantee /provider switch already gives.
  if (orgPolicy?.allowedProviders && !orgPolicy.allowedProviders.includes(selection.profileName)) {
    return {
      message: formatOrgPolicyViolationMessage(
        `Provider "${selection.profileName}" is not allowed by your organization policy. Allowed: ${orgPolicy.allowedProviders.join(', ')}.`,
        orgPolicy.adminContact,
      ),
      success: false,
    };
  }
  const profile = settings.providers?.[selection.profileName];
  if (profile === undefined) {
    return {
      message: `Provider profile "${selection.profileName}" was not found.`,
      success: false,
    };
  }
  const updatedProfile: IProviderProfileSettings = { ...profile, model: selection.model.id };
  try {
    await validateProviderConnection(selection.profileName, updatedProfile, options);
  } catch (error) {
    return {
      message: `Could not switch to "${selection.model.label}": ${error instanceof Error ? error.message : String(error)}`,
      success: false,
    };
  }
  const target = options.settings.readTargetSettings();
  const merged = options.settings.readMergedSettings();
  if (
    merged.currentProvider !== settings.currentProvider ||
    JSON.stringify(merged.providers?.[selection.profileName]) !== JSON.stringify(profile)
  ) {
    return {
      success: false,
      message: 'Provider settings changed while switching. Run /model again.',
    };
  }
  const withModel = upsertProviderProfile(target, selection.profileName, updatedProfile);
  const next =
    target.providers?.[selection.profileName] !== undefined ||
    merged.providers?.[selection.profileName] !== undefined
      ? { ...withModel, currentProvider: selection.profileName }
      : setCurrentProvider(withModel, selection.profileName);
  options.settings.writeTargetSettings(next);
  return {
    message: `Model: ${selection.model.label}`,
    success: true,
    hostActions: [{ type: 'provider-hot-swap', profileName: selection.profileName }],
  };
}
