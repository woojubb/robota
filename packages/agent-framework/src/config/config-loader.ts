/**
 * Config loader — discovers, merges, and validates settings files.
 *
 * Precedence (lowest → highest):
 *   1. ~/.robota/settings.json       (user)
 *   2. ~/.claude/settings.json       (user, Claude Code compat)
 *   3. .robota/settings.json         (project)
 *   4. .robota/settings.local.json   (project-local)
 *   5. .claude/settings.json         (project, Claude Code compat)
 *   6. .claude/settings.local.json   (project-local, highest priority)
 */
import { mergeSettingsWithHookSources } from './config-merge.js';
import { readSettingsLayers } from './settings-inspection.js';
import { SettingsParseError } from './settings-parse-error.js';

import type { IHookDefinitionSource } from './config-merge.js';
import type { TSettings, TEnvResolvedSettings, IResolvedConfig } from './config-types.js';
import type { IReadSettingsLayer } from './settings-inspection.js';
import type { TSettingsSource } from './settings-source.js';

/** Default resolved config values */
const DEFAULTS: IResolvedConfig = {
  defaultTrustLevel: 'moderate',
  provider: {
    name: 'anthropic',
    model: 'claude-opus-4-5',
    apiKey: undefined,
  },
  permissions: {
    allow: [],
    deny: [],
    ask: [],
  },
  env: {},
};

/**
 * Raise the loader's read-phase error for a classified layer.
 *
 * The classification itself lives in `settings-inspection.ts` (`readSettingsLayers`) so the doctor
 * and the loader read one implementation (OBSERVABILITY-1991); the errors raised here are the ones
 * this loader has always raised, at the same layer:
 * - an existing but empty file is corrupt, not absent (`settings-io.readSettings` reaches
 *   `JSON.parse('')` for the same file, and a crash during write is precisely how a settings file
 *   becomes empty);
 * - a corrupt layer is refused rather than skipped — CONFIG-002 / issue #2023: returning `undefined`
 *   let a truncated project file that had carried a deny list come back as a config with none;
 * - an unreadable existing file propagates the reader's own error.
 */
function throwReadPhaseError(layer: IReadSettingsLayer): void {
  if (layer.state === 'empty') {
    throw new SettingsParseError(layer.source.displayName, 'the settings file is empty');
  }
  if (layer.state === 'invalid-json') {
    throw new SettingsParseError(layer.source.displayName, layer.error?.message ?? 'invalid JSON');
  }
  if (layer.state === 'unreadable') throw layer.error;
}

/**
 * Resolve a string value that may use the `$ENV:VAR_NAME` prefix to
 * substitute an environment variable.
 */
function resolveEnvRef(value: string): string {
  const ENV_PREFIX = '$ENV:';
  if (value.startsWith(ENV_PREFIX)) {
    const varName = value.slice(ENV_PREFIX.length);
    return process.env[varName] ?? value;
  }
  return value;
}

/**
 * Apply env-ref resolution to all string fields in a settings object.
 */
function resolveEnvRefs(settings: TSettings): TEnvResolvedSettings {
  const provider =
    settings.provider?.apiKey !== undefined
      ? resolveProviderCredentialEnvRefs(settings.provider)
      : settings.provider;

  if (settings.providers !== undefined) {
    const providers = Object.fromEntries(
      Object.entries(settings.providers).map(([name, profile]) => [
        name,
        resolveProviderCredentialEnvRefs(profile),
      ]),
    );
    return {
      ...settings,
      provider,
      providers,
    };
  }

  return {
    ...settings,
    provider,
  };
}

/**
 * SEC-009: resolving a `$ENV:` reference here is correct — an in-process provider needs the secret
 * — but it DISCARDED the variable name, so every later caller saw only the resolved value. A caller
 * that has to serialize the config then had no way to carry the reference instead of the secret,
 * which is how the plaintext credential reached the subagent IPC start payload on every
 * configuration, including the ones whose owner deliberately stored a reference. Recording the
 * variable name costs nothing and is what makes the reference recoverable downstream.
 */
function resolveProviderCredentialEnvRefs<TProvider extends { apiKey?: string }>(
  provider: TProvider,
): TProvider & { apiKeyEnv?: string } {
  if (provider.apiKey === undefined) return provider;
  const ENV_PREFIX = '$ENV:';
  const wasReference = provider.apiKey.startsWith(ENV_PREFIX);
  return {
    ...provider,
    apiKey: resolveEnvRef(provider.apiKey),
    ...(wasReference && { apiKeyEnv: provider.apiKey.slice(ENV_PREFIX.length) }),
  };
}

