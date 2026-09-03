import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { collectFunctionalCoverageFindings, hasLiveTest } from '../check-functional-coverage.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../check-functional-coverage.mjs', import.meta.url));

const GREEN_MANIFEST = {
  markers: ['createFunctionalKit'],
  capabilities: [{ id: 'chat-basic', test: 'tests/chat-basic.functional.test.ts' }],
};

/**
 * A green functional test USES the harness and runs at least one live case. HARNESS-052 tightened
 * the rule from "the marker appears in the file" to "the marker is called, and something runs", so
 * this fixture had to become a real test file — the old one was a bare import line, which is
 * exactly the evidence the tightened rule stops accepting.
 */
const GREEN_TEST_SOURCE = `import { createFunctionalKit } from '@fixture/testing';

it('drives a real session', async () => {
  const kit = createFunctionalKit();
  await kit.run();
});
`;

async function createFixture(files) {
  const root = makeTemp('robota-functional-coverage-');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

function manifestOn(root, manifest) {
  const manifestPath = path.join(root, 'scripts/harness/functional-coverage-manifest.json');
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2),
    'utf8',
  );
  return manifestPath;
}

describe('collectFunctionalCoverageFindings', () => {
  it('passes a manifest whose tests exist and use the harness marker', async () => {
    const root = await createFixture({
      'tests/chat-basic.functional.test.ts': GREEN_TEST_SOURCE,
    });
    const manifestPath = manifestOn(root, GREEN_MANIFEST);

    const { findings, capabilityCount } = collectFunctionalCoverageFindings(root, manifestPath);
    expect(findings).toEqual([]);
    expect(capabilityCount).toBe(1);
  });

  it('flags a missing manifest (RED)', async () => {
    const root = await createFixture({});
    const { findings } = collectFunctionalCoverageFindings(
      root,
      path.join(root, 'scripts/harness/functional-coverage-manifest.json'),
    );
    expect(findings).toEqual([
      'manifest not found: scripts/harness/functional-coverage-manifest.json',
    ]);
  });

  it('flags an invalid-JSON manifest (RED)', async () => {
    const root = await createFixture({});
    const manifestPath = manifestOn(root, '{ not json');

    const { findings } = collectFunctionalCoverageFindings(root, manifestPath);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('manifest is not valid JSON:');
  });

  it('flags empty markers and empty capabilities (RED)', async () => {
    const root = await createFixture({});
    const noMarkers = manifestOn(root, { markers: [], capabilities: GREEN_MANIFEST.capabilities });
    expect(collectFunctionalCoverageFindings(root, noMarkers).findings).toEqual([
      'manifest "markers" must list at least one harness marker',
    ]);

    const noCaps = manifestOn(root, { markers: GREEN_MANIFEST.markers, capabilities: [] });
    expect(collectFunctionalCoverageFindings(root, noCaps).findings).toEqual([
      'manifest "capabilities" is empty',
    ]);
  });

  it('flags a capability whose functional test file is missing (RED)', async () => {
    const root = await createFixture({});
    const manifestPath = manifestOn(root, GREEN_MANIFEST);

    const { findings } = collectFunctionalCoverageFindings(root, manifestPath);
    expect(findings).toEqual([
      'chat-basic: functional test not found: tests/chat-basic.functional.test.ts',
    ]);
  });

  it('flags a test that never references the functional harness (RED)', async () => {
    const root = await createFixture({
      'tests/chat-basic.functional.test.ts': "import { render } from 'cli-surface-test';\n",
    });
    const manifestPath = manifestOn(root, GREEN_MANIFEST);

    const { findings } = collectFunctionalCoverageFindings(root, manifestPath);
    expect(findings).toContainEqual(
      'chat-basic: tests/chat-basic.functional.test.ts does not use the functional harness (expected a call to one of: createFunctionalKit)',
    );
  });

  /**
   * HARNESS-052 sub-shape A. The rule was `source.includes(marker)`, and this check's own docstring
   * forbids exactly what that accepts: the marker named in a comment beside a skipped case. Both
   * files below contain the marker; neither drives anything.
   */
  it('does not accept the marker mentioned only in a comment (RED)', async () => {
    const root = await createFixture({
      'tests/chat-basic.functional.test.ts':
        '// TODO: rewrite this on createFunctionalKit\ndescribe.skip("chat", () => {\n  it("works", () => {});\n});\n',
    });
    const manifestPath = manifestOn(root, GREEN_MANIFEST);

    const { findings } = collectFunctionalCoverageFindings(root, manifestPath);
    expect(findings.join('\n')).toContain('does not use the functional harness');
  });

  it('does not accept an imported-but-never-called harness (RED)', async () => {
    const root = await createFixture({
      'tests/chat-basic.functional.test.ts':
        "import { createFunctionalKit } from '@fixture/testing';\n\nit('runs', () => {});\n",
    });
    const manifestPath = manifestOn(root, GREEN_MANIFEST);

    const { findings } = collectFunctionalCoverageFindings(root, manifestPath);
    expect(findings.join('\n')).toContain('does not use the functional harness');
  });

  it('flags a file whose every case is skipped (RED)', async () => {
    const root = await createFixture({
      'tests/chat-basic.functional.test.ts':
        "import { createFunctionalKit } from '@fixture/testing';\n\n" +
        "it.skip('runs', async () => {\n  const kit = createFunctionalKit();\n  await kit.run();\n});\n",
    });
    const manifestPath = manifestOn(root, GREEN_MANIFEST);

    const { findings } = collectFunctionalCoverageFindings(root, manifestPath);
    expect(findings.join('\n')).toContain('declares no live test');
  });

  it('accepts a file that skips ONE case and runs another', async () => {
    const root = await createFixture({
      'tests/chat-basic.functional.test.ts': `${GREEN_TEST_SOURCE}\nit.skip('the flaky one', () => {});\n`,
    });
    const manifestPath = manifestOn(root, GREEN_MANIFEST);

    expect(collectFunctionalCoverageFindings(root, manifestPath).findings).toEqual([]);
  });

  it('flags duplicate capability ids and entries missing id/test (RED)', async () => {
    const root = await createFixture({
      'tests/chat-basic.functional.test.ts': GREEN_TEST_SOURCE,
    });
    const manifestPath = manifestOn(root, {
      markers: GREEN_MANIFEST.markers,
      capabilities: [
        ...GREEN_MANIFEST.capabilities,
        { id: 'chat-basic', test: 'tests/chat-basic.functional.test.ts' },
        { id: 'no-test-field' },
      ],
    });

    const { findings } = collectFunctionalCoverageFindings(root, manifestPath);
    expect(findings).toContainEqual('duplicate capability id: chat-basic');
    expect(findings).toContainEqual(
      'capability entry missing "id" or "test": {"id":"no-test-field"}',
    );
  });
});

