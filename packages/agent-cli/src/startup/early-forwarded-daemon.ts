import { createWorkspaceProjectSettingsSources, getWorkspaceProjectReader, ProviderConfigError, readMergedProviderSettings, readProviderSettings, resolveModelFallbackChain, selectFallbackModelEntries, type TSettingsSource } from '@robota-sdk/agent-framework';
import { TRANSPORT_ENVIRONMENT } from '@robota-sdk/agent-executor';
import { ENV_REFERENCE_PREFIX } from '@robota-sdk/agent-core';
import { productConfigEntries } from '@robota-sdk/product-config';

import { childProductEnvironment } from '../product/child-environment.js';
import { productProviderDefinitions } from '../product/provider-definitions.js';
import { createProductUserSettingsSources } from '../product/user-settings.js';
import { productSecureMode } from '../product/session-sealing.js';
import { launchForwardedRuntime } from '../session-inventory/supervised-session-launch.js';
import { optionArgv } from '../utils/option-argv.js';
import { canAskToTrust } from './interactive-trust-prompt.js';
import { resolveInitialCliWorkspaceProjectAccess } from './workspace-project-composition.js';
import { formatHeadlessWorkspaceTrustError, requiresHeadlessWorkspaceTrust } from './workspace-trust-admission.js';
import { MAX_REPORTED_CREDENTIAL_NAMES } from './forwarded-environment.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

type TForwardedStart =
  | { readonly kind: 'other' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'start'; readonly fd: number; readonly json: boolean; readonly restricted: boolean };

/** Only this exact daemon start is handled before workspace admission. */
function parseForwardedStart(argv: readonly string[]): TForwardedStart {
  const args = optionArgv(argv).slice(2);
  if (args[0] !== 'daemon' || args[1] !== 'start') return { kind: 'other' };
  if (!args.slice(2).some((arg) => arg === '--spawner-fd' || arg.startsWith('--spawner-fd='))) return { kind: 'other' };
  if (argv.includes('--')) return { kind: 'invalid' };
  let value: string | undefined;
  let json = false;
  let restricted = false;
  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json' && !json) json = true;
    else if (arg === '--restricted-workspace' && !restricted) restricted = true;
    else if (arg === '--spawner-fd' && value === undefined) value = args[++index];
    else if (arg?.startsWith('--spawner-fd=') && value === undefined) value = arg.slice('--spawner-fd='.length);
    else return { kind: 'invalid' };
  }
  if (value === undefined || !/^[0-9]+$/u.test(value)) return { kind: 'invalid' };
  const fd = Number(value);
  if (!Number.isSafeInteger(fd) || fd < 3) return { kind: 'invalid' };
  return { kind: 'start', fd, json, restricted };
}

/** Test synchronously so unrelated starts retain their original startup ordering. */
export function isEarlyForwardedDaemon(argv: readonly string[]): boolean {
  return parseForwardedStart(argv).kind !== 'other';
}

async function admittedSources(runtime: ICliRuntimeContext, cwd: string, restricted: boolean) {
  const access = await resolveInitialCliWorkspaceProjectAccess(cwd, { productRuntime: runtime });
  if (requiresHeadlessWorkspaceTrust(access) && !(restricted && canAskToTrust(access))) {
    throw new Error(formatHeadlessWorkspaceTrustError(access, cwd, runtime.config.identity.cliName));
  }
  return [
    ...createProductUserSettingsSources(runtime),
    ...(access.status === 'trusted' && !restricted
      ? createWorkspaceProjectSettingsSources(getWorkspaceProjectReader(access.authority), runtime.layout.projectSettingsPaths)
      : []),
  ];
}

