import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { validateExternalPreset } from './preset-validation.js';
import { partitionExternalPresets } from './resolve-preset.js';

import type { IPreset } from './preset-types.js';

/**
 * Outcome of an external-preset load: the presets themselves, their ids, and per-file errors.
 *
 * ARCH-009 added `presets`. `loaded` used to be the only way out, because the presets went into a
 * module-global registry and the caller read them back by id — which is what made the global
 * load-bearing at startup. The caller now receives the values it loaded and builds its own registry
 * over them, so nothing has to be looked up from process state.
 */
export interface IExternalPresetLoadResult {
  presets: readonly IPreset[];
  loaded: readonly string[];
  errors: readonly { file: string; error: string }[];
}

/** Conventional external-preset directory: `~/.robota/presets`. */
export function defaultExternalPresetDir(): string {
  return join(homedir(), '.robota', 'presets');
}

/**
 * Load and validate every `*.json` external preset from `dir`.
 *
 * A missing directory yields an empty result (no error). Each file is JSON-parsed and validated;
 * a parse or validation failure is recorded as a per-file error and skipped — the remaining files
 * still load. The surviving presets go through {@link partitionExternalPresets}, whose rejections
 * (built-in id collision or duplicate id) are folded into `errors` against their file.
 *
 * Loading REGISTERS NOTHING. The result is a value the caller owns.
 */
export function loadExternalPresetsFromDir(dir: string): IExternalPresetLoadResult {
  if (!existsSync(dir)) {
    return { presets: [], loaded: [], errors: [] };
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

  const { accepted, rejected } = partitionExternalPresets(validPresets);
  for (const rejection of rejected) {
    errors.push({ file: fileById.get(rejection.id) ?? rejection.id, error: rejection.reason });
  }

  return { presets: accepted, loaded: accepted.map((preset) => preset.id), errors };
}

/**
 * Load external presets from the conventional directory (or `options.dir` when given).
 * Thin wrapper over {@link loadExternalPresetsFromDir}.
 */
export function loadExternalPresets(options?: { dir?: string }): IExternalPresetLoadResult {
  const dir = options?.dir ?? defaultExternalPresetDir();
  return loadExternalPresetsFromDir(dir);
}
