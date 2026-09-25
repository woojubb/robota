/**
 * The advisor as `robota` composes it: which model advises (the `--advisor` flag, else the saved
 * `advisorModel` setting), whether the organization allows it, the kill switch, and where per-vendor
 * consent is kept.
 */

import {
  AdvisorController,
  createAdvisorTool,
  createProviderFromSettings,
  formatAdvisorSpec,
  readProviderSettings,
  readSettings,
  resolveStartupAdvisorSpec,
  writeSettings,
} from '@robota-sdk/agent-framework';

import type { IToolWithEventService, IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  IAdvisorConsentStore,
  IAdvisorSpec,
  IAdvisorTarget,
  IOrgPolicy,
  TSettingsSource,
} from '@robota-sdk/agent-framework';

/** Set to `1` (or `true`) to turn the advisor off everywhere, whatever is configured. */
export const ADVISOR_KILL_SWITCH_ENV = 'ROBOTA_DISABLE_ADVISOR';

/** The user-settings key holding the vendors the user agreed to send conversation history to. */
export const ADVISOR_CONSENT_SETTING_KEY = 'advisorConsentVendors';

const ADVISOR_MODEL_SETTING_KEY = 'advisorModel';

export function isAdvisorKillSwitchOn(env: Record<string, string | undefined>): boolean {
  const value = env[ADVISOR_KILL_SWITCH_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/** Consent kept in the user settings file, so it is asked once per vendor, not once per session. */
export function createSettingsAdvisorConsentStore(settingsPath: string): IAdvisorConsentStore {
  const read = (): string[] => {
    const value = readSettings(settingsPath)[ADVISOR_CONSENT_SETTING_KEY];
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  };
  return {
    has: (vendor) => read().includes(vendor),
    grant: (vendor) => {
      const vendors = read();
      if (vendors.includes(vendor)) return;
      const settings = readSettings(settingsPath);
      writeSettings(settingsPath, {
        ...settings,
        [ADVISOR_CONSENT_SETTING_KEY]: [...vendors, vendor],
      });
    },
  };
}

export interface ICliAdvisorInput {
  readonly flag: string | undefined;
  readonly userSettings: Record<string, unknown>;
  /** Safe mode starts without saved customizations, so the saved advisor is not applied. */
  readonly safeMode: boolean;
  readonly env: Record<string, string | undefined>;
  readonly orgPolicy: IOrgPolicy | null | undefined;
  readonly settingsSources: readonly TSettingsSource[];
  readonly providerDefinitions: readonly IProviderDefinition[];
  readonly userSettingsPath: string;
}

export interface ICliAdvisor {
  readonly controller: AdvisorController;
  /** Present only when the session starts with an advisor; the tool list never changes later. */
  readonly tool?: IToolWithEventService;
  readonly notice?: string;
}

function targetResolver(
  sources: readonly TSettingsSource[],
  providerDefinitions: readonly IProviderDefinition[],
): (spec: IAdvisorSpec) => IAdvisorTarget {
  return (spec) => {
    const options = { providerOverride: spec.profile, providerDefinitions };
    const settings = readProviderSettings(sources, options);
    const model = spec.model ?? settings.model;
    const provider = createProviderFromSettings(sources, model, options);
    return { provider, model, vendor: provider.name };
  };
}

export function composeCliAdvisor(input: ICliAdvisorInput): ICliAdvisor {
  const spec = resolveStartupAdvisorSpec(
    input.flag,
    input.safeMode ? undefined : input.userSettings[ADVISOR_MODEL_SETTING_KEY],
  );
  const allowedProfiles = input.orgPolicy?.allowedProviders;
  const controller = new AdvisorController({
    ...(spec !== undefined ? { spec } : {}),
    resolveTarget: targetResolver(input.settingsSources, input.providerDefinitions),
    consent: createSettingsAdvisorConsentStore(input.userSettingsPath),
    ...(allowedProfiles !== undefined ? { allowedProfiles } : {}),
    killSwitch: isAdvisorKillSwitchOn(input.env),
  });
  if (controller.isRegistered()) return { controller, tool: createAdvisorTool(controller) };
  if (spec === undefined || isAdvisorKillSwitchOn(input.env)) return { controller };
  return {
    controller,
    notice: `Advisor "${formatAdvisorSpec(spec)}" is not allowed by your organization policy; starting without it.`,
  };
}
