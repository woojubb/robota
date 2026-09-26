/**
 * Whether, and how, an interactive session opens the device mesh, from the user settings'
 * `transports.mesh`:
 *
 * - `enabled` (default `false`): open the mesh at interactive startup;
 * - `options.capabilities`: what a linked device may ask of this one, replacing the default of
 *   presence, messages, files and hand-offs (files and hand-offs still ask the operator each time);
 * - `options.dht` / `pkarrRelays` / `nostrRelays` / `relay` / `turnServers` / `relayOnly`: see
 *   `parseMeshInternetSettings`.
 *
 * A malformed value fails closed with an error naming the setting.
 */
import { DEVICE_CAPABILITIES, type TDeviceCapability } from '@robota-sdk/agent-remote-pairing';

import { DEFAULT_MESH_POLICY } from './device-mesh.js';
import { parseMeshInternetSettings, type IMeshInternetSettings } from './mesh-internet-settings.js';

export interface IMeshSettings {
  readonly enabled: boolean;
  /** Sorted, without duplicates. */
  readonly policy: readonly TDeviceCapability[];
  readonly internet: IMeshInternetSettings;
}

const KNOWN: ReadonlySet<string> = new Set(DEVICE_CAPABILITIES);

function record(value: unknown, setting: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid mesh setting: \`${setting}\` must be an object.`);
  }
  return value as Record<string, unknown>;
}

function capabilities(value: unknown): readonly TDeviceCapability[] {
  if (value === undefined || value === null) return DEFAULT_MESH_POLICY;
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || !KNOWN.has(entry))
  ) {
    throw new Error(
      `Invalid mesh setting: \`capabilities\` must be a list of ${DEVICE_CAPABILITIES.join(', ')}.`,
    );
  }
  return [...new Set(value as TDeviceCapability[])].sort();
}

/** The mesh settings from the user settings' `transports` object; throws on a malformed value. */
export function parseMeshSettings(transports: unknown): IMeshSettings {
  const mesh = record(record(transports, 'transports')['mesh'], 'transports.mesh');
  const enabled = mesh['enabled'];
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new Error('Invalid mesh setting: `transports.mesh.enabled` must be true or false.');
  }
  const options = mesh['options'];
  return {
    enabled: enabled ?? false,
    policy: capabilities(record(options, 'transports.mesh.options')['capabilities']),
    internet: parseMeshInternetSettings(options),
  };
}
