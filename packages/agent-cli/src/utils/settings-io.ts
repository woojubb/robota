/**
 * Settings file I/O operations.
 * Handles reading, writing, and updating ~/.robota/settings.json.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Get the user-global settings file path */
export function getUserSettingsPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/';
  return join(home, '.robota', 'settings.json');
}

/** Read settings from a JSON file. Returns empty object if file doesn't exist. */
export function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** Write settings to a JSON file, creating parent directories as needed. */
export function writeSettings(path: string, settings: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/** Update the provider.model field in a settings file. */
export function updateModelInSettings(settingsPath: string, modelId: string): void {
  const settings = readSettings(settingsPath);
  const provider = (settings.provider ?? {}) as Record<string, unknown>;
  provider.model = modelId;
  settings.provider = provider;
  writeSettings(settingsPath, settings);
}

/** Delete a settings file if it exists. Returns true if deleted. */
export function deleteSettings(path: string): boolean {
  if (existsSync(path)) {
    unlinkSync(path);
    return true;
  }
  return false;
}
