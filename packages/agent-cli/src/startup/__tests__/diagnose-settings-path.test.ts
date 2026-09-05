import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'diagnose-cwd-')));
    dirs.push(cwd);
    const resolved = withoutHome(() => resolveUserSettingsPath());
    expect(path.resolve(cwd, resolved)).not.toBe(path.join(cwd, '.robota', 'settings.json'));
  });

  it('resolves under the platform home — a NON-REGRESSION check, not a red-provable one', () => {
    // Review was right that the earlier form of this case was accidental-green: with HOME set, the
    // suffix `.robota/settings.json` is produced by the buggy expression too. It cannot be made
    // discriminating on POSIX either, because `homedir()` reads HOME there — the two implementations
    // agree by construction whenever HOME exists.
    //
    // So it is labelled for what it is: a guard that the fix did not move the normal case somewhere
    // else. The two cases above are what prove the defect, and they do it with HOME unset — which is
    // the Windows default and the only state where the two differ.
    savedHome = process.env['HOME'];
    expect(resolveUserSettingsPath()).toBe(path.join(homedir(), '.robota', 'settings.json'));
  });
});
