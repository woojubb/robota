// TEST-011: keep the harness self-check's hook fixture in lockstep with the hook it
// exercises. The self-check feeds FORBIDDEN_PATTERN_FIXTURE_CONTENT to
// .claude/hooks/check-forbidden-patterns.sh and requires a block (exit 2). When the
// hook's rule set changes without this fixture (HARNESS-DIET-006 removed the any-type
// branch and left the fixture stale), `pnpm harness:self-check` fails with a false
// alarm — and nothing caught it until the self-check was actually run. This test runs
// the REAL hook against the REAL fixture constant inside the globbed harness suite,
// so that drift fails CI instead of sitting silent.
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FORBIDDEN_PATTERN_FIXTURE_CONTENT, runHookFixture } from '../self-check.mjs';

describe('self-check hook fixture conformance (TEST-011)', () => {
  let projectDir;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(tmpdir(), 'robota-self-check-fixture-'));
    await fs.mkdir(path.join(projectDir, 'packages/example/src'), { recursive: true });
    await fs.mkdir(path.join(projectDir, '.agents/evals/local-metrics'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('check-forbidden-patterns still blocks the self-check fixture content (exit 2)', async () => {
    // harness-config-path-allow-missing: fixture path created under a temp projectDir
    const sourcePath = path.join(projectDir, 'packages/example/src/provider.ts');
    await fs.writeFile(sourcePath, '');

    const result = runHookFixture(
      '.claude/hooks/check-forbidden-patterns.sh',
      {
        session_id: 'self-check-fixture-test',
        tool_input: {
          file_path: sourcePath,
          content: FORBIDDEN_PATTERN_FIXTURE_CONTENT,
        },
      },
      projectDir,
    );

    // Exit 2 is the hook's hard-block contract; the self-check's runHookFixtureSelfCheck
    // requires exactly this. Exit 0 here means the fixture content no longer matches any
    // rule the hook enforces — update FORBIDDEN_PATTERN_FIXTURE_CONTENT alongside the hook.
    expect(result.status).toBe(2);
  });

  it('the blocked fixture writes exactly one lesson-metrics block entry', async () => {
    // harness-config-path-allow-missing: fixture path created under a temp projectDir
    const sourcePath = path.join(projectDir, 'packages/example/src/provider.ts');
    await fs.writeFile(sourcePath, '');

    runHookFixture(
      '.claude/hooks/check-forbidden-patterns.sh',
      {
        session_id: 'self-check-fixture-test',
        tool_input: {
          file_path: sourcePath,
          content: FORBIDDEN_PATTERN_FIXTURE_CONTENT,
        },
      },
      projectDir,
    );

    // The self-check asserts blocks.length === 1 downstream; a fixture that trips the
    // hook more (or less) than once breaks that expectation too.
    const blocksPath = path.join(projectDir, '.agents/evals/local-metrics/blocks.jsonl');
    const content = await fs.readFile(blocksPath, 'utf8');
    const entries = content.trim().split(/\r?\n/).filter(Boolean);
    expect(entries).toHaveLength(1);
  });
});
