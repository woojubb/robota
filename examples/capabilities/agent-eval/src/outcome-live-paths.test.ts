import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertCredentialPath,
  assertEvidencePath,
  isInside,
  PathGuardError,
  repositoryRoots,
  resolveThroughLinks,
  temporaryRoots,
} from './outcome-live-paths.js';

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const real = { exampleDir, allowTemporary: false };
const lenient = { exampleDir, allowTemporary: true };

/** A folder outside the repository and outside the temporary directory: the home directory's child. */
const outside = join(homedir(), '.evidence-path-guard-test-never-created');

function withTemp(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'path-guard-test-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a folder inside the repository is refused, whether or not it exists yet', () => {
  const [root] = repositoryRoots(exampleDir);
  assert.ok(root !== undefined);
  for (const path of [
    join(root, 'evidence'),
    join(exampleDir, 'evidence', 'nested'),
    exampleDir,
    root,
  ]) {
    assert.throws(() => assertEvidencePath(path, 'evidence folder', lenient), PathGuardError);
    assert.throws(
      () => assertEvidencePath(path, 'evidence folder', real),
      /outside the repository/,
    );
  }
});

test('a symlink that leads into the repository cannot hide the location', () => {
  withTemp((dir) => {
    symlinkSync(exampleDir, join(dir, 'link'));
    assert.throws(
      () => assertEvidencePath(join(dir, 'link', 'later', 'evidence'), 'evidence folder', lenient),
      /outside the repository/,
    );
    assert.ok(resolveThroughLinks(join(dir, 'link', 'later')).startsWith(realpathSync(exampleDir)));
  });
});

test('the main checkout of a linked work tree counts as the repository too', () => {
  const roots = repositoryRoots(exampleDir);
  for (const root of roots) {
    assert.throws(() => assertEvidencePath(join(root, 'x'), 'evidence folder', lenient));
  }
});

test('the system temporary directory is refused for a real run in every spelling, and allowed otherwise', () => {
  withTemp((dir) => {
    const path = join(dir, 'evidence');
    assert.throws(() => assertEvidencePath(path, 'evidence folder', real), /temporary directory/);
    assert.equal(assertEvidencePath(path, 'evidence folder', lenient), path);
  });
  assert.ok(temporaryRoots().length >= 1);
  if (existsSync('/tmp')) {
    assert.throws(
      () => assertEvidencePath('/tmp/some-evidence-folder', 'evidence folder', real),
      /temporary directory/,
    );
  }
  withTemp((dir) => {
    // A symlink outside the temporary directory is not what is checked: the resolved target is.
    mkdirSync(join(dir, 'target'));
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    assert.throws(
      () => assertEvidencePath(join(dir, 'link', 'evidence'), 'evidence folder', real),
      /temporary directory/,
    );
  });
});

test('a folder outside both is accepted without being created', () => {
  const [root] = repositoryRoots(exampleDir);
  if (root !== undefined && isInside(root, outside)) return;
  assert.equal(assertEvidencePath(outside, 'evidence folder', real), resolveThroughLinks(outside));
  assert.equal(existsSync(outside), false);
});

test('an empty path is refused', () => {
  assert.throws(() => assertEvidencePath('  ', 'evidence folder', real), /empty/);
});

test('a path that merely shares a prefix with the repository is not inside it', () => {
  assert.equal(isInside('/a/b', '/a/bc'), false);
  assert.equal(isInside('/a/b', '/a/b/c'), true);
  assert.equal(isInside('/a/b', '/a/b'), true);
  assert.equal(isInside('/a/b', '/a'), false);
});

test('a credential file inside the repository is refused; one outside is accepted', () => {
  const [root] = repositoryRoots(exampleDir);
  assert.ok(root !== undefined);
  assert.throws(
    () => assertCredentialPath(join(root, 'credentials.env'), lenient),
    /credential file must be outside the repository/,
  );
  withTemp((dir) => {
    assert.equal(
      assertCredentialPath(join(dir, 'credentials.env'), lenient),
      join(dir, 'credentials.env'),
    );
  });
});

test('the guard error never repeats the path it refused', () => {
  const [root] = repositoryRoots(exampleDir);
  assert.ok(root !== undefined);
  try {
    assertEvidencePath(join(root, 'secret-looking-name'), 'evidence folder', real);
    assert.fail('expected a refusal');
  } catch (error) {
    assert.ok(!(error as Error).message.includes('secret-looking-name'));
  }
});

test(
  'a case variant of a path inside the repository is refused on a case-insensitive disk',
  { skip: process.platform !== 'darwin' },
  () => {
    const [root] = repositoryRoots(exampleDir);
    assert.ok(root !== undefined);
    for (const variant of [root.toLowerCase(), root.toUpperCase()]) {
      // Only a case-insensitive volume resolves a variant; on a case-sensitive one it does not exist.
      if (!existsSync(variant)) continue;
      assert.throws(
        () => assertEvidencePath(join(variant, 'evidence'), 'evidence folder', real),
        /outside the repository/,
      );
      assert.throws(
        () => assertCredentialPath(join(variant, 'credentials.env'), real),
        /outside the repository/,
      );
    }
  },
);

test('a name that starts with two dots is inside; a real parent step is not', () => {
  assert.equal(isInside('/a/b', '/a/b/..hidden'), true);
  assert.equal(isInside('/a/b', '/a/b/../c'), false);
});
