import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { markLatestRelease, selectLatestTag } from '../mark-latest-release.mjs';

const CLI = fileURLToPath(new URL('../mark-latest-release.mjs', import.meta.url));

const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const failed = (stderr) => ({ status: 1, stdout: '', stderr });

/** A fake `gh` that answers the Latest lookup and records every call. */
function fakeGh(lookup, edit = ok()) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    return args[0] === 'api' ? lookup : edit;
  };
  return { gh, calls, edits: () => calls.filter((args) => args[0] === 'release') };
}

describe('selectLatestTag', () => {
  it('picks the highest of several ready tags', () => {
    expect(selectLatestTag({ readyTags: ['v3.3.2', 'v3.5.0', 'v3.4.1'] })).toBe('v3.5.0');
  });

  it('marks a tag strictly higher than the current Latest', () => {
    expect(selectLatestTag({ readyTags: ['v3.5.0'], currentLatest: 'v3.4.0' })).toBe('v3.5.0');
  });

  it('leaves Latest alone when it is equal or higher', () => {
    expect(selectLatestTag({ readyTags: ['v3.4.0'], currentLatest: 'v3.4.0' })).toBeUndefined();
    expect(selectLatestTag({ readyTags: ['v3.3.2'], currentLatest: 'v3.4.0' })).toBeUndefined();
  });

  it('marks when there is no current Latest', () => {
    expect(selectLatestTag({ readyTags: ['v3.4.0'], currentLatest: undefined })).toBe('v3.4.0');
  });

  it('compares versions numerically, not as strings', () => {
    expect(selectLatestTag({ readyTags: ['v3.9.0', 'v3.10.0'] })).toBe('v3.10.0');
    expect(selectLatestTag({ readyTags: ['v3.10.0'], currentLatest: 'v3.9.0' })).toBe('v3.10.0');
    expect(selectLatestTag({ readyTags: ['v3.9.0'], currentLatest: 'v3.10.0' })).toBeUndefined();
    expect(selectLatestTag({ readyTags: ['v10.0.0'], currentLatest: 'v9.9.9' })).toBe('v10.0.0');
  });

  it('ignores the prefix before the version', () => {
    expect(selectLatestTag({ readyTags: ['v3.4.0', 'app-v3.5.0'] })).toBe('app-v3.5.0');
    expect(selectLatestTag({ readyTags: ['app-v3.4.0'], currentLatest: 'v3.4.0' })).toBeUndefined();
    expect(selectLatestTag({ readyTags: ['v3.5.0'], currentLatest: 'app-v3.4.0' })).toBe('v3.5.0');
    expect(selectLatestTag({ readyTags: ['3.5.0'], currentLatest: 'v3.4.0' })).toBe('3.5.0');
  });

  it('skips prereleases and tags without a version', () => {
    expect(selectLatestTag({ readyTags: ['v4.0.0-beta.1', 'v3.4.0'] })).toBe('v3.4.0');
    expect(selectLatestTag({ readyTags: ['v4.0.0-beta.1'] })).toBeUndefined();
    expect(selectLatestTag({ readyTags: ['nightly', 'v3.4'] })).toBeUndefined();
    expect(selectLatestTag({ readyTags: ['nightly', 'v3.4.0'] })).toBe('v3.4.0');
  });

  it('rejects unsafe tag characters before comparing anything', () => {
    for (const tag of [
      'v3.4.0; rm -rf /',
      'v3.4.0\nv9.9.9',
      '$(id)v1.0.0',
      'v3.4.0 --latest',
      '',
    ]) {
      expect(() => selectLatestTag({ readyTags: ['v3.3.0', tag] })).toThrow(/Unsafe release tag/);
    }
  });

  it('refuses to compare with a current Latest tag that carries no version', () => {
    expect(() => selectLatestTag({ readyTags: ['v3.4.0'], currentLatest: 'nightly' })).toThrow(
      /Cannot compare/,
    );
  });
});

