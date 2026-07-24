import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectMemoryMirrorFindings } from '../scan-memory-mirror.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-memory-mirror.mjs', import.meta.url));

async function createFixture(files = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-memory-mirror-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

const GREEN_INDEX = '# Memory Index\n\n- [Fact one](fact-one.md) — the first fact\n';

describe('collectMemoryMirrorFindings', () => {
  it('passes when no in-repo memory exists yet', async () => {
    const root = await createFixture();
    expect(collectMemoryMirrorFindings(root)).toEqual([]);
  });

  it('passes a consistent index + fact-file pair', async () => {
    const root = await createFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
      '.agents/memory/fact-one.md': '# Fact one\n',
    });
    expect(collectMemoryMirrorFindings(root)).toEqual([]);
  });

  it('flags a memory dir without a MEMORY.md index (RED)', async () => {
    const root = await createFixture({
      '.agents/memory/fact-one.md': '# Fact one\n',
    });

    const findings = collectMemoryMirrorFindings(root);
    expect(findings).toEqual([
      '.agents/memory/ exists but has no MEMORY.md index (every clone needs the index to find facts).',
    ]);
  });

  it('flags a dangling index link to a missing fact file (RED)', async () => {
    const root = await createFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
    });

    const findings = collectMemoryMirrorFindings(root);
    expect(findings).toEqual(['MEMORY.md links a missing memory file: fact-one.md']);
  });

  it('flags an orphan fact file the index never links (RED)', async () => {
    const root = await createFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
      '.agents/memory/fact-one.md': '# Fact one\n',
      '.agents/memory/orphan.md': '# Orphan fact\n',
    });

    const findings = collectMemoryMirrorFindings(root);
    expect(findings).toEqual([
      'memory file not indexed in MEMORY.md (orphan — invisible to other clones): orphan.md',
    ]);
  });

  it('ignores links that point outside the memory dir', async () => {
    const root = await createFixture({
      '.agents/memory/MEMORY.md':
        GREEN_INDEX + '\nSee also [rule](../rules/memory-mirroring.md).\n',
      '.agents/memory/fact-one.md': '# Fact one\n',
    });
    expect(collectMemoryMirrorFindings(root)).toEqual([]);
  });
});

describe('scan-memory-mirror CLI', () => {
  // The scan anchors its default root at `<script dir>/../..`, so the CLI is exercised by copying
  // the (unmodified) script into the fixture's scripts/harness/ and running that copy.
  async function createCliFixture(files) {
    const root = await createFixture(files);
    const scriptCopy = path.join(root, 'scripts/harness/scan-memory-mirror.mjs');
    mkdirSync(path.dirname(scriptCopy), { recursive: true });
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

  it('exits 0 with a pass message on a consistent fixture', async () => {
    const { root, scriptCopy } = await createCliFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
      '.agents/memory/fact-one.md': '# Fact one\n',
    });

    const result = runScan(scriptCopy, root);
    expect(result.stdout).toContain('memory-mirror scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings on a drifting index (RED)', async () => {
    const { root, scriptCopy } = await createCliFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
    });

    const result = runScan(scriptCopy, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('memory-mirror scan: FINDINGS');
    expect(result.stderr).toContain('MEMORY.md links a missing memory file: fact-one.md');
  });
});
