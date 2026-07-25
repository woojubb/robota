import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectFunctionalCoverageFindings } from '../check-functional-coverage.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../check-functional-coverage.mjs', import.meta.url));

const GREEN_MANIFEST = {
  markers: ['createFunctionalKit'],
  capabilities: [{ id: 'chat-basic', test: 'tests/chat-basic.functional.test.ts' }],
};

const GREEN_TEST_SOURCE = "import { createFunctionalKit } from '@fixture/testing';\n";

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-functional-coverage-'));
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
    expect(findings).toEqual([
      'chat-basic: tests/chat-basic.functional.test.ts does not use the functional harness (expected one of: createFunctionalKit)',
    ]);
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
