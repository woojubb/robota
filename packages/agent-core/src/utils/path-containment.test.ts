import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isPathInside, resolveTrustedExecutionRoot } from './path-containment.js';

let fixtureRoot: string;
let executionRoot: string;

beforeAll(() => {
  fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'arch010-trusted-root-')));
  executionRoot = join(fixtureRoot, 'project');
  mkdirSync(executionRoot);
  writeFileSync(join(fixtureRoot, 'not-a-directory'), 'x');
  symlinkSync(executionRoot, join(fixtureRoot, 'project-link'), 'dir');
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('resolveTrustedExecutionRoot', () => {
  it('returns the canonical real path for an existing absolute directory', () => {
    expect(resolveTrustedExecutionRoot(join(fixtureRoot, 'project-link'))).toBe(
      realpathSync(executionRoot),
    );
  });

  it('refuses invalid roots with diagnostics that name the violated invariant', () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [undefined, 'string'],
      ['', 'non-empty'],
      ['relative/project', 'absolute'],
      [join(fixtureRoot, 'missing'), 'existing'],
      [join(fixtureRoot, 'not-a-directory'), 'directory'],
    ];

    for (const [input, expected] of cases) {
      expect(() => resolveTrustedExecutionRoot(input)).toThrow(expected);
    }
  });
});

it('recognizes a file under a filesystem root as inside that root', () => {
  expect(isPathInside(parse(fixtureRoot).root, join(fixtureRoot, 'not-a-directory'))).toBe(true);
});
