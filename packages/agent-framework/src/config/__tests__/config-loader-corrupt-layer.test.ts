/**
 * CONFIG-002 (issue #2023) — a corrupt settings layer is an error, not an absence.
 *
 * `readJsonSource` returned `undefined` for a file it could not parse, and `loadConfig` skips a
 * layer whose raw value is `undefined`. So a corrupt layer never reached `SettingsSchema`: shape
 * validation is fail-closed and the JSON step beneath it was fail-open, which meant the fail-open
 * path routed around the fail-closed one INSIDE one function.
 *
 * The consequence is the reason this is filed as security rather than tidiness. `toResolvedConfig`
 * reads `merged.permissions?.deny ?? DEFAULTS.permissions.deny`, and that default is `[]` — so a
 * project settings file that carried a deny list and then got truncated came back as a config with
 * NO deny list, and nothing said so.
 *
 * Every case here drives the real `loadConfig` over real sources. Calling `readJsonSource` directly
 * would prove the reader throws and say nothing about whether the loader still swallows it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config-loader.js';
import { SettingsParseError } from '../settings-parse-error.js';
import { createNodeHostSettingsSource } from '../settings-source.js';

const roots: string[] = [];

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-config-002-')));
  roots.push(root);
  return root;
}

/** A host settings source backed by a real file, which is what the loader reads in production. */
function hostSourceWith(contents: string): ReturnType<typeof createNodeHostSettingsSource> {
  const root = tempRoot();
  mkdirSync(join(root, '.robota'), { recursive: true });
  const path = join(root, '.robota', 'settings.json');
  writeFileSync(path, contents, 'utf8');
  return createNodeHostSettingsSource('user', path);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CONFIG-002: a corrupt layer is an error, not an absence', () => {
  it('throws SettingsParseError for a layer that is not JSON', async () => {
    const source = hostSourceWith('{"permissions": {"deny": ["Bash(rm -rf');

    await expect(loadConfig([source])).rejects.toThrow(SettingsParseError);
  });

  it('names the file it could not read, so the operator can find it', async () => {
    const source = hostSourceWith('not json at all');

    await expect(loadConfig([source])).rejects.toThrow(/settings\.json/);
  });

  it('treats an EXISTING but empty file as corrupt, matching settings-io', async () => {
    // `readSettings` in the same directory reaches `JSON.parse('')` and throws, so "empty is
    // missing" was the loader disagreeing with its own neighbour about one file. A crash during
    // write is exactly how a settings file becomes empty, and that is the moment the deny list
    // matters most.
    const source = hostSourceWith('   \n');

    await expect(loadConfig([source])).rejects.toThrow(SettingsParseError);
  });

  it('leaves a genuinely MISSING file missing — absence is still absence', async () => {
    const root = tempRoot();
    const source = createNodeHostSettingsSource('user', join(root, '.robota', 'settings.json'));

    const config = await loadConfig([source]);
    expect(config.permissions.deny).toEqual([]);
  });

  it('does not lose a deny list to a corrupt sibling layer', async () => {
    // The defect stated as the user meets it: a readable layer carrying a deny rule, and a corrupt
    // one beside it. Before this, the corrupt layer vanished and the merge produced a config whose
    // deny list came from DEFAULTS — empty — with no error anywhere.
    const good = hostSourceWith('{"permissions":{"deny":["Bash(rm -rf /)"]}}');
    const corrupt = hostSourceWith('{"permissions":{"deny":[');

    await expect(loadConfig([good, corrupt])).rejects.toThrow(SettingsParseError);
  });

  it('still loads a well-formed layer, so the refusal is about corruption and not about reading', async () => {
    const source = hostSourceWith('{"permissions":{"deny":["Bash(rm -rf /)"]}}');

    const config = await loadConfig([source]);
    expect(config.permissions.deny).toEqual(['Bash(rm -rf /)']);
  });
});
