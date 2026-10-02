import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { loadProductConfigSelection } from '@robota-sdk/product-config/node';
import { embeddedProductIdentity, productConfigEntries, resolveProductConfig } from '@robota-sdk/product-config';
import { robotaEnvironment } from './robota.js';

import type { IEmbeddedProductIdentity, IProductConfig, TConfigEnvironment } from '@robota-sdk/product-config';

export interface IDesktopProductConfigSelection {
  readonly config: IProductConfig;
  readonly fileValues: TConfigEnvironment;
}

/** Resolve host settings once. Packaged identity is build-fixed; operational values remain host supplied. */
export function loadDesktopProductConfigSelection(options: {
  readonly environment: TConfigEnvironment;
  readonly identityFile: string;
  readonly isPackaged: boolean;
  readonly readFile?: (path: string) => string;
  readonly exists?: (path: string) => boolean;
}): IDesktopProductConfigSelection {
  const exists = options.exists ?? existsSync;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const identityExists = exists(options.identityFile);
  if (options.isPackaged && !identityExists) {
    throw new Error('Packaged desktop application is missing its embedded product identity.');
  }

  let embeddedIdentity: IEmbeddedProductIdentity | undefined;
  if (identityExists) {
    try {
      embeddedIdentity = JSON.parse(readFile(options.identityFile)) as IEmbeddedProductIdentity;
    } catch {
      throw new Error('Packaged desktop product identity is invalid.');
    }
  }
  const environment = Object.freeze({ ...options.environment });
  const defaults = embeddedIdentity === undefined ? undefined : robotaEnvironment(
    environment,
    environment.HOME ?? environment.USERPROFILE ?? homedir(),
    (profileEnvironment) =>
      JSON.stringify(embeddedProductIdentity(resolveProductConfig({ environment: profileEnvironment }))) ===
      JSON.stringify(embeddedIdentity),
  );
  return loadProductConfigSelection({
    environment,
    ...(defaults !== undefined ? { defaults } : {}),
    ...(embeddedIdentity !== undefined ? { embeddedIdentity } : {}),
    ...(options.readFile !== undefined ? { readFile: options.readFile } : {}),
  });
}

/** Compatibility helper for callers that need only the resolved descriptor. */
export function loadDesktopProductConfig(options: Parameters<typeof loadDesktopProductConfigSelection>[0]): IProductConfig {
  return loadDesktopProductConfigSelection(options).config;
}

const childOperatingSystemVariables = Object.freeze([
  'PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
  'XDG_RUNTIME_DIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
]);
const scriptedE2eVariables = Object.freeze([
  'PRODUCT_E2E_DAEMON_STATE', 'PRODUCT_E2E_DAEMON_FAIL', 'PRODUCT_E2E_DAEMON_FAIL_FILE',
  'PRODUCT_E2E_TRUST_FILE', 'PRODUCT_E2E_SETUP_REQUIRED', 'PRODUCT_E2E_WORKSPACE_CWD',
]);

/** Curated environment for trust and daemon CLI children, from selected config plus required OS inputs. */
export function desktopCliEnvironment(
  config: IProductConfig,
  explicitEnvironment: TConfigEnvironment,
  options: {
    readonly providerEnvironmentReferences?: readonly string[];
    readonly allowScriptedE2eVariables?: boolean;
  } = {},
): Record<string, string> {
  // The selected file path is forwarded so each CLI invocation reloads its current contents. Do not
  // copy file values into the child: that would turn a prior app snapshot into an override on reconnect.
  const definedExplicit = Object.fromEntries(
    Object.entries(explicitEnvironment).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const environment: Record<string, string> = {};
  for (const key of childOperatingSystemVariables) {
    const value = explicitEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }
  if (options.allowScriptedE2eVariables === true) {
    for (const key of scriptedE2eVariables) {
      const value = explicitEnvironment[key];
      if (value !== undefined) environment[key] = value;
    }
  }
  for (const key of options.providerEnvironmentReferences ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    const value = definedExplicit[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const { section, field, descriptor } of productConfigEntries()) {
    if (descriptor.exposure === 'private' || !descriptor.consumers.includes('cli')) continue;
    const value = (config[section] as Readonly<Record<string, unknown>>)[field];
    if (value !== undefined) environment[descriptor.variable] = Array.isArray(value) ? JSON.stringify(value) : String(value);
  }
  const configFile = explicitEnvironment.PRODUCT_CONFIG_FILE;
  if (configFile !== undefined) environment.PRODUCT_CONFIG_FILE = configFile;
  return environment;
}

/** Restricted daemon starts never inherit provider or transport references, even after a fresh trusted probe. */
export function desktopDaemonEnvironment(
  config: IProductConfig,
  explicitEnvironment: TConfigEnvironment,
  options: {
    readonly restricted: boolean;
    readonly providerEnvironmentReferences: readonly string[];
    readonly allowScriptedE2eVariables?: boolean;
  },
): Record<string, string> {
  return desktopCliEnvironment(config, explicitEnvironment, {
    providerEnvironmentReferences: options.restricted ? [] : options.providerEnvironmentReferences,
    allowScriptedE2eVariables: options.allowScriptedE2eVariables,
  });
}

/** Build-time helper shared by electron-builder and the sidecar bundler. */
export function readEmbeddedDesktopIdentity(identityFile: string): IEmbeddedProductIdentity {
  return JSON.parse(readFileSync(identityFile, 'utf8')) as IEmbeddedProductIdentity;
}

export function resolveDesktopIdentity(config: IProductConfig, identityFile: string): IEmbeddedProductIdentity {
  return existsSync(identityFile) ? readEmbeddedDesktopIdentity(identityFile) : embeddedProductIdentity(config);
}

export function desktopIdentityPath(moduleDirectory: string): string {
  return join(moduleDirectory, 'product-identity.json');
}

/** Keep Electron's persistent profile beneath the configured state root, independently of display name. */
export function desktopUserDataPath(config: IProductConfig): string {
  return join(config.storage.userRoot, 'desktop');
}
