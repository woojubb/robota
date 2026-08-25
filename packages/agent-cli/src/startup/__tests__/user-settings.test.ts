/**
 * Issue #2342 — an invalid settings file reaches the user as its message, not as a stack trace.
 *
 * `readSettings` has thrown `SettingsParseError` since CLI-069, and the throw escaped to the
 * top-level handler, which re-throws. So the message the typed error was written to carry — the file
 * path and the remedy — arrived wrapped in a trace, if it arrived legibly at all.
 *
 * The cases assert the BEHAVIOUR. One asserting that `readUserSettingsOrExit` is called instead of
 * `readSettings` would pass on the day this defect existed, because the call was already being made.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readUserSettingsOrExit } from '../user-settings.js';

const homes: string[] = [];

/** A HOME whose `~/.robota/settings.json` this case controls, written verbatim. */
function homeWithSettings(raw?: string): string {
  const home = mkdtempSync(join(tmpdir(), 'issue-2342-home-'));
  homes.push(home);
  mkdirSync(join(home, '.robota'), { recursive: true });
  if (raw !== undefined) writeFileSync(join(home, '.robota', 'settings.json'), raw, 'utf8');
  return home;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('readUserSettingsOrExit (issue #2342)', () => {
  it('writes the message naming the file and the remedy, then exits 1', () => {
    vi.stubEnv('HOME', homeWithSettings('{ "preset": "x"'));
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);

    expect(() => readUserSettingsOrExit()).toThrow('exited');

    expect(exit).toHaveBeenCalledWith(1);
    // The two halves of the message that make it actionable: which file, and what to do.
    expect(written.join('')).toContain('settings.json');
    expect(written.join('')).toContain('Fix or delete the file');
  });

  it('returns the settings when the file parses', () => {
    // The companion the refusal needs: without it, a function that always exited would also pass.
    vi.stubEnv('HOME', homeWithSettings(JSON.stringify({ preset: 'default' })));

    expect(readUserSettingsOrExit()).toEqual({ preset: 'default' });
  });

  it('returns empty settings when there is no file, rather than treating absence as an error', () => {
    // CLI-069's distinction, asserted here because this guard sits on top of it: a MISSING file is
    // not an error condition, and only an existing one that cannot be parsed is.
    vi.stubEnv('HOME', homeWithSettings());

    expect(readUserSettingsOrExit()).toEqual({});
  });

  it('lets an unrelated failure through instead of presenting it as a settings problem', () => {
    // Without this, a broad catch passes the first case too. `readSettings` throws a plain Error for
    // an unreadable path — a directory where the file should be — which is not a parse failure.
    const home = homeWithSettings();
    mkdirSync(join(home, '.robota', 'settings.json'), { recursive: true });
    vi.stubEnv('HOME', home);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);

    expect(() => readUserSettingsOrExit()).not.toThrow('exited');
    expect(exit).not.toHaveBeenCalled();
  });
});
