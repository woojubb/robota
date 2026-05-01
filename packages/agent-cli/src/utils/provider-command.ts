import { readMergedProviderSettings } from './provider-factory.js';
import { validateProviderProfile, type IProviderProfileSettings } from './provider-settings.js';
import { DEFAULT_PROVIDER_DEFINITIONS } from './provider-default-definitions.js';
import {
  findProviderDefinition,
  formatSupportedProviderTypes,
  type IProviderDefinition,
  type IProviderProbeResult,
} from './provider-definition.js';

export interface IProviderCommandData {
  providerSwitch?: {
    profile: string;
  };
  providerSetup?: {
    type: string;
  };
  providerTest?: {
    profile: string;
  };
}

export interface IProviderCommandResult {
  message: string;
  success: boolean;
  data?: IProviderCommandData;
}

export interface IProviderCommandDeps {
  probe?: (profile: IProviderProfileSettings) => Promise<IProviderProbeResult>;
  providerDefinitions?: readonly IProviderDefinition[];
}

export async function handleProviderCommand(
  cwd: string,
  args: string,
  deps: IProviderCommandDeps = {},
): Promise<IProviderCommandResult> {
  const settings = readMergedProviderSettings(cwd);
  const providerDefinitions = deps.providerDefinitions ?? DEFAULT_PROVIDER_DEFINITIONS;
  const [subcommand = 'current', profileArg] = args.trim().split(/\s+/);

  if (subcommand === 'list') {
    return {
      message: formatProviderList(settings.currentProvider, settings.providers),
      success: true,
    };
  }
  if (subcommand === 'current' || subcommand === '') {
    return {
      message: formatCurrentProvider(settings.currentProvider, settings.providers),
      success: true,
    };
  }
  if (subcommand === 'use') {
    return buildProviderSwitch(settings.providers, profileArg);
  }
  if (subcommand === 'test') {
    return await testProvider(settings.currentProvider, settings.providers, profileArg, deps);
  }
  if (subcommand === 'add') {
    return buildProviderSetup(profileArg, providerDefinitions);
  }

  return {
    message: 'Usage: provider [current|list|use <profile>|add <type>|test [profile]]',
    success: false,
  };
}

function formatProviderList(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
): string {
  const entries = Object.entries(providers ?? {});
  if (entries.length === 0) {
    return 'No provider profiles configured.';
  }
  return entries
    .map(([name, profile]) => {
      const marker = name === currentProvider ? '*' : '-';
      return `${marker} ${name}: ${profile.type ?? 'unknown'} ${profile.model ?? '(no model)'}`;
    })
    .join('\n');
}

function formatCurrentProvider(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
): string {
  if (!currentProvider) {
    return 'No current provider configured.';
  }
  const profile = providers?.[currentProvider];
  if (!profile) {
    return `Current provider "${currentProvider}" was not found in providers.`;
  }
  return [
    `Current provider: ${currentProvider}`,
    `Type: ${profile.type ?? 'unknown'}`,
    `Model: ${profile.model ?? '(no model)'}`,
    ...(profile.baseURL ? [`Base URL: ${profile.baseURL}`] : []),
  ].join('\n');
}

function buildProviderSwitch(
  providers: Record<string, IProviderProfileSettings> | undefined,
  profileName: string | undefined,
): IProviderCommandResult {
  if (!profileName) {
    return { message: 'Usage: provider use <profile>', success: false };
  }
  if (!providers?.[profileName]) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  return {
    message: `Provider change requested: ${profileName}`,
    success: true,
    data: { providerSwitch: { profile: profileName } },
  };
}

function buildProviderSetup(
  type: string | undefined,
  providerDefinitions: readonly IProviderDefinition[],
): IProviderCommandResult {
  if (!type || findProviderDefinition(providerDefinitions, type) === undefined) {
    return {
      message: `Usage: provider add <type>. Supported: ${formatSupportedProviderTypes(providerDefinitions)}`,
      success: false,
    };
  }
  return {
    message: `Provider setup requested: ${type}`,
    success: true,
    data: { providerSetup: { type } },
  };
}

async function testProvider(
  currentProvider: string | undefined,
  providers: Record<string, IProviderProfileSettings> | undefined,
  profileArg: string | undefined,
  deps: IProviderCommandDeps,
): Promise<IProviderCommandResult> {
  const profileName = profileArg ?? currentProvider;
  if (!profileName) {
    return { message: 'No provider profile selected.', success: false };
  }
  const profile = providers?.[profileName];
  if (!profile) {
    return { message: `Provider profile "${profileName}" was not found.`, success: false };
  }
  try {
    validateProviderProfile(profileName, profile, {
      providerDefinitions: deps.providerDefinitions ?? DEFAULT_PROVIDER_DEFINITIONS,
    });
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), success: false };
  }
  const providerDefinitions = deps.providerDefinitions ?? DEFAULT_PROVIDER_DEFINITIONS;
  const definition = profile.type
    ? findProviderDefinition(providerDefinitions, profile.type)
    : undefined;
  const probe = deps.probe ?? definition?.probeProfile ?? probeProviderProfile;
  const result = await probe(profile);
  return {
    message: result.ok
      ? `Provider "${profileName}" test passed: ${result.message}`
      : `Provider "${profileName}" test failed: ${result.message}; manual configuration can continue.`,
    success: true,
    data: { providerTest: { profile: profileName } },
  };
}

export async function probeProviderProfile(
  profile: IProviderProfileSettings,
): Promise<IProviderProbeResult> {
  void profile;
  return { ok: true, message: 'Profile fields are valid; no endpoint probe configured.' };
}
