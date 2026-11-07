import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadExternalPresetsFromFiles } from './load-external-presets.js';

import type { IExternalPresetLoadResult } from './load-external-presets.js';

/**
 * Load and validate every `*.json` external preset from `dir` on the Node host's file system.
 *
 * A missing directory yields an empty result (no error). Every other rule — per-file errors, the
 * built-in id collision, duplicate ids, registering nothing — is that of
 * {@link loadExternalPresetsFromFiles}, which this lists the directory for.
 */
export function loadExternalPresetsFromDir(dir: string): IExternalPresetLoadResult {
  if (!existsSync(dir)) {
    return { presets: [], loaded: [], errors: [] };
  }
  return loadExternalPresetsFromFiles(
    readdirSync(dir).map((fileName) => ({
      fileName,
      read: () => readFileSync(join(dir, fileName), 'utf8'),
    })),
  );
}
