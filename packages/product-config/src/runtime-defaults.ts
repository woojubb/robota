import { PRODUCT_CONFIG_DESCRIPTORS, ProductConfigError } from './contract.js';
import type { IProductConfig, IProductSetting, TConfigEnvironment } from './contract.js';

/** Only this allowlist can cross from build input to artifact runtime defaults. */
export const RUNTIME_DEFAULT_DESCRIPTORS: Readonly<Record<string, IProductSetting>> = Object.freeze(
  {
    PRODUCT_USER_STATE_DIR: PRODUCT_CONFIG_DESCRIPTORS.build.defaultUserRoot,
    PRODUCT_CACHE_DIR: PRODUCT_CONFIG_DESCRIPTORS.build.defaultCacheRoot,
    PRODUCT_LOG_DIR: PRODUCT_CONFIG_DESCRIPTORS.build.defaultLogRoot,
    PRODUCT_PROJECT_STATE_DIR: PRODUCT_CONFIG_DESCRIPTORS.build.defaultProjectDirectory,
    PRODUCT_SHARED_USER_SETTINGS: PRODUCT_CONFIG_DESCRIPTORS.settings.sharedUserFiles,
    PRODUCT_SHARED_PROJECT_SETTINGS: PRODUCT_CONFIG_DESCRIPTORS.settings.sharedProjectFiles,
  },
);

/** Explicit declared defaults; build-machine absolute roots and other host inputs are excluded. */
export function embeddedProductRuntimeDefaults(config: IProductConfig): TConfigEnvironment {
  const values: Record<string, string> = {};
  for (const [variable, descriptor] of Object.entries(RUNTIME_DEFAULT_DESCRIPTORS)) {
    const field = Object.entries(PRODUCT_CONFIG_DESCRIPTORS.build).find(
      ([, value]) => value === descriptor,
    );
    const setting = Object.entries(PRODUCT_CONFIG_DESCRIPTORS.settings).find(
      ([, value]) => value === descriptor,
    );
    const value =
      field === undefined
        ? (config.settings as Readonly<Record<string, unknown>>)[setting![0]]
        : (config.build as Readonly<Record<string, unknown>>)[field[0]];
    if (value !== undefined)
      values[variable] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return Object.freeze(values);
}

/** Validate transported defaults without trusting an artifact file's keys or relative paths. */
export function parseProductRuntimeDefaults(input: unknown): TConfigEnvironment {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new ProductConfigError('PRODUCT_RUNTIME_DEFAULTS', 'invalid defaults');
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const descriptor = RUNTIME_DEFAULT_DESCRIPTORS[key];
    if (descriptor === undefined || typeof value !== 'string')
      throw new ProductConfigError('PRODUCT_RUNTIME_DEFAULTS', 'unsupported default');
    try {
      const parsed = descriptor.parse(value);
      if (parsed !== undefined)
        result[key] = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    } catch {
      throw new ProductConfigError(key, 'invalid embedded default');
    }
  }
  return Object.freeze(result);
}