describe('markLatestRelease', () => {
  const repo = 'owner/repo';

  it('marks the highest ready tag when it is above the current Latest', () => {
    const { gh, calls } = fakeGh(ok('v3.4.0\n'));
    const result = markLatestRelease({ tags: ['v3.5.0', 'v3.3.2'], repo, gh });
    expect(result.tag).toBe('v3.5.0');
    expect(result.message).toContain('Marked v3.5.0');
    expect(calls).toEqual([
      ['api', 'repos/owner/repo/releases/latest', '--jq', '.tag_name'],
      ['release', 'edit', 'v3.5.0', '--repo', 'owner/repo', '--latest'],
    ]);
  });

  it.each([['v3.4.0'], ['v3.3.2']])('makes no edit call for the ready tag %s', (tag) => {
    const { gh, edits } = fakeGh(ok('v3.4.0\n'));
    const result = markLatestRelease({ tags: [tag], repo, gh });
    expect(result.tag).toBeUndefined();
    expect(result.message).toContain('Latest stays v3.4.0');
    expect(edits()).toEqual([]);
  });

  it('marks when the repository has no Latest release yet (404)', () => {
    const { gh, edits } = fakeGh(failed('gh: Not Found (HTTP 404)\n'));
    expect(markLatestRelease({ tags: ['v3.4.0'], repo, gh }).tag).toBe('v3.4.0');
    expect(edits()).toEqual([['release', 'edit', 'v3.4.0', '--repo', 'owner/repo', '--latest']]);
  });

  it('fails, without editing, when the lookup fails for any other reason', () => {
    for (const lookup of [failed('gh: HTTP 500\n'), failed('network unreachable'), failed('')]) {
      const { gh, edits } = fakeGh(lookup);
      expect(() => markLatestRelease({ tags: ['v3.5.0'], repo, gh })).toThrow(
        /Could not read the current Latest/,
      );
      expect(edits()).toEqual([]);
    }
    const { gh } = fakeGh(ok('\n'));
    expect(() => markLatestRelease({ tags: ['v3.5.0'], repo, gh })).toThrow(/returned no tag/);
  });

  it('fails when marking Latest fails', () => {
    const { gh } = fakeGh(ok('v3.4.0'), failed('HTTP 403: Resource not accessible'));
    expect(() => markLatestRelease({ tags: ['v3.5.0'], repo, gh })).toThrow(/HTTP 403/);
  });

  it('never marks a prerelease or an unparseable tag', () => {
    const { gh, edits } = fakeGh(ok('v3.4.0'));
    const result = markLatestRelease({ tags: ['v4.0.0-beta.1', 'nightly'], repo, gh });
    expect(result.tag).toBeUndefined();
    expect(edits()).toEqual([]);
  });

  it('rejects an unsafe tag and an empty tag list without editing anything', () => {
    const { gh, edits } = fakeGh(ok('v3.4.0'));
    expect(() => markLatestRelease({ tags: ['v9.9.9 --repo evil/repo'], repo, gh })).toThrow(
      /Unsafe release tag/,
    );
    expect(() => markLatestRelease({ tags: [], repo, gh })).toThrow(/No verified release tags/);
    expect(edits()).toEqual([]);
  });
});

describe('mark-latest-release CLI', () => {
  it('reads the ready tags from the environment and marks Latest through gh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mark-latest-release-'));
    try {
      const log = join(dir, 'gh.log');
      writeFileSync(
        join(dir, 'gh'),
        `#!/bin/sh
echo "$@" >> "$GH_LOG"
if [ "$1" = api ]; then
  if [ -n "$FAKE_LOOKUP_ERROR" ]; then echo "$FAKE_LOOKUP_ERROR" >&2; exit 1; fi
  echo v3.4.0
fi
`,
      );
      chmodSync(join(dir, 'gh'), 0o755);
      const run = (extra) =>
        spawnSync(process.execPath, [CLI], {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${dir}${delimiter}${process.env.PATH}`,
            GH_LOG: log,
            GH_REPO: 'owner/repo',
            READY_TAGS: 'v3.3.2 v3.5.0',
            ...extra,
          },
        });

      const marked = run({});
      expect(marked.status, marked.stderr).toBe(0);
      expect(marked.stdout).toContain('Marked v3.5.0');
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
        'api repos/owner/repo/releases/latest --jq .tag_name',
        'release edit v3.5.0 --repo owner/repo --latest',
      ]);

      writeFileSync(log, '');
      const failedLookup = run({ FAKE_LOOKUP_ERROR: 'gh: HTTP 502' });
      expect(failedLookup.status).toBe(1);
      expect(failedLookup.stderr).toContain('::error::Could not read the current Latest');
      expect(readFileSync(log, 'utf8')).not.toContain('release edit');

      expect(run({ READY_TAGS: '' }).status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
