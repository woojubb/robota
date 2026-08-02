import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveUserSettingsPath } from '../diagnose-command.js';

/**
 * NEUT-009 — the command whose entire job is reporting which configuration is in effect reported the
 * wrong file.
 *
 * `diagnose` built the user settings path as
 * `join(process.env['HOME'] ?? '', '.robota', 'settings.json')`. On Windows `HOME` is normally unset,
 * so the `?? ''` made the whole thing RELATIVE — `.robota/settings.json`, resolved against the
 * current working directory. The check then reports on whatever happens to be under cwd, or on
 * nothing, and says so with the confidence of a diagnostic.
 *
 * `node:os`'s `homedir()` is the platform-correct answer and the rest of this repository already uses
 * it (`agent-framework/src/paths.ts`'s `userPaths()`); `diagnose` was the one site reading the
 * environment variable directly. That is the shape NEUT-009 is about at a larger scale: a path the
 * product rebuilds by hand instead of asking the seam that owns it.
 */
const dirs: string[] = [];

afterEach(() => {
  if (savedHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = savedHome;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let savedHome: string | undefined;

function withoutHome<T>(run: () => T): T {
  savedHome = process.env['HOME'];
  delete process.env['HOME'];
  return run();
}

describe('diagnose reports an absolute user settings path (NEUT-009)', () => {
  it('is absolute even when HOME is unset — the Windows default', () => {
    // Against the defect this is `.robota/settings.json`: a relative path, resolved against cwd.
    const resolved = withoutHome(() => resolveUserSettingsPath());
    expect(path.isAbsolute(resolved)).toBe(true);
  });

  it('does not resolve against the working directory', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'diagnose-cwd-'));
    dirs.push(cwd);
    const resolved = withoutHome(() => resolveUserSettingsPath());
    expect(path.resolve(cwd, resolved)).not.toBe(path.join(cwd, '.robota', 'settings.json'));
  });

  it('still points inside the user home when HOME is set', () => {
    savedHome = process.env['HOME'];
    expect(resolveUserSettingsPath()).toContain(path.join('.robota', 'settings.json'));
  });
});
