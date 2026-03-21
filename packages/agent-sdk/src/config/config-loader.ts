/**
 * Config loader — discovers, merges, and validates settings files.
 *
 * Precedence (highest → lowest):
 *   .robota/settings.local.json  (project-local overrides, git-ignored)
 *   .robota/settings.json        (project-level)
 *   ~/.robota/settings.json      (user-level)
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
  if (settings.provider?.apiKey !== undefined) {
    return {
      ...settings,
      provider: {
        ...settings.provider,
        apiKey: resolveEnvRef(settings.provider.apiKey),
      },
    };
  }
  return settings;
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
    };
  }, {});
}

/**
 * Convert merged TSettings into a fully-resolved IResolvedConfig with defaults.
 */
function toResolvedConfig(merged: TSettings): IResolvedConfig {
  return {
    defaultTrustLevel: merged.defaultTrustLevel ?? DEFAULTS.defaultTrustLevel,
    provider: {
      name: merged.provider?.name ?? DEFAULTS.provider.name,
      model: merged.provider?.model ?? DEFAULTS.provider.model,
      apiKey: merged.provider?.apiKey ?? DEFAULTS.provider.apiKey,
    },
    permissions: {
      allow: merged.permissions?.allow ?? DEFAULTS.permissions.allow,
      deny: merged.permissions?.deny ?? DEFAULTS.permissions.deny,
    },
    env: merged.env ?? DEFAULTS.env,
    hooks: merged.hooks ?? undefined,
  };
}

/**
 * Load and merge all settings files, validate with Zod, return resolved config.
 *
 * @param cwd - The working directory (project root) to search for .robota/
 */
export async function loadConfig(cwd: string): Promise<IResolvedConfig> {
  const userSettingsPath = join(getHomeDir(), '.robota', 'settings.json');
  const projectSettingsPath = join(cwd, '.robota', 'settings.json');
  const localSettingsPath = join(cwd, '.robota', 'settings.local.json');

  const rawLayers: unknown[] = [
    readJsonFile(userSettingsPath),
    readJsonFile(projectSettingsPath),
    readJsonFile(localSettingsPath),
  ].filter((v): v is unknown => v !== undefined);

  const parsedLayers: TSettings[] = rawLayers.map((raw, index) => {
    const result = SettingsSchema.safeParse(raw);
    if (!result.success) {
      const paths = [userSettingsPath, projectSettingsPath, localSettingsPath].filter(
        (_, i) => rawLayers[i] !== undefined,
      );
      throw new Error(`Invalid settings in ${paths[index] ?? 'unknown'}: ${result.error.message}`);
    }
    return resolveEnvRefs(result.data);
  });

  const merged = mergeSettings(parsedLayers);
  return toResolvedConfig(merged);
}
