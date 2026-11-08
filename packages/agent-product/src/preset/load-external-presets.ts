import { validateExternalPreset } from './preset-validation.js';
import { partitionExternalPresets } from './resolve-preset.js';

import type { IPreset } from './preset-types.js';

/**
 * Outcome of an external-preset load: the presets themselves, their ids, and per-file errors.
 *
 * `presets` carries the loaded values, so the caller builds its own registry over them and
 * nothing has to be looked up by id from process state.
 */
export interface IExternalPresetLoadResult {
  presets: readonly IPreset[];
  loaded: readonly string[];
  errors: readonly { file: string; error: string }[];
}

/** One candidate preset file, however the host found it: a directory entry, an upload, a fixture. */
export interface IExternalPresetFile {
  /** The file's name, as it is reported in an error (`reviewer.json`). Only `*.json` names are read. */
  readonly fileName: string;
  /** The file's text. A throw is that file's error, so a host reads lazily and a failed read is not fatal. */
  readonly read: () => string;
}

/**
 * Load and validate every `*.json` external preset among `files`.
 *
 * A name that does not end in `.json` is skipped without an error. Each file is read, JSON-parsed and
 * validated; a read, parse or validation failure is recorded as a per-file error and skipped — the
 * remaining files still load. The surviving presets go through {@link partitionExternalPresets}, whose
 * rejections (built-in id collision or duplicate id) are folded into `errors` against their file.
 *
 * Loading REGISTERS NOTHING. The result is a value the caller owns. The package reads no file itself:
 * `loadExternalPresetsFromDir` in `@robota-sdk/agent-product/preset/node` lists a directory on a Node host.
 */
export function loadExternalPresetsFromFiles(
  files: readonly IExternalPresetFile[],
): IExternalPresetLoadResult {
  const errors: { file: string; error: string }[] = [];
  const validPresets: IPreset[] = [];
  // Track which file each validated preset id came from so registry rejections map back to a file.
  const fileById = new Map<string, string>();

  for (const file of files.filter(({ fileName }) => fileName.endsWith('.json'))) {
    const name = file.fileName;
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.read());
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
