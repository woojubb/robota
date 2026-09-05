import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadExternalPresetsFromDir } from '../load-external-presets.js';
import { validateExternalPreset } from '../preset-validation.js';
import { createPresetRegistry } from '../resolve-preset.js';

import type { IExternalPresetLoadResult } from '../load-external-presets.js';

/**
 * ARCH-009: a load registers nothing, so what a load makes visible is asked of a registry built over
 * what it RETURNED. These cases used to read the module-global `listPresets()`, which is why they
 * needed a clear before and after each one; a value nobody shares needs neither.
 */
function listAfter(result: IExternalPresetLoadResult): readonly string[] {
  return createPresetRegistry(result.presets)
    .listPresets()
    .map((preset) => preset.id);
}

/** The ids a registry holds when no external preset reaches it. */
const BUILT_IN_IDS = createPresetRegistry()
  .listPresets()
  .map((preset) => preset.id);

/** Create a fresh unique temp directory for a single test case. */
function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'robota-presets-')));
}

/** Write a JSON preset file into `dir` and return nothing. */
function writePreset(dir: string, fileName: string, value: unknown): void {
  writeFileSync(join(dir, fileName), JSON.stringify(value), 'utf8');
}

describe('loadExternalPresetsFromDir', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('TC-01: loads a valid external preset and includes it in listPresets()', () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    writePreset(dir, 'my-style.json', {
      id: 'my-style',
      title: 'My Style',
      description: 'A personal style preset.',
      persona: 'Be concise and proactive.',
    });

    const result = loadExternalPresetsFromDir(dir);

    expect(result.loaded).toContain('my-style');
    expect(result.errors).toEqual([]);
    expect(listAfter(result)).toContain('my-style');
  });

  it('TC-02: skips a schema-violating preset, loads the valid one, and reports the error', () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    writePreset(dir, 'good.json', {
      id: 'good-style',
      title: 'Good Style',
      description: 'A valid preset.',
    });
    // Missing required `title` plus a bogus effort — must be rejected.
    writePreset(dir, 'bad.json', {
      id: 'bad-style',
      description: 'Invalid preset.',
      effort: 'bogus',
    });

    const result = loadExternalPresetsFromDir(dir);

    expect(result.loaded).toContain('good-style');
    expect(result.loaded).not.toContain('bad-style');
    expect(result.errors.some((entry) => entry.file === 'bad.json')).toBe(true);
    expect(listAfter(result)).toContain('good-style');
    expect(listAfter(result)).not.toContain('bad-style');
  });

  it('TC-03: rejects an external preset whose id collides with a built-in', () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    writePreset(dir, 'default.json', {
      id: 'default',
      title: 'Hijacked Default',
      description: 'Attempts to override the built-in default.',
      persona: 'Should never apply.',
    });

    const result = loadExternalPresetsFromDir(dir);

    expect(result.loaded).not.toContain('default');
    expect(result.errors.some((entry) => entry.error === 'collides with built-in preset')).toBe(
      true,
    );
    // The built-in default survives and remains the only `default` entry.
    const defaults = createPresetRegistry(result.presets)
      .listPresets()
      .filter((preset) => preset.id === 'default');
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.title).toBe('Default');
  });

  it('TC-04: a non-existent directory returns empty and adds nothing to a registry', () => {
    const missingDir = join(makeTempDir(), 'does-not-exist');

    const result = loadExternalPresetsFromDir(missingDir);

    expect(result.loaded).toEqual([]);
    expect(result.presets).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(listAfter(result)).toEqual(BUILT_IN_IDS);
  });

  it('TC-04: an empty directory returns empty loaded and only the built-ins remain', () => {
    const dir = makeTempDir();
    tempDirs.push(dir);

    const result = loadExternalPresetsFromDir(dir);

    expect(result.loaded).toEqual([]);
    expect(listAfter(result)).toEqual(BUILT_IN_IDS);
  });

  it('directory creation helper does not interfere with nested dir reads', () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    mkdirSync(join(dir, 'nested'));
    writePreset(dir, 'top.json', {
      id: 'top-style',
      title: 'Top',
      description: 'Top-level preset only.',
    });

    const result = loadExternalPresetsFromDir(dir);

    expect(result.loaded).toEqual(['top-style']);
  });
});

describe('validateExternalPreset', () => {
  it('rejects a preset with a bogus effort value', () => {
    const result = validateExternalPreset({
      id: 'x',
      title: 'X',
      description: 'd',
      effort: 'bogus',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/^effort: /);
    }
  });

  it('accepts a minimal valid preset', () => {
    const result = validateExternalPreset({ id: 'min', title: 'Min', description: 'minimal' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preset.id).toBe('min');
      expect(result.preset.title).toBe('Min');
      expect(result.preset.description).toBe('minimal');
    }
  });

  it('rejects a missing required field', () => {
    const result = validateExternalPreset({ id: 'x', description: 'no title' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/^title: /);
    }
  });

  it('drops `defaultTrustLevel`, which the preset contract no longer carries (ARCH-040)', () => {
    // Removed by owner decision, and the reason is stronger than "nothing read it": a preset already
    // states its posture three ways — `permissionMode`, `defaultPermissionMode` and `autonomy`, the
    // last two of which `resolvePreset` PROMOTES into the first. A fourth spelling would be a second
    // answer to one question, which is exactly what the projection scan calls `derivationOnly`.
    //
    // The trust axis itself is untouched: `config.defaultTrustLevel` still reaches the session and
    // still maps to a permission mode. What is gone is the preset's own copy of it.
    const result = validateExternalPreset({
      id: 'x',
      title: 'X',
      description: 'd',
      defaultTrustLevel: 'full',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('defaultTrustLevel' in result.preset).toBe(false);
    }
  });

  it('drops unrecognised keys from the built preset', () => {
    const result = validateExternalPreset({
      id: 'x',
      title: 'X',
      description: 'd',
      unknownKey: 'ignored',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('unknownKey' in result.preset).toBe(false);
    }
  });
});
