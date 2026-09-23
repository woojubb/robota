/**
 * Settings and provider probes (OBSERVABILITY-1991).
 *
 * Every fact here comes from an owner API — `inspectSettingsLayers` for the layers and their
 * provenance, `readProviderSettings` for the runtime-equivalent provider resolution. The probe adds
 * no reader of its own; that is the CLI-067 discipline the old `diagnose` command broke three times.
 */
import { basename, dirname } from 'node:path';

import { findProviderDefinition } from '@robota-sdk/agent-core';
import { inspectSettingsLayers, readProviderSettings } from '@robota-sdk/agent-framework';

import { describeDiagnosticError } from './doctor-redaction.js';

import type { IDoctorCheck, IDoctorDeps, IDoctorInputs } from './doctor-types.js';
import type { IProviderDefinitionConfig } from '@robota-sdk/agent-core';
import type {
  ISettingsInspection,
  ISettingsLayerInspection,
  TSettingsSource,
} from '@robota-sdk/agent-framework';

const HTTP_PORT = 80;
const HTTPS_PORT = 443;

/**
 * `settings.<scope>.<family>` — the id a user types into `--repair`. The family is the name of the
 * directory the file lives in, without its leading dot, so the id follows whatever layout the host
 * composed rather than a product name written here.
 */
export function settingsCheckId(source: TSettingsSource): string {
  const path = source.kind === 'host' ? source.path : source.relativePath;
  const family = basename(dirname(path)).replace(/^\./, '');
  return `settings.${source.scope}.${family}`;
}

/** The check id of the host's own user settings file — the settings repair target. */
export function userSettingsCheckId(inputs: IDoctorInputs): string | undefined {
  const source = inputs.settingsSources.find(
    (candidate) => candidate.kind === 'host' && candidate.path === inputs.userSettingsPath,
  );
  return source === undefined ? undefined : settingsCheckId(source);
}

function layerCause(layer: ISettingsLayerInspection): string {
  const cause = layer.cause;
  if (cause === undefined) return layer.state;
  switch (cause.state) {
    case 'unreadable':
      return cause.errno === undefined ? 'unreadable' : `unreadable (${cause.errno})`;
    case 'invalid-json':
      return cause.offset === undefined ? 'invalid-json' : `invalid-json at offset ${cause.offset}`;
    case 'schema-invalid':
      return `schema-invalid: ${(cause.issues ?? []).map((issue) => `${issue.path} (${issue.code})`).join(', ')}`;
    default:
      return cause.state;
  }
}

/** Only the host's own user settings file, and only when it is empty, is a settings repair target. */
export function isRepairableSettingsLayer(
  layer: ISettingsLayerInspection,
  inputs: IDoctorInputs,
): boolean {
  return (
    layer.source.kind === 'host' &&
    layer.source.path === inputs.userSettingsPath &&
    layer.state === 'empty'
  );
}

function layerCheck(layer: ISettingsLayerInspection, inputs: IDoctorInputs): IDoctorCheck {
  const id = settingsCheckId(layer.source);
  const path = layer.source.kind === 'host' ? layer.source.path : layer.source.relativePath;
  if (layer.state === 'absent') {
    return { id, label: 'Settings layer', status: 'not-configured', path, cause: 'absent' };
  }
  if (layer.state === 'ok') return { id, label: 'Settings layer', status: 'ok', path, cause: 'ok' };
  const repairable = isRepairableSettingsLayer(layer, inputs);
  return {
    id,
    label: 'Settings layer',
    status: 'fail',
    path,
    cause: layerCause(layer),
    detail: repairable
      ? ['The file exists but holds nothing; rewriting it as {} loses no content.']
      : ['Session start will refuse this configuration. Fix the file at the named path.'],
    ...(repairable ? { repair: id } : {}),
  };
}

function provenanceCheck(inspection: ISettingsInspection): IDoctorCheck {
  const lines = [
    ...inspection.provenance.map(
      (entry) => `${entry.key}: ${entry.rule} ← ${entry.contributors.join(' → ')}`,
    ),
    ...inspection.hookSources.map(
      (hook, index) => `settings hook ${index + 1}: ${hook.event}/${hook.type} ← ${hook.source}`,
    ),
  ];
  if (inspection.partial) {
    return {
      id: 'settings.merge',
      label: 'Merged settings',
      status: 'warn',
      cause: 'partial — a present layer is broken; session start will refuse this configuration',
      detail: lines.length === 0 ? ['(no key declared by a healthy layer)'] : lines,
    };
  }
  return {
    id: 'settings.merge',
    label: 'Merged settings',
    status: 'ok',
    cause: `${inspection.provenance.length} key(s) from ${inspection.layers.filter((l) => l.state === 'ok').length} layer(s)`,
    detail: lines.length === 0 ? ['(no settings declared)'] : lines,
  };
}

