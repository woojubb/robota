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
import { SettingsSchema, type TSettings, type IResolvedConfig } from './config-types.js';

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
    // Corrupt JSON — likely from a crash during write. Treat as missing.
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
function resolveEnvRefs(settings: TSettings): TSettings {
  const provider =
    settings.provider?.apiKey !== undefined
      ? {
          ...settings.provider,
          apiKey: resolveEnvRef(settings.provider.apiKey),
        }
      : settings.provider;

  if (settings.providers !== undefined) {
    const providers = Object.fromEntries(
      Object.entries(settings.providers).map(([name, profile]) => [
        name,
        {
          ...profile,
          ...(profile.apiKey !== undefined && { apiKey: resolveEnvRef(profile.apiKey) }),
        },
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
 * Deep-merge settings objects. Later entries in the array win.
 * Arrays are replaced (not concatenated) so that project settings
 * fully override user settings for list-type fields.
 */
function mergeSettings(layers: TSettings[]): TSettings {
  return layers.reduce<TSettings>((merged, layer) => {
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
    };
  }, {});
}

function mergeProviders(
  base: TSettings['providers'],
  override: TSettings['providers'],
): TSettings['providers'] {
  const result: NonNullable<TSettings['providers']> = { ...(base ?? {}) };
  for (const [name, profile] of Object.entries(override ?? {})) {
    result[name] = {
      ...result[name],
      ...profile,
    };
  }
  return result;
}

function resolveProvider(merged: TSettings): IResolvedConfig['provider'] {
  if (merged.currentProvider !== undefined) {
    const profile = merged.providers?.[merged.currentProvider];
    if (profile === undefined) {
      throw new Error(`currentProvider "${merged.currentProvider}" was not found in providers`);
    }
    if (profile.type === undefined) {
      throw new Error(`Provider profile "${merged.currentProvider}" is missing type`);
    }
    return {
      name: profile.type,
      model: profile.model ?? DEFAULTS.provider.model,
      apiKey: profile.apiKey ?? DEFAULTS.provider.apiKey,
      ...(profile.baseURL !== undefined && { baseURL: profile.baseURL }),
      ...(profile.timeout !== undefined && { timeout: profile.timeout }),
      ...(profile.options !== undefined && { options: profile.options }),
    };
  }

  return {
    name: merged.provider?.name ?? DEFAULTS.provider.name,
    model: merged.provider?.model ?? DEFAULTS.provider.model,
    apiKey: merged.provider?.apiKey ?? DEFAULTS.provider.apiKey,
    ...(merged.provider?.baseURL !== undefined && { baseURL: merged.provider.baseURL }),
    ...(merged.provider?.timeout !== undefined && { timeout: merged.provider.timeout }),
    ...(merged.provider?.options !== undefined && { options: merged.provider.options }),
  };
}

/**
 * Convert merged TSettings into a fully-resolved IResolvedConfig with defaults.
 */
function toResolvedConfig(merged: TSettings): IResolvedConfig {
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

  const parsedLayers: TSettings[] = rawEntries.map(({ raw, path }) => {
    const result = SettingsSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid settings in ${path}: ${result.error.message}`);
    }
    return resolveEnvRefs(result.data);
  });

  const merged = mergeSettings(parsedLayers);
  return toResolvedConfig(merged);
}
