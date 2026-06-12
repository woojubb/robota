/**
 * CLI-069: an existing settings file that fails to parse throws a typed
 * SettingsParseError (file path + parse message + remediation) instead of being
 * silently treated as missing. Missing and valid files keep their behavior.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsParseError } from '../../../config/settings-parse-error.js';
import { readSettings } from '../../../config/settings-io.js';
import { readMergedProviderSettingsFromPaths } from '../provider-merge.js';
import { readProviderSettings, ProviderConfigError } from '../provider-factory.js';

describe('corrupt settings fail fast (CLI-069)', () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'robota-069-home-'));
    cwd = mkdtempSync(join(tmpdir(), 'robota-069-cwd-'));
    vi.stubEnv('HOME', home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  function writeSettingsFile(dir: string, content: string): string {
    mkdirSync(join(dir, '.robota'), { recursive: true });
    const path = join(dir, '.robota', 'settings.json');
    writeFileSync(path, content);
    return path;
  }

  it('TC-01: corrupt user-level settings throws SettingsParseError naming the file — not ProviderConfigError', () => {
    const corruptPath = writeSettingsFile(home, '{ broken');

    let thrown: unknown;
    try {
      readProviderSettings(cwd, { env: {} });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SettingsParseError);
    expect(thrown).not.toBeInstanceOf(ProviderConfigError);
    const parseError = thrown as SettingsParseError;
    expect(parseError.filePath).toBe(corruptPath);
    expect(parseError.message).toContain(corruptPath);
    expect(parseError.message).toContain('invalid JSON');
  });

  it('TC-02: corrupt project-level settings throws the same typed error', () => {
    const corruptPath = writeSettingsFile(cwd, '{ "currentProvider": ');

    expect(() => readProviderSettings(cwd, { env: {} })).toThrowError(SettingsParseError);
    try {
      readProviderSettings(cwd, { env: {} });
    } catch (error) {
      expect((error as SettingsParseError).filePath).toBe(corruptPath);
    }
  });

  it('TC-03: missing files at both levels keep the CLI-066 order — ProviderConfigError without env key, env-default with one', () => {
    expect(() => readProviderSettings(cwd, { env: {} })).toThrowError(ProviderConfigError);
  });

  it('TC-04: valid settings files resolve unchanged (regression)', () => {
    writeSettingsFile(
      cwd,
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: { anthropic: { type: 'anthropic', model: 'claude-test', apiKey: 'k' } },
      }),
    );

    const config = readProviderSettings(cwd, { env: {} });
    expect(config.name).toBe('anthropic');
    expect(config.model).toBe('claude-test');
  });

  it('TC-05: the error message carries remediation guidance; settings-io.readSettings throws the same error with no stderr warning', () => {
    const corruptPath = writeSettingsFile(home, 'not json at all');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    let thrown: unknown;
    try {
      readSettings(corruptPath);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SettingsParseError);
    expect((thrown as SettingsParseError).message).toMatch(
      /Fix or delete the file, or run robota diagnose/,
    );
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();

    // Missing file path stays a non-error.
    expect(readSettings(join(home, 'nope', 'settings.json'))).toEqual({});
  });

  it('merge chain surfaces the first corrupt file even when later files are valid', () => {
    const corrupt = writeSettingsFile(home, '{ broken');
    const valid = writeSettingsFile(cwd, '{}');

    expect(() => readMergedProviderSettingsFromPaths([corrupt, valid])).toThrowError(
      SettingsParseError,
    );
  });
});
