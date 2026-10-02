import { hostProductConfig, productConfigEntries } from '@robota-sdk/product-config';

import type { ICliRuntimeContext } from './runtime-context.js';

/** Only host-visible configuration crosses to a worker; private key-file references and telemetry do not. */
export function childProductEnvironment(runtime: ICliRuntimeContext): NodeJS.ProcessEnv {
  const projected = hostProductConfig(runtime.config) as unknown as Record<string, Record<string, unknown>>;
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SHELL', 'SystemRoot', 'XDG_RUNTIME_DIR']) {
    if (runtime.environment[key] !== undefined) environment[key] = runtime.environment[key];
  }
  for (const { section, field, descriptor } of productConfigEntries()) {
    if (descriptor.exposure === 'private') continue;
    const value = projected[section]?.[field];
    if (value !== undefined) environment[descriptor.variable] = Array.isArray(value) ? JSON.stringify(value) : String(value);
  }
  return environment;
}
