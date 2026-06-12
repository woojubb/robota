import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { SettingsParseError } from './settings-parse-error.js';

import type { TUniversalValue } from '@robota-sdk/agent-core';

export type TSettingsData = Record<string, TUniversalValue>;

export function getUserSettingsPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/';
  return join(home, '.robota', 'settings.json');
}

export type TSettingsScope = 'user' | 'project-local';

export function resolveSettingsPathForScope(
  cwd: string,
  scope: TSettingsScope | undefined,
): string {
  if (scope === undefined || scope === 'user') {
    return getUserSettingsPath();
  }
  return join(cwd, '.robota', 'settings.local.json');
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

export function writeSettings(path: string, settings: TSettingsData): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

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

export function deleteSettings(path: string): boolean {
  if (existsSync(path)) {
    unlinkSync(path);
    return true;
  }
  return false;
}
