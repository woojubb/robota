import {
  embeddedProductIdentity,
  productConfigEntries,
  resolveProductConfig,
  scopeProductEnvironment,
} from '@robota-sdk/product-config';
import {
  expandProductRuntimeDefaults,
  loadProductConfigSelection,
} from '@robota-sdk/product-config/node';
import { homedir } from 'node:os';
import { robotaEnvironment } from '../../../../products/robota.mjs';

import { createCliRuntimeContext } from '../product/runtime-context.js';

import type {
  IEmbeddedProductIdentity,
  IProductConfig,
  TConfigEnvironment,
} from '@robota-sdk/product-config';
import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { IStartCliOptions } from './cli-options-types.js';

/** Generated product workspaces inject only validated, non-secret artifact identity. */
declare const __PRODUCT_CONFIG_IDENTITY__: IEmbeddedProductIdentity | undefined;
declare const __PRODUCT_CONFIG_DEFAULTS__: TConfigEnvironment | undefined;

/** The Node host resolves one invocation before launch, trust, network or persistent storage. */
export function resolveCliRuntimeContext(options: IStartCliOptions): ICliRuntimeContext {
  let embeddedIdentity =
    typeof __PRODUCT_CONFIG_IDENTITY__ === 'undefined' ? undefined : __PRODUCT_CONFIG_IDENTITY__;
  if (options.productRuntime !== undefined) {
    assertArtifactIdentity(options.productRuntime.config, embeddedIdentity);
    return options.productRuntime;
  }
  const suppliedEnvironment: TConfigEnvironment =
    options.environment ?? Object.freeze({ ...process.env });
  const home = suppliedEnvironment.HOME ?? suppliedEnvironment.USERPROFILE ?? homedir();
  // Without a build identity, explicit library inputs remain a construction seam. The ordinary
  // binary uses its built-in identity rather than adopting a product from the ambient environment.
  if (
    embeddedIdentity === undefined &&
    options.environment === undefined &&
    options.productConfig === undefined &&
    options.productConfigFile === undefined
  ) {
    embeddedIdentity = embeddedProductIdentity(
      resolveProductConfig({ environment: robotaEnvironment({}, home) }),
    );
  }
  const environment =
    embeddedIdentity === undefined
      ? suppliedEnvironment
      : scopeProductEnvironment(suppliedEnvironment, embeddedIdentity);
  const artifactDefaults =
    typeof __PRODUCT_CONFIG_DEFAULTS__ === 'undefined'
      ? undefined
      : expandProductRuntimeDefaults(__PRODUCT_CONFIG_DEFAULTS__, home);
  const profileDefaults =
    options.productConfigFile !== undefined ||
    options.productConfig !== undefined
      ? undefined
      : robotaEnvironment(
          environment,
          home,
          embeddedIdentity === undefined ? undefined : (profileEnvironment) =>
            JSON.stringify(embeddedProductIdentity(resolveProductConfig({ environment: profileEnvironment }))) ===
            JSON.stringify(embeddedIdentity),
        );
  const defaults =
    artifactDefaults === undefined ? profileDefaults : { ...profileDefaults, ...artifactDefaults };
  const selection =
    options.productConfig === undefined
      ? loadProductConfigSelection({
          environment,
          ...(defaults !== undefined ? { defaults } : {}),
          ...(options.productConfigFile !== undefined
            ? { filePath: options.productConfigFile }
            : {}),
          ...(embeddedIdentity !== undefined ? { embeddedIdentity } : {}),
        })
      : undefined;
  const config = options.productConfig ?? selection!.config;
  assertArtifactIdentity(config, embeddedIdentity);
  const prefix = config.identity.envPrefix;
  const fileEnvironment = normalizeProductEnvironment(selection?.fileValues ?? {}, prefix);
  const explicitEnvironment = normalizeProductEnvironment(environment, prefix);
  const hostEnvironment: Record<string, string | undefined> = {
    ...fileEnvironment,
    ...explicitEnvironment,
  };
  if (options.productConfigFile !== undefined)
    hostEnvironment.PRODUCT_CONFIG_FILE = options.productConfigFile;
  // File-relative paths have already been resolved by the descriptor loader. Keep the host
  // snapshot consistent with the resolved paths consumed by storage and child projections.
  for (const { section, field, descriptor } of productConfigEntries()) {
    const value = (config[section] as Readonly<Record<string, unknown>>)[field];
    if (value !== undefined)
      hostEnvironment[descriptor.variable] = Array.isArray(value)
        ? JSON.stringify(value)
        : String(value);
  }
  return createCliRuntimeContext(config, hostEnvironment);
}

/** Canonical technical host inputs and selected product aliases share one invocation snapshot. */
export function normalizeProductEnvironment(
  environment: TConfigEnvironment,
  prefix: string,
): TConfigEnvironment {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) normalized[key] = value;
  }
  for (const [key, value] of Object.entries(environment)) {
    if (!key.startsWith(prefix) || value === undefined) continue;
    const canonical = `PRODUCT_${key.slice(prefix.length)}`;
    if (canonical === 'PRODUCT_ENV_PREFIX' || canonical === 'PRODUCT_CONFIG_FILE') continue;
    if (environment[canonical] !== undefined && environment[canonical] !== value) {
      throw new Error(`${canonical}: conflicting canonical and product alias values`);
    }
    normalized[canonical] = value;
  }
  return Object.freeze(normalized);
}

/** Explicit injected contexts still obey the immutable identity of an installed artifact. */
function assertArtifactIdentity(
  config: IProductConfig,
  embeddedIdentity: IEmbeddedProductIdentity | undefined,
): void {
  if (embeddedIdentity === undefined) return;
  const environment: Record<string, string> = {};
  for (const { section, field, descriptor } of productConfigEntries()) {
    const value = (config[section] as Readonly<Record<string, unknown>>)[field];
    if (value !== undefined)
      environment[descriptor.variable] = Array.isArray(value)
        ? JSON.stringify(value)
        : String(value);
  }
  resolveProductConfig({ environment, embeddedIdentity });
}
