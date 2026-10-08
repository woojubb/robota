import { scopeProductEnvironment } from './environment.js';
import {
  PRODUCT_CONFIG_DESCRIPTORS,
  ProductConfigError,
  productConfigEntries,
  productSettingAlias,
} from './contract.js';

import type {
  IEmbeddedProductIdentity,
  IHostProductConfig,
  IProductConfig,
  IProductSetting,
  IPublicProductConfig,
  TConfigEnvironment,
} from './contract.js';

export interface IResolveProductConfigOptions {
  readonly environment: TConfigEnvironment;
  readonly fileValues?: TConfigEnvironment;
  readonly defaults?: TConfigEnvironment;
  readonly embeddedIdentity?: IEmbeddedProductIdentity;
}

type TConfigObject = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
type TMutableConfigObject = Record<string, Record<string, unknown>>;

function valueInLayer(layer: TConfigEnvironment, descriptor: IProductSetting, prefix: string): string | undefined {
  const canonical = layer[descriptor.variable];
  const aliasName = productSettingAlias(descriptor, prefix);
  const alias = aliasName === undefined ? undefined : layer[aliasName];
  if (canonical !== undefined && alias !== undefined && canonical !== alias) {
    throw new ProductConfigError(descriptor.variable, `conflicts with ${aliasName}`);
  }
  return canonical ?? alias;
}

function parse(descriptor: IProductSetting, value: string | undefined): unknown {
  if (descriptor.required && (value === undefined || value.trim() === '')) {
    throw new ProductConfigError(descriptor.variable, 'required value is missing or empty');
  }
  try {
    return descriptor.parse(value ?? '');
  } catch {
    throw new ProductConfigError(descriptor.variable, `invalid ${descriptor.format}`);
  }
}

function immutable<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function embeddedValue(descriptor: IProductSetting, value: unknown): unknown {
  if (value === undefined) return parse(descriptor, undefined);
  if (typeof value === 'string') return parse(descriptor, value);
  if (Array.isArray(value)) return parse(descriptor, JSON.stringify(value));
  throw new ProductConfigError(descriptor.variable, `invalid embedded ${descriptor.format}`);
}

/** Pure, per-call configuration resolution. The caller supplies every source. */
export function resolveProductConfig(options: IResolveProductConfigOptions): IProductConfig {
  const environment = options.embeddedIdentity === undefined ? options.environment : scopeProductEnvironment(options.environment, options.embeddedIdentity);
  const layers = [environment, options.fileValues ?? {}, options.defaults ?? {}];
  const prefixDescriptor = PRODUCT_CONFIG_DESCRIPTORS.identity.envPrefix;
  const embedded = options.embeddedIdentity as TConfigObject | undefined;
  const prefixLayers = embedded === undefined ? layers : layers.slice(0, 2);
  const rawPrefix = prefixLayers.map((layer) => layer[prefixDescriptor.variable]).find((value) => value !== undefined);
  const prefix = (rawPrefix === undefined && embedded !== undefined
    ? embeddedValue(prefixDescriptor, embedded['identity']?.['envPrefix'])
    : parse(prefixDescriptor, rawPrefix)) as string;
  const result: TMutableConfigObject = {};
  for (const { section, field, descriptor } of productConfigEntries()) {
    // Inspect every supplied layer for ambiguity, including ones masked by higher precedence.
    const values = layers.map((layer) => valueInLayer(layer, descriptor, prefix));
    const supplied = (embedded !== undefined && descriptor.phase === 'identity' ? values.slice(0, 2) : values)
      .find((value) => value !== undefined);
    const identityValue = descriptor.phase === 'identity' && embedded !== undefined
      ? embeddedValue(descriptor, embedded[section]?.[field])
      : undefined;
    const parsed = supplied === undefined && embedded !== undefined && descriptor.phase === 'identity'
      ? identityValue
      : parse(descriptor, supplied ?? descriptor.defaultValue);
    if (embedded !== undefined && descriptor.phase === 'identity') {
      if (JSON.stringify(parsed) !== JSON.stringify(identityValue)) {
        throw new ProductConfigError(descriptor.variable, 'conflicts with embedded artifact identity');
      }
    }
    (result[section] ??= {})[field] = parsed;
  }
  // All values were parsed from descriptors and all sections were populated above.
  return immutable(result) as IProductConfig;
}

function project(config: IProductConfig, accepts: (descriptor: IProductSetting) => boolean): TConfigObject {
  const result: TMutableConfigObject = {};
  const source = config as TConfigObject;
  for (const { section, field, descriptor } of productConfigEntries()) {
    if (accepts(descriptor)) (result[section] ??= {})[field] = source[section]![field];
  }
  return immutable(result);
}

/** Explicit public allowlist for browsers and renderer builds; no host or private values. */
export function publicProductConfig(config: IProductConfig): IPublicProductConfig {
  return project(config, (descriptor) => descriptor.exposure === 'public') as IPublicProductConfig;
}

/** Check a staged JSON projection against the same descriptors used to generate it. */
export function parsePublicProductConfig(input: unknown): IPublicProductConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ProductConfigError('PRODUCT_PUBLIC_CONFIG', 'expected a public configuration object');
  }
  const source = input as Record<string, unknown>;
  const publicEntries = productConfigEntries().filter(({ descriptor }) => descriptor.exposure === 'public');
  const sections = new Set(publicEntries.map(({ section }) => String(section)));
  if (Object.keys(source).some((section) => !sections.has(section))) {
    throw new ProductConfigError('PRODUCT_PUBLIC_CONFIG', 'unexpected section');
  }
  const parsed: TMutableConfigObject = {};
  for (const section of sections) {
    const value = source[section];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ProductConfigError('PRODUCT_PUBLIC_CONFIG', 'missing or invalid section');
    }
    const record = value as Record<string, unknown>;
    const allowed = new Set(publicEntries.filter((entry) => entry.section === section).map((entry) => entry.field));
    if (Object.keys(record).some((field) => !allowed.has(field))) {
      throw new ProductConfigError('PRODUCT_PUBLIC_CONFIG', 'unexpected public setting');
    }
    parsed[section] = {};
  }
  for (const { section, field, descriptor } of publicEntries) {
    const record = source[section] as Record<string, unknown>;
    if (!Object.hasOwn(record, field)) {
      if (descriptor.required) throw new ProductConfigError(descriptor.variable, 'required public setting is missing');
      continue;
    }
    const value = record[field];
    if (value === undefined && !descriptor.required) continue;
    if (typeof value !== 'string' && !Array.isArray(value)) {
      throw new ProductConfigError(descriptor.variable, `invalid ${descriptor.format}`);
    }
    let normalized: unknown;
    try {
      normalized = descriptor.parse(typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      throw new ProductConfigError(descriptor.variable, `invalid ${descriptor.format}`);
    }
    if (JSON.stringify(normalized) !== JSON.stringify(value)) {
      throw new ProductConfigError(descriptor.variable, 'public setting is not canonical');
    }
    parsed[section]![field] = normalized;
  }
  return immutable(parsed) as IPublicProductConfig;
}

/** Non-secret host data; private references must be handed directly to their owning adapter. */
export function hostProductConfig(config: IProductConfig): IHostProductConfig {
  return project(config, (descriptor) => descriptor.exposure !== 'private') as IHostProductConfig;
}

/** Build-fixed identity only; excludes operational values and every private reference. */
export function embeddedProductIdentity(config: IProductConfig): IEmbeddedProductIdentity {
  return project(config, (descriptor) => descriptor.phase === 'identity' && descriptor.exposure !== 'private') as IEmbeddedProductIdentity;
}