function resolveProvider(merged: TEnvResolvedSettings): IResolvedConfig['provider'] {
  if (merged.currentProvider !== undefined) {
    return resolveActiveProviderProfile(merged);
  }
  if (merged.provider !== undefined) {
    throw new Error(
      'Legacy flat "provider" settings are not supported. Migrate to "currentProvider" + "providers" format.',
    );
  }
  return { ...DEFAULTS.provider };
}

function resolveActiveProviderProfile(merged: TEnvResolvedSettings): IResolvedConfig['provider'] {
  const currentProvider = merged.currentProvider;
  if (currentProvider === undefined) {
    throw new Error('currentProvider is required');
  }
  const profile = merged.providers?.[currentProvider];
  if (profile === undefined) {
    throw new Error(`currentProvider "${currentProvider}" was not found in providers`);
  }
  if (profile.type === undefined) {
    throw new Error(`Provider profile "${currentProvider}" is missing type`);
  }
  return {
    name: profile.type,
    model: profile.model ?? DEFAULTS.provider.model,
    apiKey: profile.apiKey ?? DEFAULTS.provider.apiKey,
    // SEC-009: this projection is field-by-field, so the credential's ORIGIN has to be copied
    // deliberately. Resolving `$ENV:` and recording the variable name upstream achieved nothing
    // while this line was missing — the resolved config the subagent runner serializes had only
    // the secret, which is the whole defect.
    ...(profile.apiKeyEnv !== undefined && { apiKeyEnv: profile.apiKeyEnv }),
    ...(profile.baseURL !== undefined && { baseURL: profile.baseURL }),
    ...(profile.timeout !== undefined && { timeout: profile.timeout }),
    ...(profile.options !== undefined && { options: profile.options }),
  };
}

/**
 * Convert merged TSettings into a fully-resolved IResolvedConfig with defaults.
 */
function toResolvedConfig(merged: TEnvResolvedSettings): IResolvedConfig {
  return {
    defaultTrustLevel: merged.defaultTrustLevel ?? DEFAULTS.defaultTrustLevel,
    language: merged.language,
    currentProvider: merged.currentProvider,
    provider: resolveProvider(merged),
    permissions: {
      allow: merged.permissions?.allow ?? DEFAULTS.permissions.allow,
      deny: merged.permissions?.deny ?? DEFAULTS.permissions.deny,
      ask: merged.permissions?.ask ?? DEFAULTS.permissions.ask,
    },
    env: merged.env ?? DEFAULTS.env,
    hooks: merged.hooks ?? undefined,
    enabledPlugins: merged.enabledPlugins ?? undefined,
    extraKnownMarketplaces: merged.extraKnownMarketplaces ?? undefined,
    autoCompactThreshold: merged.autoCompactThreshold,
    taskContext: merged.taskContext ?? undefined,
  };
}

/**
 * Load and merge all settings files, validate with Zod, return resolved config.
 */
export async function loadConfig(sources: readonly TSettingsSource[]): Promise<IResolvedConfig> {
  return (await loadConfigWithHookSources(sources)).config;
}

/** Internal composition metadata; intentionally not re-exported from the package root. */
export async function loadConfigWithHookSources(
  sources: readonly TSettingsSource[],
): Promise<{ config: IResolvedConfig; hookSources: readonly IHookDefinitionSource[] }> {
  const layers = readSettingsLayers(sources);
  // Read-phase errors first, across every layer, then the first schema failure — the order the
  // two-phase loader always had (see `throwReadPhaseError`).
  for (const layer of layers) throwReadPhaseError(layer);
  const parsedLayers: Array<{ settings: TEnvResolvedSettings; source: string }> = [];
  for (const layer of layers) {
    if (layer.state === 'absent') continue;
    if (layer.state === 'schema-invalid' || layer.settings === undefined) {
      throw new Error(`Invalid settings in ${layer.source.displayName}: ${layer.schemaMessage}`);
    }
    parsedLayers.push({
      settings: resolveEnvRefs(layer.settings),
      source: layer.source.displayName,
    });
  }

  const merged = mergeSettingsWithHookSources(parsedLayers);
  return { config: toResolvedConfig(merged.settings), hookSources: merged.hookSources };
}
