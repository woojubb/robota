import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findDocumentAuthorityFindings } from '../check-document-authority.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-document-authority-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('findDocumentAuthorityFindings', () => {
  it('warns when an architecture map contains an implementation plan section', async () => {
    const root = await createFixture({
      '.agents/specs/architecture-map/capability-placement.md':
        '# Capability Placement\n\n## Implementation Plan\n\n1. Build this later.\n',
    });

    const findings = await findDocumentAuthorityFindings({
      root,
      changedFiles: ['.agents/specs/architecture-map/capability-placement.md'],
    });

    expect(findings).toEqual([
      {
        file: '.agents/specs/architecture-map/capability-placement.md',
        type: 'architecture-doc-plan-content',
        detail:
          'Architecture documents own stable boundaries; move implementation plans, recommendations, and promotion paths to design/task/backlog documents.',
      },
    ]);
  });

  it('warns when a design document owns a contract without an owner document change', async () => {
    const root = await createFixture({
      'docs/plans/2026-05-09-widget-design.md':
        '# Widget Design\n\n## Public API\n\n`WidgetClient` is the accepted API.\n',
    });

    const findings = await findDocumentAuthorityFindings({
      root,
      changedFiles: ['docs/plans/2026-05-09-widget-design.md'],
    });

    expect(findings).toEqual([
      {
        file: 'docs/plans/2026-05-09-widget-design.md',
        type: 'design-contract-without-owner-doc',
        detail:
          'Design documents may explain contracts, but accepted contract authority must also appear in the owner SPEC/API/architecture document.',
      },
    ]);
  });

  it('accepts package source changes with the owner SPEC update', async () => {
    const root = await createFixture({
      'packages/widget/src/index.ts': 'export const widget = true;\n',
      'packages/widget/docs/SPEC.md': '# Widget SPEC\n',
    });

    const findings = await findDocumentAuthorityFindings({
      root,
      changedFiles: ['packages/widget/src/index.ts', 'packages/widget/docs/SPEC.md'],
    });

    expect(findings).toEqual([]);
  });
});