describe('check-functional-coverage CLI', () => {
  // The scan anchors both its root and its manifest at the script's own directory, so the CLI is
  // exercised by copying the (unmodified) script into the fixture's scripts/harness/ next to a
  // fixture manifest.
  async function createCliFixture(files, manifest) {
    const root = await createFixture(files);
    manifestOn(root, manifest);
    const scriptCopy = path.join(root, 'scripts/harness/check-functional-coverage.mjs');
    copyFileSync(SCAN_SCRIPT, scriptCopy);
    // The script delegates comment blanking to the shared owner (issue #2258); a standalone copy
    // needs it beside itself.
    mkdirSync(path.join(root, 'scripts/harness/lib'), { recursive: true });
    copyFileSync(
      fileURLToPath(new URL('../lib/blank-comments.mjs', import.meta.url)),
      path.join(root, 'scripts/harness/lib/blank-comments.mjs'),
    );
    return { root, scriptCopy };
  }

  function runScan(scriptCopy, cwd) {
    try {
      const stdout = execFileSync(process.execPath, [scriptCopy], { cwd, encoding: 'utf8' });
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      return {
        status: error.status,
        stdout: `${error.stdout ?? ''}`,
        stderr: `${error.stderr ?? ''}`,
      };
    }
  }

  it('exits 0 with the capability count on a green fixture', async () => {
    const { root, scriptCopy } = await createCliFixture(
      { 'tests/chat-basic.functional.test.ts': GREEN_TEST_SOURCE },
      GREEN_MANIFEST,
    );

    const result = runScan(scriptCopy, root);
    expect(result.stdout).toContain('✓ functional-coverage (1 capability)');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings when a listed test is missing (RED)', async () => {
    const { root, scriptCopy } = await createCliFixture({}, GREEN_MANIFEST);

    const result = runScan(scriptCopy, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('✗ functional-coverage');
    expect(result.stderr).toContain(
      'chat-basic: functional test not found: tests/chat-basic.functional.test.ts',
    );
  });
});

describe('hasLiveTest — a suite skipped as a whole is not coverage', () => {
  it('counts no live test when describe.skip wraps every case', () => {
    // The check read only the modifiers attached to `it`/`test`, so a whole suite wrapped in
    // `describe.skip` counted as live coverage — the paper-coverage this check exists to catch, in
    // its most common spelling.
    expect(hasLiveTest('describe.skip("s", () => { it("a", () => {}); });')).toBe(false);
    expect(hasLiveTest('describe.todo("s", () => { it("a", () => {}); });')).toBe(false);
  });

  it('still counts a live suite beside a skipped one', () => {
    // Deliberately narrow, as the function's own contract says: a PARTIALLY skipped file is fine.
    expect(
      hasLiveTest(
        'describe.skip("s", () => { it("a", () => {}); });\ndescribe("t", () => { it("b", () => {}); });',
      ),
    ).toBe(true);
  });
});
