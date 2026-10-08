import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

import {
  PRODUCT_CONFIG_FILE_VARIABLE,
  ProductConfigError,
  productConfigEntries,
} from './contract.js';
import { parseProductRuntimeDefaults } from './runtime-defaults.js';
import { scopeProductEnvironment } from './environment.js';
import { resolveProductConfig } from './resolve.js';

import type { IProductConfig, TConfigEnvironment } from './contract.js';
import type { IResolveProductConfigOptions } from './resolve.js';

export interface ILoadProductConfigOptions extends Omit<IResolveProductConfigOptions, 'fileValues'> {
  /** Explicit absolute file path. No current-directory search or path expansion occurs. */
  readonly filePath?: string;
  /** File reader injection; the default reads only the explicitly selected file. */
  readonly readFile?: (path: string) => string;
}

export interface ILoadedProductConfigSelection {
  readonly config: IProductConfig;
  /** Uninterpreted entries from the selected file, including host operational settings. */
  readonly fileValues: TConfigEnvironment;
}

/** Parse environment-file syntax without environment expansion or ambient reads. */
export function parseProductEnvironmentFile(source: string): TConfigEnvironment {
  try {
    // Node releases differ in trailing-comment handling. Strip only comments outside quotes,
    // leaving quoted content and multiline values to the standard environment-file parser.
    let quote: '"' | "'" | undefined;
    let normalized = '';
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index]!;
      if (quote === '"' && character === '\\') {
        normalized += character;
        if (index + 1 < source.length) normalized += source[++index];
      } else if (quote !== undefined) {
        normalized += character;
        if (character === quote) quote = undefined;
      } else if (character === '"' || character === "'") {
        quote = character;
        normalized += character;
      } else if (character === '#') {
        while (index + 1 < source.length && source[index + 1] !== '\n') index += 1;
      } else normalized += character;
    }
    return Object.freeze({ ...parseEnv(normalized) });
  } catch {
    throw new ProductConfigError(PRODUCT_CONFIG_FILE_VARIABLE, 'invalid environment file');
  }
}

/** Explicit host loading; never reads process.env, cwd, key files, or cached configuration. */
export function loadProductConfig(options: ILoadProductConfigOptions): IProductConfig {
  return loadProductConfigSelection(options).config;
}

/** Return the resolved descriptor and its selected file layer from one explicit read. */
export function loadProductConfigSelection(options: ILoadProductConfigOptions): ILoadedProductConfigSelection {
  const environment = options.embeddedIdentity === undefined
      ? options.environment
      : scopeProductEnvironment(options.environment, options.embeddedIdentity);
  const environmentPath = environment[PRODUCT_CONFIG_FILE_VARIABLE];
  if (options.filePath !== undefined && environmentPath !== undefined && environmentPath !== options.filePath) {
    throw new ProductConfigError(PRODUCT_CONFIG_FILE_VARIABLE, 'conflicts with explicitly selected file');
  }
  const selectedPath = options.filePath ?? environmentPath;
  if (selectedPath !== undefined && selectedPath !== '' && !isAbsolute(selectedPath)) {
    throw new ProductConfigError(PRODUCT_CONFIG_FILE_VARIABLE, 'selected file path must be absolute');
  }
  let fileValues: TConfigEnvironment = Object.freeze({});
  if (selectedPath !== undefined && selectedPath !== '') {
    try {
      const read = options.readFile ?? ((path: string): string => readFileSync(path, 'utf8'));
      fileValues = parseProductEnvironmentFile(read(selectedPath));
    } catch {
      throw new ProductConfigError(PRODUCT_CONFIG_FILE_VARIABLE, 'selected environment file could not be loaded');
    }
  }
  const config = resolveProductConfig({ ...options, environment, fileValues });
  const normalized: Record<string, string> = {};
  for (const { section, field, descriptor } of productConfigEntries()) {
    const value = (config[section] as Readonly<Record<string, unknown>>)[field];
    if (value === undefined) continue;
    if (descriptor.path && typeof value === 'string' && !isAbsolute(value)) {
      if (selectedPath === undefined || selectedPath === '') {
        throw new ProductConfigError(descriptor.variable, 'relative path requires an explicitly selected environment file');
      }
      normalized[descriptor.variable] = resolve(dirname(selectedPath), value);
    } else {
      normalized[descriptor.variable] = typeof value === 'string' ? value : JSON.stringify(value);
    }
  }
  return Object.freeze({
    config: resolveProductConfig({ environment: normalized, embeddedIdentity: options.embeddedIdentity }),
    fileValues,
  });
}

/** Only declared artifact roots expand against home; runtime paths keep selected-file semantics. */
export function expandProductRuntimeDefaults(input: unknown, home: string): TConfigEnvironment {
  if (!isAbsolute(home))
    throw new ProductConfigError('PRODUCT_RUNTIME_DEFAULTS', 'invocation home must be absolute');
  const values = { ...parseProductRuntimeDefaults(input) };
  for (const key of ['PRODUCT_USER_STATE_DIR', 'PRODUCT_CACHE_DIR', 'PRODUCT_LOG_DIR']) {
    if (values[key] !== undefined) values[key] = join(home, values[key]!);
  }
  return Object.freeze(values);
}
