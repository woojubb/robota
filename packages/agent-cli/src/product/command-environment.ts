/**
 * Credentials the runtime holds for itself stay out of the commands it runs (issue #3429).
 *
 * The runtime resolves provider credentials from its startup environment snapshot, so the live
 * `process.env` — what every tool, hook and background command inherits — can drop them. Withholding
 * them here, once, covers every spawner at the process boundary instead of trusting each one to
 * filter.
 */
import { ENV_REFERENCE_PREFIX, type IProviderDefinition } from '@robota-sdk/agent-core';
import {
  inspectSettingsLayers,
  readMergedProviderSettings,
  type TSettingsSource,
} from '@robota-sdk/agent-framework';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function referencedName(value: string | undefined): string | undefined {
  if (value?.startsWith(ENV_REFERENCE_PREFIX) !== true) return undefined;
  const name = value.slice(ENV_REFERENCE_PREFIX.length).trim();
  return ENV_NAME.test(name) ? name : undefined;
}

/** Every variable a provider profile or definition names as its credential. */
export function providerCredentialVariables(
  settingsSources: readonly TSettingsSource[],
  providerDefinitions: readonly IProviderDefinition[],
): readonly string[] {
  const settings = readMergedProviderSettings(settingsSources);
  const names = new Set<string>();
  const add = (value: string | undefined): void => {
    const name = referencedName(value);
    if (name !== undefined) names.add(name);
  };
  add(settings.provider?.apiKey);
  for (const profile of Object.values(settings.providers ?? {})) add(profile.apiKey);
  for (const definition of providerDefinitions) add(definition.defaults?.apiKey);
  return [...names].sort();
}

/**
 * Names the owner opted in. Only host layers (user, managed) count: a project's settings come with
 * the repository, and a cloned repository must not be able to hand the owner's key to its commands.
 */
export function commandEnvironmentAllowList(
  settingsSources: readonly TSettingsSource[],
): ReadonlySet<string> {
  const hostSources = settingsSources.filter((source) => source.kind === 'host');
  const allowed = new Set<string>();
  for (const layer of inspectSettingsLayers(hostSources).layers) {
    for (const name of layer.settings?.commandEnvAllow ?? [])
      if (ENV_NAME.test(name)) allowed.add(name);
  }
  return allowed;
}

/** Names this process withheld from its commands; process-wide, like the environment it edits. */
const withheldFromCommands = new Set<string>();

/** Removes runtime-owned values from live inheritance and records them for snapshot commands. */
export function withholdEnvironmentVariables(
  names: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const withheld: string[] = [];
  for (const name of names) {
    withheldFromCommands.add(name);
    if (!(name in environment)) continue;
    delete environment[name];
    withheld.push(name);
  }
  return withheld;
}

/**
 * Removes provider credential variables from `environment` (the live process env by default) and
 * remembers them, so a command started from the startup snapshot instead is denied them too.
 */
export function withholdProviderCredentials(
  settingsSources: readonly TSettingsSource[],
  providerDefinitions: readonly IProviderDefinition[],
  environment: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const allowed = commandEnvironmentAllowList(settingsSources);
  return withholdEnvironmentVariables(
    providerCredentialVariables(settingsSources, providerDefinitions).filter(
      (name) => !allowed.has(name),
    ),
    environment,
  );
}

/** Whether this process withholds `name` from the commands it runs. */
export function isWithheldFromCommands(name: string): boolean {
  return withheldFromCommands.has(name);
}

/** A command environment built from a snapshot: the snapshot without what was withheld. */
export function commandEnvironment(
  snapshot: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const environment = { ...snapshot };
  for (const name of withheldFromCommands) delete environment[name];
  return environment;
}
