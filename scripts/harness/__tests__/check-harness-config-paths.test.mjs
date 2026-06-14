import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findHarnessConfigPathFindings } from '../check-harness-config-paths.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-harness-config-paths-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findHarnessConfigPathFindings', () => {
  it('TC-01: a hardcoded path that exists passes', async () => {
    const root = await createFixture({
      'packages/agent-transport-tui/src/channel.ts': '// real\n',
      'scripts/harness/check-thing.mjs': [
        'const cfg = [',
        "  { file: 'packages/agent-transport-tui/src/channel.ts' },",
        '];',
      ].join('\n'),
    });

    expect(findHarnessConfigPathFindings(root)).toEqual([]);
  });

  it('TC-02: a hardcoded path that no longer exists is flagged with file/line/token', async () => {
    const root = await createFixture({
      'scripts/harness/check-thing.mjs': [
        'const cfg = [',
        "  { file: 'packages/agent-transport-tui/src/moved-away.ts' },",
        '];',
      ].join('\n'),
    });

    expect(findHarnessConfigPathFindings(root)).toEqual([
      {
        file: 'scripts/harness/check-thing.mjs',
        line: 2,
        token: 'packages/agent-transport-tui/src/moved-away.ts',
      },
    ]);
  });

  it('TC-03: comment lines and (planned) markers are exempt', async () => {
    const root = await createFixture({
      'scripts/harness/check-thing.mjs': [
        "// example: 'packages/gone/src/x.ts' in a comment is ignored",
        "const planned = 'packages/future/src/y.ts'; // (planned)",
      ].join('\n'),
    });

    expect(findHarnessConfigPathFindings(root)).toEqual([]);
  });

  it('TC-04: allow-missing marker (same line and line above) exempts a missing path', async () => {
    const root = await createFixture({
      'scripts/harness/check-thing.mjs': [
        "const a = 'packages/legacy/src/forbidden.ts'; // harness-config-path-allow-missing: negative assertion",
        '// harness-config-path-allow-missing: fixture path',
        "const b = 'packages/example/src/fixture.ts';",
      ].join('\n'),
    });

    expect(findHarnessConfigPathFindings(root)).toEqual([]);
  });
});
