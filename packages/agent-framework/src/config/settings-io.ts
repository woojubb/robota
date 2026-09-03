import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { ensureOwnerOnlyDirectory, tightenExistingFile } from '@robota-sdk/agent-core/node';

import { NoCurrentProviderProfileError } from './no-current-provider-profile-error.js';
import { SettingsParseError } from './settings-parse-error.js';

import type { TUniversalValue } from '@robota-sdk/agent-core';

export type TSettingsData = Record<string, TUniversalValue>;
/** CLI-selectable settings write scope; project-local still requires an authorized project store. */
export type TSettingsScope = 'user' | 'project-local';

export function getUserSettingsPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/';
  return join(home, '.robota', 'settings.json');
}

/**
 * CLI-069: missing file → empty defaults (non-error); an EXISTING file that
 * fails to parse throws SettingsParseError — no warn-and-continue masking.
 */
export function readSettings(path: string): TSettingsData {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw) as TSettingsData;
  } catch (error) {
    // allow-fallback: rethrown as typed SettingsParseError — fail-fast, not a fallback
    throw new SettingsParseError(path, error instanceof Error ? error.message : String(error));
  }
}

/**
 * SEC-003: settings files can hold a plaintext provider credential — `provider-settings.ts`
 * persists `apiKey` verbatim when `--api-key-env` is not used (and warns while doing it). A
 * default-umask create would leave that credential world-readable, so the file is created
 * owner-only. `mode` applies at creation, so a settings file an older version already wrote keeps
 * its mode — which is why SEC-020 tightens it before the write rather than trusting `mode` alone.
 */
export function writeSettings(path: string, settings: TSettingsData): void {
  // SEC-020: created with no mode at all, so the settings directory came out 0755 under umask 022
  // and every account on the host could list what it holds. The file itself was already
  // owner-only, but a rewrite leaves an older 0644 copy at 0644 — `mode` applies only at create.
  ensureOwnerOnlyDirectory(dirname(path));
  tightenExistingFile(path);
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/**
 * CONFIG-002: writes `providers[currentProvider].model`, the only shape `loadConfig()` accepts.
 * A file with no active profile (missing file, or legacy flat `provider`) is refused with
 * `NoCurrentProviderProfileError` and left untouched — the writer never emits a loader-rejected shape.
 */
export function updateModelInSettings(settingsPath: string, modelId: string): void {
  const settings = readSettings(settingsPath);
  const currentProvider = settings.currentProvider;
  const providers = settings.providers;
  if (typeof currentProvider !== 'string' || !isSettingsData(providers)) {
    throw new NoCurrentProviderProfileError(settingsPath);
  }
  const providerMap = providers as Record<string, TSettingsData | undefined>;
  providerMap[currentProvider] = {
    ...(isSettingsData(providerMap[currentProvider]) ? providerMap[currentProvider] : {}),
    model: modelId,
  };
  settings.providers = providerMap;
  writeSettings(settingsPath, settings);
}

function isSettingsData(value: TUniversalValue): value is TSettingsData {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  );
}

export function deleteSettings(path: string): boolean {
  if (existsSync(path)) {
    unlinkSync(path);
    return true;
  }
  return false;
}
