/**
 * Settings file I/O operations.
 * Handles reading, writing, and updating ~/.robota/settings.json.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { TUniversalValue } from '@robota-sdk/agent-core';

export type TSettingsData = Record<string, TUniversalValue>;

/** Get the user-global settings file path */
export function getUserSettingsPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/';
  return join(home, '.robota', 'settings.json');
}

/** Read settings from a JSON file. Returns empty object if file doesn't exist or is corrupt. */
export function readSettings(path: string): TSettingsData {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw) as TSettingsData;
  } catch {
    process.stderr.write(`Warning: corrupt settings file at ${path}, resetting to defaults\n`);
    return {};
  }
}

/** Write settings to a JSON file, creating parent directories as needed. */
export function writeSettings(path: string, settings: TSettingsData): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/** Update the provider.model field in a settings file. */
export function updateModelInSettings(settingsPath: string, modelId: string): void {
  const settings = readSettings(settingsPath);
  const currentProvider = settings.currentProvider;
  const providers = settings.providers;
  if (typeof currentProvider === 'string' && isSettingsData(providers)) {
    const providerMap = providers as Record<string, TSettingsData | undefined>;
    providerMap[currentProvider] = {
      ...(isSettingsData(providerMap[currentProvider]) ? providerMap[currentProvider] : {}),
      model: modelId,
    };
    settings.providers = providerMap;
  } else {
    settings.provider = {
      ...(isSettingsData(settings.provider) ? settings.provider : {}),
      model: modelId,
    };
  }
  writeSettings(settingsPath, settings);
}

function isSettingsData(value: TUniversalValue): value is TSettingsData {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  );
}

/** Delete a settings file if it exists. Returns true if deleted. */
export function deleteSettings(path: string): boolean {
  if (existsSync(path)) {
    unlinkSync(path);
    return true;
  }
  return false;
}
