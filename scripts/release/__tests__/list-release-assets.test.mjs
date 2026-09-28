import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, afterEach } from 'vitest';

import { matchReleaseAssets } from '../list-release-assets.mjs';

const CLI = fileURLToPath(new URL('../list-release-assets.mjs', import.meta.url));

/**
 * #3356 — `for f in $pattern` (the previous inline logic in release-desktop-app.yml, duplicated across
 * its "Assert packaged artifacts" and "Generate SHA-256 checksums" steps) glob-expands correctly but
 * then WORD-SPLITS the result, so a matched filename with a space becomes two array entries. These
 * cases exist specifically to prove `matchReleaseAssets` — and the NUL-delimited CLI stream bash reads
 * it back from — does not have that failure mode.
 */
let scratchDirs = [];

afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

function makeReleaseDir(names) {
  const cwd = mkdtempSync(join(tmpdir(), 'list-release-assets-'));
  scratchDirs.push(cwd);
  mkdirSync(join(cwd, 'release'), { recursive: true });
  for (const name of names) writeFileSync(join(cwd, 'release', name), '');
  return cwd;
}

describe('matchReleaseAssets', () => {
  it('matches every file for a multi-pattern space-separated string, across matrix legs', () => {
    const cwd = makeReleaseDir(['app.dmg', 'app.zip', 'other.txt']);
    expect(matchReleaseAssets('release/*.dmg release/*.zip', { cwd })).toEqual([
      'release/app.dmg',
      'release/app.zip',
    ]);
  });

  it('keeps a filename with a space as ONE match, not two', () => {
    const cwd = makeReleaseDir(['App 1.dmg', 'App 1.zip']);
    expect(matchReleaseAssets('release/*.dmg release/*.zip', { cwd })).toEqual([
      'release/App 1.dmg',
      'release/App 1.zip',
    ]);
  });

  it('matches the AppImage/deb leg', () => {
    const cwd = makeReleaseDir(['robota.AppImage', 'robota.deb']);
    expect(matchReleaseAssets('release/*.AppImage release/*.deb', { cwd })).toEqual([
      'release/robota.AppImage',
      'release/robota.deb',
    ]);
  });

  it('matches the Windows .exe leg', () => {
    const cwd = makeReleaseDir(['robota-desktop-3.0.0-x64.exe']);
    expect(matchReleaseAssets('release/*.exe', { cwd })).toEqual([
      'release/robota-desktop-3.0.0-x64.exe',
    ]);
  });

  it('returns an empty array — not an error — when nothing matches; callers decide what that means', () => {
    const cwd = makeReleaseDir(['app.dmg']);
    expect(matchReleaseAssets('release/*.nonexistent', { cwd })).toEqual([]);
  });

  it('dedupes a file matched by more than one pattern', () => {
    const cwd = makeReleaseDir(['app.dmg']);
    expect(matchReleaseAssets('release/*.dmg release/app.*', { cwd })).toEqual(['release/app.dmg']);
  });
});

describe('list-release-assets.mjs CLI', () => {
  it('streams a space-containing match NUL-terminated, and a NUL-aware bash reader recovers it whole', () => {
    const cwd = makeReleaseDir(['App 1.dmg']);
    const result = spawnSync(process.execPath, [CLI, 'release/*.dmg'], { cwd, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const matches = result.stdout.split('\0').filter((s) => s.length > 0);
    expect(matches).toEqual(['release/App 1.dmg']);
  });

  it('prints nothing and exits 0 when no pattern matches', () => {
    const cwd = makeReleaseDir(['app.dmg']);
    const result = spawnSync(process.execPath, [CLI, 'release/*.nonexistent'], {
      cwd,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