export interface ISettingsProbeResult {
  readonly inspection: ISettingsInspection;
  readonly checks: readonly IDoctorCheck[];
}

/** Every layer in precedence order, then the merged view with its provenance. */
export function probeSettings(inputs: IDoctorInputs): ISettingsProbeResult {
  const inspection = inspectSettingsLayers(inputs.settingsSources);
  return {
    inspection,
    checks: [
      ...inspection.layers.map((layer) => layerCheck(layer, inputs)),
      provenanceCheck(inspection),
    ],
  };
}

function resolutionCheck(config: IProviderDefinitionConfig): IDoctorCheck {
  const source =
    config.source === 'env-default'
      ? `env-default via ${config.sourceEnvVar ?? 'environment'}`
      : 'settings profile';
  return {
    id: 'provider.resolution',
    label: 'Provider',
    status: 'ok',
    cause: `${config.name} (${config.model}) — ${source}`,
  };
}

function endpointOf(
  config: IProviderDefinitionConfig,
  inputs: IDoctorInputs,
): { host: string; port: number; origin: string } | undefined {
  const definition = findProviderDefinition(inputs.providerDefinitions, config.name);
  const baseURL = config.baseURL ?? definition?.defaults?.baseURL;
  if (baseURL !== undefined) {
    try {
      const url = new URL(baseURL);
      const port =
        url.port === '' ? (url.protocol === 'http:' ? HTTP_PORT : HTTPS_PORT) : Number(url.port);
      return {
        host: url.hostname,
        port,
        origin: config.baseURL === undefined ? 'definition defaults.baseURL' : 'profile baseURL',
      };
    } catch {
      // allow-fallback: an unparseable baseURL is reported by the caller as a warn, never guessed
      return undefined;
    }
  }
  const endpoint = definition?.endpoint;
  return endpoint === undefined ? undefined : { ...endpoint, origin: 'definition endpoint' };
}

async function reachabilityCheck(
  config: IProviderDefinitionConfig,
  inputs: IDoctorInputs,
  deps: IDoctorDeps,
): Promise<IDoctorCheck> {
  const endpoint = endpointOf(config, inputs);
  if (endpoint === undefined) {
    return {
      id: 'provider.reachability',
      label: 'Provider reachability',
      status: 'warn',
      cause: `not checked: ${config.name} declares no endpoint (no profile baseURL, defaults.baseURL or definition endpoint)`,
    };
  }
  const result = await deps.probeEndpoint(endpoint.host, endpoint.port);
  const target = `${endpoint.host}:${endpoint.port} (${endpoint.origin})`;
  return result.reachable
    ? {
        id: 'provider.reachability',
        label: 'Provider reachability',
        status: 'ok',
        cause: `${target} reachable in ${result.elapsedMs ?? 0}ms`,
      }
    : {
        id: 'provider.reachability',
        label: 'Provider reachability',
        status: 'warn',
        cause: `${target} unreachable: ${result.error ?? 'connection failed'}`,
        detail: ['Check proxy settings, firewall, or the profile baseURL.'],
      };
}

/** Runtime-equivalent resolution, then TCP reachability of the host the resolved profile implies. */
export async function probeProvider(
  inputs: IDoctorInputs,
  deps: IDoctorDeps,
): Promise<{ readonly checks: readonly IDoctorCheck[]; readonly resolvedApiKey?: string }> {
  let config: IProviderDefinitionConfig;
  try {
    config = readProviderSettings(inputs.settingsSources, {
      providerDefinitions: inputs.providerDefinitions,
      env: { ...inputs.env },
    });
  } catch (error) {
    // allow-fallback: resolution failure IS the finding; it is reported, never defaulted
    return {
      checks: [
        {
          id: 'provider.resolution',
          label: 'Provider',
          status: 'fail',
          cause: describeDiagnosticError(error instanceof Error ? error : new Error(String(error))),
          detail: ['Run: robota --configure, or set the provider API key variable.'],
        },
      ],
    };
  }
  return {
    checks: [resolutionCheck(config), await reachabilityCheck(config, inputs, deps)],
    ...(config.apiKey === undefined ? {} : { resolvedApiKey: config.apiKey }),
  };
}
