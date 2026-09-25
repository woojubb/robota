/**
 * The advisor as `robota` composes it: which model advises (the `--advisor` flag, else the saved
 * `advisorModel` setting), whether the organization allows it, the kill switch, and where per-destination
 * consent is kept.
 */

import { findProviderDefinition } from '@robota-sdk/agent-core';
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

/** The user-settings key holding the destinations the user agreed to send conversation history to. */
export const ADVISOR_CONSENT_SETTING_KEY = 'advisorConsentDestinations';

const ADVISOR_MODEL_SETTING_KEY = 'advisorModel';

export function isAdvisorKillSwitchOn(env: Record<string, string | undefined>): boolean {
  const value = env[ADVISOR_KILL_SWITCH_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/** Consent kept in the user settings file, so it is asked once per destination, not per session. */
export function createSettingsAdvisorConsentStore(settingsPath: string): IAdvisorConsentStore {
  const read = (): string[] => {
    const value = readSettings(settingsPath)[ADVISOR_CONSENT_SETTING_KEY];
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  };
  return {
    has: (destination) => read().includes(destination),
    grant: (destination) => {
      const destinations = read();
      if (destinations.includes(destination)) return;
      const settings = readSettings(settingsPath);
      writeSettings(settingsPath, {
        ...settings,
        [ADVISOR_CONSENT_SETTING_KEY]: [...destinations, destination],
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
  /** The main provider the session starts with: its id and the settings it was built from. */
  readonly mainProvider: {
    readonly id: string;
    readonly config: { readonly name: string; readonly baseURL?: string };
  };
}

export interface ICliAdvisor {
  readonly controller: AdvisorController;
  /** Present only when the session starts with an advisor; the tool list never changes later. */
  readonly tool?: IToolWithEventService;
  readonly notice?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    // allow-fallback: an unparsable base URL is still a distinct destination, named as written
    return url.trim().toLowerCase();
  }
}

/**
 * Where a provider configuration sends requests: its type and the host it talks to — the configured
 * base URL, else the type's default endpoint. Two profiles of one type on different hosts (a local
 * server and the vendor's cloud, say) are different destinations.
 */
export function describeProviderDestination(
  config: { readonly name: string; readonly baseURL?: string },
  providerDefinitions: readonly IProviderDefinition[],
): string {
  const definition = findProviderDefinition(providerDefinitions, config.name);
  const url = config.baseURL ?? definition?.defaults?.baseURL;
  const host =
    url !== undefined && url.length > 0
      ? hostOf(url)
      : definition?.endpoint !== undefined
        ? `${definition.endpoint.host}:${definition.endpoint.port}`.toLowerCase()
        : 'default';
  return `${definition?.type ?? config.name}@${host}`;
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
    return {
      provider,
      model,
      destination: describeProviderDestination(settings, providerDefinitions),
    };
  };
}

export function composeCliAdvisor(input: ICliAdvisorInput): ICliAdvisor {
  const spec = resolveStartupAdvisorSpec(
    input.flag,
    input.safeMode ? undefined : input.userSettings[ADVISOR_MODEL_SETTING_KEY],
  );
  const allowedProfiles = input.orgPolicy?.allowedProviders;
  const startupDestination = describeProviderDestination(
    input.mainProvider.config,
    input.providerDefinitions,
  );
  const controller = new AdvisorController({
    ...(spec !== undefined ? { spec } : {}),
    resolveTarget: targetResolver(input.settingsSources, input.providerDefinitions),
    consent: createSettingsAdvisorConsentStore(input.userSettingsPath),
    // After a `/provider` switch the id changes and the main destination is unknown, so every
    // advisor destination then needs consent unless the startup destination is the one it names —
    // this conversation was already sent there.
    mainDestination: (providerId) =>
      providerId === input.mainProvider.id ? startupDestination : undefined,
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
