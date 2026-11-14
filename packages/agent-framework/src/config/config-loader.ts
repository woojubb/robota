/**
 * Config loader — discovers, merges, and validates settings files.
 *
 * The loader names no paths: it reads the ordered `TSettingsSource` list its host composes, and a
 * later layer overrides an earlier one. The CLI product composes this order (lowest → highest):
 *   1. `settings.json` in the product's user state root (`storage.userRoot`)       (user)
 *   2. each `settings.sharedUserFiles` entry, relative to the user's home          (user)
 *   3. `settings.json` in the project state directory (`storage.projectDirectory`) (project)
 *   4. `settings.local.json` in the project state directory                        (project-local)
 *   5. each `settings.sharedProjectFiles` entry, relative to the workspace root    (scope per entry)
 *
 * `storage.*` and `settings.*` are fields of the product config. The user state root is an absolute
 * path; the project state directory is one directory segment under the trusted workspace root, which
 * a consumer product host defaults to `.<product id>` from the product identity. The product config
 * declares the Claude Code files as the shared-file defaults (`~/.claude/settings.json`,
 * `.claude/settings.json` and `.claude/settings.local.json`); a consumer product host defaults both
 * lists to none.
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
 * and the loader read one implementation; the errors raised here are the loader's own, by layer
 * state:
 * - an existing but empty file is corrupt, not absent (`settings-io.readSettings` reaches
 *   `JSON.parse('')` for the same file, and a crash during write is precisely how a settings file
 *   becomes empty);
 * - a corrupt layer is refused rather than skipped: skipping it would let a truncated project file
 *   that had carried a deny list come back as a config with none;
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
function resolveEnvRef(
  value: string,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const ENV_PREFIX = '$ENV:';
  if (value.startsWith(ENV_PREFIX)) {
    const varName = value.slice(ENV_PREFIX.length);
    return environment[varName] ?? value;
  }
  return value;
}

/**
 * Apply env-ref resolution to all string fields in a settings object.
 */
function resolveEnvRefs(
  settings: TSettings,
  environment: Readonly<Record<string, string | undefined>>,
): TEnvResolvedSettings {
  const provider =
    settings.provider?.apiKey !== undefined
      ? resolveProviderCredentialEnvRefs(settings.provider, environment)
      : settings.provider;

  if (settings.providers !== undefined) {
    const providers = Object.fromEntries(
      Object.entries(settings.providers).map(([name, profile]) => [
        name,
        resolveProviderCredentialEnvRefs(profile, environment),
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
 * Resolving a `$ENV:` reference here is correct — an in-process provider needs the secret — and the
 * variable name is recorded beside the resolved value (`apiKeyEnv`), so a caller that has to
 * serialize the config can carry the reference instead of the secret. Without it every later caller
 * sees only the resolved value, and the plaintext credential reaches the subagent IPC start payload
 * even when its owner deliberately stored a reference.
 */
function resolveProviderCredentialEnvRefs<TProvider extends { apiKey?: string }>(
  provider: TProvider,
  environment: Readonly<Record<string, string | undefined>>,
): TProvider & { apiKeyEnv?: string } {
  if (provider.apiKey === undefined) return provider;
  const ENV_PREFIX = '$ENV:';
  const wasReference = provider.apiKey.startsWith(ENV_PREFIX);
  return {
    ...provider,
    apiKey: resolveEnvRef(provider.apiKey, environment),
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
    apiKey:
      profile.apiKeyRef === undefined ? (profile.apiKey ?? DEFAULTS.provider.apiKey) : undefined,
    ...(profile.apiKeyRef !== undefined && { apiKeyRef: profile.apiKeyRef }),
    // This projection is field-by-field, so the credential's ORIGIN has to be copied
    // deliberately. Without this line the resolved config the subagent runner serializes carries
    // only the secret, not the variable name recorded when `$ENV:` was resolved.
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
    ...(merged.sandbox !== undefined ? { sandbox: merged.sandbox } : {}),
  };
}

/**
 * Load and merge all settings files, validate with Zod, return resolved config.
 */
export async function loadConfig(
  sources: readonly TSettingsSource[],
  environment: Readonly<Record<string, string | undefined>> = {},
): Promise<IResolvedConfig> {
  return (await loadConfigWithHookSources(sources, environment)).config;
}

/** Internal composition metadata; intentionally not re-exported from the package root. */
export async function loadConfigWithHookSources(
  sources: readonly TSettingsSource[],
  environment: Readonly<Record<string, string | undefined>> = {},
): Promise<{ config: IResolvedConfig; hookSources: readonly IHookDefinitionSource[] }> {
  const layers = readSettingsLayers(sources);
  // Read-phase errors first, across every layer, then the first schema failure — the loader's
  // two-phase order (see `throwReadPhaseError`).
  for (const layer of layers) throwReadPhaseError(layer);
  const parsedLayers: Array<{ settings: TEnvResolvedSettings; source: string }> = [];
  for (const layer of layers) {
    if (layer.state === 'absent') continue;
    if (layer.state === 'schema-invalid' || layer.settings === undefined) {
      throw new Error(`Invalid settings in ${layer.source.displayName}: ${layer.schemaMessage}`);
    }
    parsedLayers.push({
      settings: resolveEnvRefs(layer.settings, environment),
      source: layer.source.displayName,
    });
  }

  const merged = mergeSettingsWithHookSources(parsedLayers);
  return { config: toResolvedConfig(merged.settings), hookSources: merged.hookSources };
}
