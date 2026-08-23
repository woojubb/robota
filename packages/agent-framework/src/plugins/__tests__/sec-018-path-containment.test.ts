import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeFileSystem } from '../../adapters/node-file-system.js';
import {
  assertContainedPath,
  assertSafePluginSegment,
  isSafePluginSegment,
  resolveContainedRelative,
} from '../plugin-paths.js';

/**
 * SEC-018 (issue #2020) - plugin identifiers are path segments arriving from a remote manifest or a
 * file on disk, and they reached `renameSync`, `cpSync` and a recursive `rmSync` after only
 * `typeof === 'string'`.
 *
 * These assert the two properties the fix rests on: a malformed identifier is REFUSED rather than
 * sanitised, and containment is judged on the CANONICAL path so a symlink cannot redirect a mutation
 * out of a root it appears to be inside.
 */
describe('SEC-018 - an identifier that is not a safe path segment is refused', () => {
  // Each is a real escape or injection, not a stylistic complaint.
  const REJECTED: Array<[string, unknown]> = [
    ['parent traversal', '../escaped'],
    ['nested traversal', '../../escaped-market'],
    ['bare dot-dot', '..'],
    ['bare dot', '.'],
    ['posix separator', 'a/b'],
    ['windows separator', 'a\\b'],
    ['absolute posix', '/etc/passwd'],
    ['windows drive', 'C:evil'],
    ['UNC prefix', '\\\\server\\share'],
    ['NUL byte', 'name' + String.fromCharCode(0) + '.json'],
    ['percent-encoded traversal', '%2e%2e%2fescaped'],
    ['leading dot (hidden)', '.hidden'],
    ['leading hyphen (option-like)', '-rf'],
    ['empty', ''],
    ['not a string', 42],
    ['null', null],
    ['too long', 'a'.repeat(129)],
  ];

  it.each(REJECTED)('rejects %s', (_label, value) => {
    expect(isSafePluginSegment(value)).toBe(false);
    expect(() => assertSafePluginSegment(value, 'marketplace name')).toThrow(/Invalid plugin/);
  });

  it.each([
    ['plain', 'my-plugin'],
    ['dotted version', '1.2.3'],
    ['underscored', 'a_b'],
    ['digits', '2026'],
  ])('accepts a genuine identifier: %s', (_label, value) => {
    expect(isSafePluginSegment(value)).toBe(true);
  });

  it('names the field, so two untrusted sources are distinguishable', () => {
    expect(() => assertSafePluginSegment('../x', 'plugin version')).toThrow(/plugin version/);
    expect(() => assertSafePluginSegment('../x', 'marketplace name')).toThrow(/marketplace name/);
  });

  it('refuses rather than sanitises, so two identifiers cannot alias onto one directory', () => {
    // A sanitiser that stripped the traversal from `../x` would yield `x` — which is a perfectly
    // valid identifier some other plugin may already own. The hostile name and the benign one would
    // then map to ONE directory, silently cross-linking them. Rejecting keeps them distinguishable.
    expect(() => assertSafePluginSegment('../x', 'plugin name')).toThrow();
    expect(
      isSafePluginSegment('x'),
      'the sanitised form is a name someone else can legitimately hold',
    ).toBe(true);
  });
});

describe('SEC-018 - containment is judged on the canonical path', () => {
  let root: string;
  let outside: string;
  const fs = new NodeFileSystem();

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'sec-018-'));
    root = join(base, 'plugins');
    outside = join(base, 'outside');
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'victim.txt'), 'do not delete me', 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('accepts the root itself and a real descendant', () => {
    expect(() => assertContainedPath(root, root, 'test', fs)).not.toThrow();
    expect(() => assertContainedPath(root, join(root, 'a', 'b'), 'test', fs)).not.toThrow();
  });

  it('refuses a lexical escape', () => {
    expect(() => assertContainedPath(root, join(root, '..', 'outside'), 'delete', fs)).toThrow(
      /outside the plugin root/,
    );
  });

  it('refuses a SIBLING whose name merely extends the root', () => {
    // `/a/plugins-evil` starts with `/a/plugins` as a string. The separator is what makes the prefix
    // comparison a containment test rather than a string test.
    expect(() => assertContainedPath(root, `${root}-evil`, 'delete', fs)).toThrow(
      /outside the plugin root/,
    );
  });

  it('refuses a path that reaches outside THROUGH A SYMLINK inside the root', () => {
    // The case a lexical check cannot see: `resolve(root, 'link')` still starts with `root`.
    symlinkSync(outside, join(root, 'link'), 'dir');
    expect(() => assertContainedPath(root, join(root, 'link'), 'delete', fs)).toThrow(
      /outside the plugin root/,
    );
    expect(() => assertContainedPath(root, join(root, 'link', 'victim.txt'), 'delete', fs)).toThrow(
      /outside the plugin root/,
    );
  });

  it('checks a destination that does not exist yet, before it is created', () => {
    // A rename target has no realpath. Canonicalising only existing paths would leave every
    // create-then-check window open, and checking after the write is checking after the damage.
    symlinkSync(outside, join(root, 'link'), 'dir');
    expect(() =>
      assertContainedPath(root, join(root, 'link', 'not-created-yet'), 'install', fs),
    ).toThrow(/outside the plugin root/);
    expect(() =>
      assertContainedPath(root, join(root, 'fresh', 'not-created-yet'), 'install', fs),
    ).not.toThrow();
  });

  it('resolves a relative source against the root and refuses an absolute one', () => {
    expect(resolveContainedRelative(root, join('a', 'b'), 'load', fs)).toBe(join(root, 'a', 'b'));
    expect(() => resolveContainedRelative(root, outside, 'load', fs)).toThrow(/absolute path/);
    expect(() => resolveContainedRelative(root, join('..', 'outside'), 'load', fs)).toThrow(
      /outside the plugin root/,
    );
  });
});
