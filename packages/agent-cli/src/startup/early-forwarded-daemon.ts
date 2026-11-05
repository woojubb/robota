import { createWorkspaceProjectSettingsSources, getWorkspaceProjectReader } from '@robota-sdk/agent-framework';
import { TRANSPORT_ENVIRONMENT } from '@robota-sdk/agent-executor';
import { productConfigEntries } from '@robota-sdk/product-config';

import { childProductEnvironment } from '../product/child-environment.js';
import { productProviderDefinitions } from '../product/provider-definitions.js';
import { providerEnvironmentReferences, restartProductEnvironment } from '../product/restart-environment.js';
import { createProductUserSettingsSources } from '../product/user-settings.js';
import { productSecureMode } from '../product/session-sealing.js';
import { launchForwardedRuntime } from '../session-inventory/supervised-session-launch.js';
import { optionArgv } from '../utils/option-argv.js';
import { isSupportedLiveTelemetrySetting, validateNodeOtlpLiveTelemetrySettings } from '../telemetry/live-trace-otlp.js';
import { takeProductTelemetryEnvironment } from '../telemetry/live-telemetry-env.js';
import { canAskToTrust } from './interactive-trust-prompt.js';
import { runtimeVersion } from './version.js';
import { resolveInitialCliWorkspaceProjectAccess } from './workspace-project-composition.js';
import { formatHeadlessWorkspaceTrustError, requiresHeadlessWorkspaceTrust } from './workspace-trust-admission.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

type TForwardedStart =
  | { readonly kind: 'other' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'start'; readonly fd: number; readonly json: boolean; readonly restricted: boolean };

/** Only this exact daemon start is handled before workspace admission. */
function parseForwardedStart(argv: readonly string[]): TForwardedStart {
  const args = optionArgv(argv).slice(2);
  if (args[0] !== 'daemon' || args[1] !== 'start') return { kind: 'other' };
  if (!args.slice(2).some((arg) => arg === '--spawner-fd' || arg.startsWith('--spawner-fd='))) return { kind: 'other' };
  if (argv.includes('--')) return { kind: 'invalid' };
  let value: string | undefined;
  let json = false;
  let restricted = false;
  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json' && !json) json = true;
    else if (arg === '--restricted-workspace' && !restricted) restricted = true;
    else if (arg === '--spawner-fd' && value === undefined) value = args[++index];
    else if (arg?.startsWith('--spawner-fd=') && value === undefined) value = arg.slice('--spawner-fd='.length);
    else return { kind: 'invalid' };
  }
  if (value === undefined || !/^[0-9]+$/u.test(value)) return { kind: 'invalid' };
  const fd = Number(value);
  if (!Number.isSafeInteger(fd) || fd < 3) return { kind: 'invalid' };
  return { kind: 'start', fd, json, restricted };
}

/** Test synchronously so unrelated starts retain their original startup ordering. */
export function isEarlyForwardedDaemon(argv: readonly string[]): boolean {
  return parseForwardedStart(argv).kind !== 'other';
}

async function admittedSources(runtime: ICliRuntimeContext, cwd: string, restricted: boolean) {
  const access = await resolveInitialCliWorkspaceProjectAccess(cwd, { productRuntime: runtime });
  if (requiresHeadlessWorkspaceTrust(access) && !(restricted && canAskToTrust(access))) {
    throw new Error(formatHeadlessWorkspaceTrustError(access, cwd, runtime.config.identity.cliName));
  }
  return [
    ...createProductUserSettingsSources(runtime),
    ...(access.status === 'trusted' && !restricted
      ? createWorkspaceProjectSettingsSources(getWorkspaceProjectReader(access.authority), runtime.layout.projectSettingsPaths)
      : []),
  ];
}

