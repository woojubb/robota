import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectSpecResearchFindings } from '../scan-spec-research.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-spec-research.mjs', import.meta.url));

const GREEN_SPEC = `---
status: draft
---

# Spec

## Prior Art Research

Comparable products document this flow: https://example.com/docs/feature — both gate on approval.

## Design
`;

async function createFixture(files = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-spec-research-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('collectSpecResearchFindings', () => {
  it('passes a spec with a citation-backed Prior Art Research section', async () => {
    const root = await createFixture({ '.agents/spec-docs/draft/SPEC-001-a.md': GREEN_SPEC });
    expect(collectSpecResearchFindings(root)).toEqual([]);
  });

  it('passes a spec with an explicit waiver', async () => {
    const root = await createFixture({
      '.agents/spec-docs/todo/SPEC-002-b.md':
        '# Spec\n\n## Prior Art Research\n\nWaived: internal-only harness mechanism, no comparable product surface.\n',
    });
    expect(collectSpecResearchFindings(root)).toEqual([]);
  });

  it('passes a spec stating no comparable reference was found', async () => {
    const root = await createFixture({
      '.agents/spec-docs/active/SPEC-003-c.md':
        '# Spec\n\n## Research\n\nSurveyed agent-harness docs; no comparable reference found for this gate shape.\n',
    });
    expect(collectSpecResearchFindings(root)).toEqual([]);
  });

  it('flags an in-flight spec with no research section (RED)', async () => {
    const root = await createFixture({
      '.agents/spec-docs/draft/SPEC-004-d.md': '# Spec\n\n## Design\n\nStuff.\n',
    });

    const findings = collectSpecResearchFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('.agents/spec-docs/draft/SPEC-004-d.md');
    expect(findings[0]).toContain('missing "## Prior Art Research" section');
  });

  it('flags an unsubstantiated research section (RED)', async () => {
    const root = await createFixture({
      '.agents/spec-docs/active/SPEC-005-e.md':
        '# Spec\n\n## Prior Art Research\n\nTBD.\n\n## Design\n',
    });

    const findings = collectSpecResearchFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('present but not substantiated');
  });

  it('does not gate done/rejected/backlog stages', async () => {
    const root = await createFixture({
      '.agents/spec-docs/done/SPEC-006-f.md': '# Spec\n\nNo research section at all.\n',
      '.agents/spec-docs/rejected/SPEC-007-g.md': '# Spec\n\nNo research section at all.\n',
    });
    expect(collectSpecResearchFindings(root)).toEqual([]);
  });
});

describe('scan-spec-research CLI', () => {
  // The scan anchors its default root at `<script dir>/../..`, so the CLI is exercised by copying
  // the (unmodified) script into the fixture's scripts/harness/ and running that copy.
  async function createCliFixture(files) {
    const root = await createFixture(files);
    const scriptCopy = path.join(root, 'scripts/harness/scan-spec-research.mjs');
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

  it('exits 0 with a pass message on a green fixture', async () => {
    const { root, scriptCopy } = await createCliFixture({
      '.agents/spec-docs/draft/SPEC-001-a.md': GREEN_SPEC,
    });

    const result = runScan(scriptCopy, root);
    expect(result.stdout).toContain('spec-research scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings on a research-less spec (RED)', async () => {
    const { root, scriptCopy } = await createCliFixture({
      '.agents/spec-docs/draft/SPEC-004-d.md': '# Spec\n\n## Design\n\nStuff.\n',
    });

    const result = runScan(scriptCopy, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('spec-research scan: FINDINGS');
    expect(result.stderr).toContain('missing "## Prior Art Research" section');
  });
});