/** Match the startup provider; other saved profiles are not granted to this runtime. */
function selectedProviderReferences(sources: readonly TSettingsSource[], environment: NodeJS.ProcessEnv): readonly string[] {
  const settings = readMergedProviderSettings(sources);
  const definitions = productProviderDefinitions();
  let primary;
  try {
    primary = readProviderSettings(sources, { providerDefinitions: definitions, env: environment });
  } catch (error) {
    if (error instanceof ProviderConfigError) return [];
    throw error;
  }
  const names = new Set<string>();
  const reference = (value: string | undefined): void => {
    if (value?.startsWith(ENV_REFERENCE_PREFIX) !== true) return;
    const name = value.slice(ENV_REFERENCE_PREFIX.length).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) names.add(name);
  };
  const includeProvider = (type: string, apiKey: string | undefined, hasHostKey: boolean): void => {
    const definition = definitions.find((candidate) => candidate.type === type || candidate.aliases?.includes(type));
    if (definition === undefined) throw new Error('The selected provider is unavailable.');
    if (!hasHostKey) reference(apiKey ?? definition.defaults?.apiKey);
    for (const name of definition.destinationEnvironment ?? []) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) names.add(name);
    }
  };
  const primaryProfile = primary.source === 'env-default' ? undefined : settings.currentProvider;
  const primarySetting = primaryProfile === undefined ? settings.provider : settings.providers?.[primaryProfile];
  includeProvider(primary.name, primarySetting?.apiKey ?? (primary.apiKeyEnv === undefined ? undefined : `${ENV_REFERENCE_PREFIX}${primary.apiKeyEnv}`), primarySetting?.apiKeyRef !== undefined);
  const chain = resolveModelFallbackChain({ entries: selectFallbackModelEntries(undefined, settings), settings,
    primary: { ...(primaryProfile !== undefined ? { profile: primaryProfile } : {}), config: primary },
    providerDefinitions: definitions, environment });
  for (const target of chain.targets) {
    if (target.profile === undefined || target.profile === primaryProfile) continue;
    const profile = settings.providers?.[target.profile];
    if (profile?.type !== undefined) includeProvider(profile.type, profile.apiKey, profile.apiKeyRef !== undefined);
  }
  for (const name of TRANSPORT_ENVIRONMENT) names.delete(name);
  return [...names];
}

/** References in admitted provider profiles; this reports names, never credentials. */
function configuredCredentialReferences(sources: readonly TSettingsSource[]): readonly string[] {
  const settings = readMergedProviderSettings(sources);
  const definitions = productProviderDefinitions();
  const excluded = new Set([...TRANSPORT_ENVIRONMENT, ...definitions.flatMap((definition) => definition.destinationEnvironment ?? [])].map((name) => name.toUpperCase()));
  const names = new Set<string>();
  const collect = (type: string | undefined, key: string | undefined, hostKey: unknown): void => {
    if (type === undefined || hostKey !== undefined) return;
    const definition = definitions.find((entry) => entry.type === type || entry.aliases?.includes(type));
    const reference = key ?? definition?.defaults?.apiKey;
    if (reference?.startsWith(ENV_REFERENCE_PREFIX) !== true) return;
    const name = reference.slice(ENV_REFERENCE_PREFIX.length).trim();
    if (!excluded.has(name.toUpperCase()) && !name.toUpperCase().startsWith('PRODUCT_TELEMETRY_') && name.length <= 256 && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) names.add(name);
  };
  for (const profile of Object.values(settings.providers ?? {})) collect(profile.type, profile.apiKey, profile.apiKeyRef);
  if (settings.provider !== undefined) collect(settings.provider.name, settings.provider.apiKey, settings.provider.apiKeyRef);
  return [...names].sort();
}

function environmentFromSources(runtime: ICliRuntimeContext, sources: readonly TSettingsSource[]): NodeJS.ProcessEnv {
  const environment = childProductEnvironment(runtime);
  if (runtime.environment.PRODUCT_CONFIG_FILE !== undefined) environment.PRODUCT_CONFIG_FILE = runtime.environment.PRODUCT_CONFIG_FILE;
  for (const name of selectedProviderReferences(sources, runtime.environment)) {
    const value = runtime.environment[name];
    if (value !== undefined) environment[name] = value;
  }
  for (const name of Object.keys(environment)) if (name.startsWith('PRODUCT_TELEMETRY_')) delete environment[name];
  return environment;
}

/** After forwarding, admit project settings and retain only their declared provider references. */
export async function prepareForwardedEnvironment(runtime: ICliRuntimeContext, cwd: string, restricted: boolean): Promise<NodeJS.ProcessEnv> {
  return environmentFromSources(runtime, await admittedSources(runtime, cwd, restricted));
}

async function prepareForwardedAdmission(runtime: ICliRuntimeContext, cwd: string, restricted: boolean) {
  const sources = await admittedSources(runtime, cwd, restricted);
  const environment = environmentFromSources(runtime, sources);
  const availableCredentialNames = configuredCredentialReferences(sources)
    .filter((name) => environment[name] === undefined && Boolean(runtime.environment[name]?.trim()))
    .slice(0, MAX_REPORTED_CREDENTIAL_NAMES);
  return { environment, availableCredentialNames };
}

