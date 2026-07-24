import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findArchitectureMapCompletenessFindings } from '../check-architecture-map-completeness.mjs';

const SCAN_SCRIPT = fileURLToPath(
  new URL('../check-architecture-map-completeness.mjs', import.meta.url),
);

const GREEN_DOC = `# Package Map

Scope: how the runtime packages relate.

Up: [ARCHITECTURE-MAP.md](../ARCHITECTURE-MAP.md)

## Structure

| Package | Role |
| ------- | ---- |
| pkg-a   | core |

Owner: [pkg-a SPEC](../../../packages/pkg-a/docs/SPEC.md)
`;

async function createMapDir(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-arch-map-completeness-'));
  const mapDir = path.join(root, '.agents/specs/architecture-map');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(mapDir, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return mapDir;
}

describe('findArchitectureMapCompletenessFindings', () => {
  it('passes a doc carrying the full required spine', async () => {
    const mapDir = await createMapDir({ 'pkg-map.md': GREEN_DOC });
    const { blocking, warnings } = findArchitectureMapCompletenessFindings(mapDir, mapDir);
    expect(blocking).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('flags a doc without an H1 title (RED)', async () => {
    const mapDir = await createMapDir({
      'pkg-map.md': GREEN_DOC.replace('# Package Map\n', ''),
    });

    const { blocking } = findArchitectureMapCompletenessFindings(mapDir, mapDir);
    expect(blocking.map((f) => f.detail)).toContain('missing H1 title');
  });

  it('flags a doc without a scope line (RED)', async () => {
    const mapDir = await createMapDir({
      'pkg-map.md': GREEN_DOC.replace('Scope: how the runtime packages relate.\n\n', ''),
    });

    const { blocking } = findArchitectureMapCompletenessFindings(mapDir, mapDir);
    expect(blocking.map((f) => f.detail)).toContain(
      'missing scope line (a prose paragraph after the H1)',
    );
  });

  it('flags a doc without an up-link (RED)', async () => {
    const mapDir = await createMapDir({
      'pkg-map.md': GREEN_DOC.replace('Up: [ARCHITECTURE-MAP.md](../ARCHITECTURE-MAP.md)\n\n', ''),
    });

    const { blocking } = findArchitectureMapCompletenessFindings(mapDir, mapDir);
    expect(blocking.map((f) => f.detail)).toContain(
      'missing up-link (to ../ARCHITECTURE-MAP.md or a parent/sibling map doc)',
    );
  });

  it('flags a doc without a structure block (RED)', async () => {
    const mapDir = await createMapDir({
      'pkg-map.md': GREEN_DOC.replace(
        /\| Package \| Role \|\n\| ------- \| ---- \|\n\| pkg-a {3}\| core \|\n/,
        'No table here.\n',
      ),
    });

    const { blocking } = findArchitectureMapCompletenessFindings(mapDir, mapDir);
    expect(blocking.map((f) => f.detail)).toContain(
      'missing structure block (a table, a ```mermaid diagram, or a router link-list)',
    );
  });

  it('accepts a router doc whose structure is its link list', async () => {
    const mapDir = await createMapDir({
      'router.md':
        '# Router\n\nScope: routes to the detail maps.\n\n- [A](a-map.md)\n- [B](b-map.md)\n',
      'a-map.md': GREEN_DOC,
      'b-map.md': GREEN_DOC,
    });

    const { blocking } = findArchitectureMapCompletenessFindings(
      path.join(mapDir, 'router.md'),
      mapDir,
    );
    expect(blocking).toEqual([]);
  });

  it('warns (non-blocking) when a doc has no owner pointer', async () => {
    const mapDir = await createMapDir({
      'pkg-map.md': GREEN_DOC.replace(
        'Owner: [pkg-a SPEC](../../../packages/pkg-a/docs/SPEC.md)\n',
        '',
      ),
    });

    const { blocking, warnings } = findArchitectureMapCompletenessFindings(mapDir, mapDir);
    expect(blocking).toEqual([]);
    expect(warnings.map((f) => f.detail)).toContain(
      'no owner pointer (link to an owning SPEC / spec doc) — recommended',
    );
  });

  it('skips the exempt log/index files', async () => {
    const mapDir = await createMapDir({
      'README.md': 'Index only.\n',
      'architecture-lessons.md': 'Log only.\n',
      'layering-audit.md': 'Log only.\n',
    });

    const { blocking } = findArchitectureMapCompletenessFindings(mapDir, mapDir);
    expect(blocking).toEqual([]);
  });
});

describe('check-architecture-map-completeness CLI', () => {
  function runScan(args) {
    try {
      const stdout = execFileSync(process.execPath, [SCAN_SCRIPT, ...args], { encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}` };
    }
  }

  it('exits 0 with a pass message on a green fixture dir', async () => {
    const mapDir = await createMapDir({ 'pkg-map.md': GREEN_DOC });
    const result = runScan([mapDir]);
    expect(result.stdout).toContain('architecture-map completeness scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists blocking findings on a spine-less fixture (RED)', async () => {
    const mapDir = await createMapDir({
      'pkg-map.md': 'No H1, no scope, no links, no table.\n',
    });

    const result = runScan([mapDir]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('architecture-map completeness scan failed:');
    expect(result.stdout).toContain('[missing-spine]');
    expect(result.stdout).toContain('missing H1 title');
  });
});
