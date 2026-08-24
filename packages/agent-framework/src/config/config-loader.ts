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
import { mergeSettings } from './config-merge.js';
import {
  SettingsSchema,
  type TSettings,
  type TEnvResolvedSettings,
  type IResolvedConfig,
} from './config-types.js';
import { SettingsParseError } from './settings-parse-error.js';
import { readSettingsSourceText } from './settings-source.js';

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
  },
  env: {},
};

/**
 * Read and parse a JSON file. Returns undefined if the file does not exist.
 * Throws on parse errors.
 */
function readJsonSource(source: TSettingsSource): unknown {
  const content = readSettingsSourceText(source, 'load configuration settings');
  // A file that is not there was never a layer. Absence stays absence — that is the ONLY case that
  // may answer `undefined`, because it is the only one where nothing was lost.
  if (content === undefined) return undefined;

  const raw = content.trim();
  if (raw.length === 0) {
    // An existing but empty file is corrupt, not absent. `settings-io.readSettings` in this
    // directory reaches `JSON.parse('')` and throws for the same file, so treating empty as missing
    // was this loader disagreeing with its neighbour rather than a considered policy — and a crash
    // during write is precisely how a settings file becomes empty.
    throw new SettingsParseError(source.displayName, 'the settings file is empty');
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    // CONFIG-002 / issue #2023. This returned `undefined`, and `loadConfig` skips a layer whose raw
    // value is `undefined` — so a corrupt layer never reached `SettingsSchema`. Shape validation is
    // fail-closed; this step was fail-open; and the fail-open path therefore routed around the
    // fail-closed one inside a single function.
    //
    // The direction is what makes it a security defect rather than a lost setting:
    // `toResolvedConfig` resolves `merged.permissions?.deny ?? DEFAULTS.permissions.deny`, and that
    // default is `[]`. A truncated project settings file that had carried a deny list came back as
    // a config with none, and no caller could tell that from a file which never had one.
    throw new SettingsParseError(
      source.displayName,
      error instanceof Error ? error.message : String(error),
    );
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
 * Load and merge all settings files, validate with Zod, return resolved config.
 */
export async function loadConfig(sources: readonly TSettingsSource[]): Promise<IResolvedConfig> {
  const rawEntries: Array<{ raw: unknown; source: TSettingsSource }> = [];
  for (const source of sources) {
    const raw = readJsonSource(source);
    if (raw !== undefined) {
      rawEntries.push({ raw, source });
    }
  }

  const parsedLayers: TEnvResolvedSettings[] = rawEntries.map(({ raw, source }) => {
    const result = SettingsSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid settings in ${source.displayName}: ${result.error.message}`);
    }
    return resolveEnvRefs(result.data);
  });

  const merged = mergeSettings(parsedLayers);
  return toResolvedConfig(merged);
}