/** Recheck workspace authority and the allowed names before installing an IPC environment. */
export async function validateForwardedEnvironment(runtime: ICliRuntimeContext, cwd: string, restricted: boolean, forwarded: Readonly<Record<string, string>>, availableCredentialNames: readonly string[] = []): Promise<void> {
  const sources = await admittedSources(runtime, cwd, restricted);
  const configured = new Set(configuredCredentialReferences(sources));
  if (availableCredentialNames.some((name) => !configured.has(name) || Object.hasOwn(forwarded, name))) {
    throw new Error('The forwarded credential availability report was not admitted.');
  }
  const names = new Set(selectedProviderReferences(sources, { ...runtime.environment, ...forwarded }));
  const baseline: NodeJS.ProcessEnv = { ...childProductEnvironment(runtime), ...(runtime.environment.PRODUCT_CONFIG_FILE === undefined ? {} : { PRODUCT_CONFIG_FILE: runtime.environment.PRODUCT_CONFIG_FILE }) };
  const protectedNames = new Set([
    'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP', 'SHELL', 'XDG_RUNTIME_DIR',
    'PRODUCT_CONFIG_FILE', 'PRODUCT_WS_TOKEN', `${runtime.config.identity.envPrefix}WS_TOKEN`.toUpperCase(),
    ...productConfigEntries().map(({ descriptor }) => descriptor.variable.toUpperCase()),
  ]);
  for (const [name, value] of Object.entries(forwarded)) {
    if (name.toUpperCase().startsWith('PRODUCT_TELEMETRY_')) throw new Error('The forwarded environment was not admitted.');
    const baselineName = Object.keys(baseline).find((key) => key.toUpperCase() === name.toUpperCase());
    if (protectedNames.has(name.toUpperCase()) || baselineName !== undefined) {
      if (baselineName === undefined || baseline[baselineName] !== value) throw new Error('The forwarded environment was not admitted.');
    } else if (!names.has(name)) {
      throw new Error('The forwarded environment was not admitted.');
    }
  }
}

/** Forward an inherited spawner pair before trust inspection can start another process. */
export async function runEarlyForwardedDaemon(runtime: ICliRuntimeContext, argv: readonly string[]): Promise<boolean> {
  const request = parseForwardedStart(argv);
  if (request.kind === 'other') return false;
  if (request.kind === 'invalid') {
    process.stderr.write('Invalid daemon start --spawner-fd arguments.\n');
    process.exitCode = 1;
    return true;
  }
  if (!productSecureMode(runtime)) {
    process.stderr.write('--spawner-fd is available only in secure mode.\n');
    process.exitCode = 1;
    return true;
  }
  try {
    const environment = childProductEnvironment(runtime);
    // Admission may inspect a project through Git before the child is launched. Keep provider
    // values in the runtime snapshot for the private handoff, but never let those Git calls inherit them.
    for (const name of Object.keys(process.env)) {
      if (environment[name] === undefined) delete process.env[name];
    }
    for (const name of Object.keys(environment)) {
      if (name.startsWith('PRODUCT_TELEMETRY_') && name !== 'PRODUCT_TELEMETRY_SERVICE_NAME') delete environment[name];
    }
    const id = await launchForwardedRuntime(process.cwd(), {
      productRuntime: runtime,
      env: { ...environment, ...(runtime.environment.PRODUCT_CONFIG_FILE === undefined ? {} : { PRODUCT_CONFIG_FILE: runtime.environment.PRODUCT_CONFIG_FILE }) },
      spawnerFd: request.fd,
      prepareEnvironment: () => prepareForwardedAdmission(runtime, process.cwd(), request.restricted),
      ...(request.restricted ? { restricted: true } : {}),
    });
    if (Object.entries(runtime.environment).some(([name, value]) => name.startsWith('PRODUCT_TELEMETRY_') &&
        name !== 'PRODUCT_TELEMETRY_SERVICE_NAME' && value !== undefined && !(name === 'PRODUCT_TELEMETRY_ENABLED' && value === '0'))) {
      process.stderr.write('Telemetry settings are not forwarded to this secure runtime.\n');
    }
    process.stdout.write(request.json ? `${JSON.stringify({ id })}\n` : `Secure runtime ${id} started.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'The secure runtime could not start.'}\n`);
    process.exitCode = 1;
  }
  return true;
}
