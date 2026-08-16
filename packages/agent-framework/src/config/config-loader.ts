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
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import {
  SettingsSchema,
  type TSettings,
  type TEnvResolvedSettings,
  type IResolvedConfig,
} from './config-types.js';

/**
 * Return the current user home directory.
 * Reads process.env.HOME at call time so tests can override it.
 */
function getHomeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '/';
}

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
  },
  env: {},
};

/**
 * Read and parse a JSON file. Returns undefined if the file does not exist.
 * Throws on parse errors.
 */
function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return undefined;
  }
  const raw = readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) {
    // Empty file — likely from a crash during write. Treat as missing.
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // allow-fallback: corrupt config JSON (likely a crash during write) is treated as missing config
    return undefined;
  }
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

/**
 * Deep-merge settings objects. Later entries in the array win.
 * Arrays are replaced (not concatenated) so that project settings
 * fully override user settings for list-type fields.
 */
function mergeSettings(layers: TEnvResolvedSettings[]): TEnvResolvedSettings {
  return layers.reduce<TEnvResolvedSettings>((merged, layer) => {
    return {
      ...merged,
      ...layer,
      provider:
        merged.provider !== undefined || layer.provider !== undefined
          ? { ...merged.provider, ...layer.provider }
          : undefined,
      permissions:
        merged.permissions !== undefined || layer.permissions !== undefined
          ? {
              allow: layer.permissions?.allow ?? merged.permissions?.allow,
              deny: layer.permissions?.deny ?? merged.permissions?.deny,
            }
          : undefined,
      env: {
        ...(merged.env ?? {}),
        ...(layer.env ?? {}),
      },
      providers:
        merged.providers !== undefined || layer.providers !== undefined
          ? mergeProviders(merged.providers, layer.providers)
          : undefined,
      enabledPlugins:
        merged.enabledPlugins !== undefined || layer.enabledPlugins !== undefined
          ? { ...(merged.enabledPlugins ?? {}), ...(layer.enabledPlugins ?? {}) }
          : undefined,
      extraKnownMarketplaces: layer.extraKnownMarketplaces ?? merged.extraKnownMarketplaces,
      autoCompactThreshold: layer.autoCompactThreshold ?? merged.autoCompactThreshold,
    };
  }, {});
}

function mergeProviders(
  base: TEnvResolvedSettings['providers'],
  override: TEnvResolvedSettings['providers'],
): TEnvResolvedSettings['providers'] {
  const result: NonNullable<TEnvResolvedSettings['providers']> = { ...(base ?? {}) };
  for (const [name, profile] of Object.entries(override ?? {})) {
    result[name] = {
      ...result[name],
      ...profile,
    };
  }
  return result;
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
 * Build the ordered list of settings file paths (lowest → highest priority).
 */
function getSettingsPaths(cwd: string): string[] {
  const home = getHomeDir();
  return [
    join(home, '.robota', 'settings.json'), // 1. user (lowest)
    join(home, '.claude', 'settings.json'), // 1b. user (Claude Code compat)
    join(cwd, '.robota', 'settings.json'), // 2. project
    join(cwd, '.robota', 'settings.local.json'), // 3. project-local
    join(cwd, '.claude', 'settings.json'), // 4. project, Claude Code compat
    join(cwd, '.claude', 'settings.local.json'), // 5. project-local (highest)
  ];
}

/**
 * Load and merge all settings files, validate with Zod, return resolved config.
 *
 * @param cwd - The working directory (project root) to search for settings
 */
export async function loadConfig(cwd: string): Promise<IResolvedConfig> {
  const allPaths = getSettingsPaths(cwd);

  const rawEntries: Array<{ raw: unknown; path: string }> = [];
  for (const filePath of allPaths) {
    const raw = readJsonFile(filePath);
    if (raw !== undefined) {
      rawEntries.push({ raw, path: filePath });
    }
  }

  const parsedLayers: TEnvResolvedSettings[] = rawEntries.map(({ raw, path }) => {
    const result = SettingsSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid settings in ${path}: ${result.error.message}`);
    }
    return resolveEnvRefs(result.data);
  });

  const merged = mergeSettings(parsedLayers);
  return toResolvedConfig(merged);
}