/** After forwarding, admit project settings and retain only their declared provider references. */
export async function prepareForwardedEnvironment(runtime: ICliRuntimeContext, cwd: string, restricted: boolean): Promise<NodeJS.ProcessEnv> {
  const sources = await admittedSources(runtime, cwd, restricted);
  const telemetryInput = { ...runtime.environment };
  delete telemetryInput.PRODUCT_TELEMETRY_SERVICE_NAME;
  const telemetry = takeProductTelemetryEnvironment(telemetryInput);
  validateNodeOtlpLiveTelemetrySettings(telemetry, {
    telemetryServiceName: runtime.config.identity.telemetryServiceName,
    serviceVersion: runtimeVersion(runtime),
    surface: 'serve',
  });
  const environment = restartProductEnvironment(runtime, sources, productProviderDefinitions());
  for (const name of TRANSPORT_ENVIRONMENT) delete environment[name];
  return { ...environment, ...telemetry };
}

/** Recheck workspace authority and the allowed names before installing an IPC environment. */
export async function validateForwardedEnvironment(runtime: ICliRuntimeContext, cwd: string, restricted: boolean, forwarded: Readonly<Record<string, string>>): Promise<void> {
  const sources = await admittedSources(runtime, cwd, restricted);
  const names = new Set(providerEnvironmentReferences(sources, productProviderDefinitions()));
  for (const name of TRANSPORT_ENVIRONMENT) names.delete(name);
  const baseline: NodeJS.ProcessEnv = { ...childProductEnvironment(runtime), ...(runtime.environment.PRODUCT_CONFIG_FILE === undefined ? {} : { PRODUCT_CONFIG_FILE: runtime.environment.PRODUCT_CONFIG_FILE }) };
  const protectedNames = new Set([
    'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP', 'SHELL', 'XDG_RUNTIME_DIR',
    'PRODUCT_CONFIG_FILE', 'PRODUCT_WS_TOKEN', `${runtime.config.identity.envPrefix}WS_TOKEN`.toUpperCase(),
    ...productConfigEntries().map(({ descriptor }) => descriptor.variable.toUpperCase()),
  ]);
  for (const [name, value] of Object.entries(forwarded)) {
    const baselineName = Object.keys(baseline).find((key) => key.toUpperCase() === name.toUpperCase());
    if (protectedNames.has(name.toUpperCase()) || baselineName !== undefined) {
      if (baselineName === undefined || baseline[baselineName] !== value) throw new Error('The forwarded environment was not admitted.');
    } else if (!names.has(name) && !isSupportedLiveTelemetrySetting(name)) {
      throw new Error('The forwarded environment was not admitted.');
    }
  }
}

/** Forward an inherited spawner pair before trust inspection can start another process. */
export async function runEarlyForwardedDaemon(runtime: ICliRuntimeContext, argv: readonly string[]): Promise<boolean> {
  const request = parseForwardedStart(argv);
  if (request.kind === 'other') return false;
  if (request.kind === 'invalid') {
    process.stderr.write('Invalid daemon start --spawner-fd arguments.\n');
    process.exitCode = 1;
    return true;
  }
  if (!productSecureMode(runtime)) {
    process.stderr.write('--spawner-fd is available only in secure mode.\n');
    process.exitCode = 1;
    return true;
  }
  try {
    const id = await launchForwardedRuntime(process.cwd(), {
      productRuntime: runtime,
      env: { ...childProductEnvironment(runtime), ...(runtime.environment.PRODUCT_CONFIG_FILE === undefined ? {} : { PRODUCT_CONFIG_FILE: runtime.environment.PRODUCT_CONFIG_FILE }) },
      spawnerFd: request.fd,
      prepareEnvironment: () => prepareForwardedEnvironment(runtime, process.cwd(), request.restricted),
      ...(request.restricted ? { restricted: true } : {}),
    });
    process.stdout.write(request.json ? `${JSON.stringify({ id })}\n` : `Secure runtime ${id} started.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'The secure runtime could not start.'}\n`);
    process.exitCode = 1;
  }
  return true;
}
