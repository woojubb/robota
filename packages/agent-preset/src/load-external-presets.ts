import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { validateExternalPreset } from './preset-validation.js';
import { registerExternalPresets } from './resolve-preset.js';

import type { IPreset } from './preset-types.js';

/** Outcome of an external-preset load: which ids loaded and per-file load/validation errors. */
export interface IExternalPresetLoadResult {
  loaded: readonly string[];
  errors: readonly { file: string; error: string }[];
}

/** Conventional external-preset directory: `~/.robota/presets`. */
export function defaultExternalPresetDir(): string {
  return join(homedir(), '.robota', 'presets');
}

/**
 * Load, validate, and register every `*.json` external preset from `dir`.
 *
 * A missing directory yields an empty result (no error). Each file is JSON-parsed and validated;
 * a parse or validation failure is recorded as a per-file error and skipped — the remaining files
 * still load. Validated presets are registered via {@link registerExternalPresets}; registry
 * rejections (built-in id collision or duplicate id) are folded into `errors` against their file.
 */
export function loadExternalPresetsFromDir(dir: string): IExternalPresetLoadResult {
  if (!existsSync(dir)) {
    return { loaded: [], errors: [] };
  }

  const errors: { file: string; error: string }[] = [];
  const validPresets: IPreset[] = [];
  // Track which file each validated preset id came from so registry rejections map back to a file.
  const fileById = new Map<string, string>();

  const jsonFiles = readdirSync(dir).filter((name) => name.endsWith('.json'));
  for (const name of jsonFiles) {
    const filePath = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      // allow-fallback: a malformed file is reported per-file and skipped, not silently swallowed
      errors.push({ file: name, error: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const result = validateExternalPreset(parsed);
    if (!result.ok) {
      errors.push({ file: name, error: result.error });
      continue;
    }

    validPresets.push(result.preset);
    fileById.set(result.preset.id, name);
  }

  const registration = registerExternalPresets(validPresets);
  for (const rejection of registration.rejected) {
    errors.push({ file: fileById.get(rejection.id) ?? rejection.id, error: rejection.reason });
  }

  return { loaded: registration.registered, errors };
}

/**
 * Load external presets from the conventional directory (or `options.dir` when given).
 * Thin wrapper over {@link loadExternalPresetsFromDir}.
 */
export function loadExternalPresets(options?: { dir?: string }): IExternalPresetLoadResult {
  const dir = options?.dir ?? defaultExternalPresetDir();
  return loadExternalPresetsFromDir(dir);
}
