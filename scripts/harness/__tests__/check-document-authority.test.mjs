import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findDocumentAuthorityFindings,
  getChangedFiles,
  reportFindings,
  resolveBaseRef,
} from '../check-document-authority.mjs';

const SCRIPT = path.resolve(import.meta.dirname, '../check-document-authority.mjs');

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-document-authority-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

function git(cwd, args) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Temp git repo with a `base` branch (clean) and a work branch containing `files`. */
async function createGitFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-document-authority-git-'));
  git(root, ['init', '-q', '-b', 'base']);
  writeFileSync(path.join(root, 'README.md'), '# fixture\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'base']);
  git(root, ['checkout', '-q', '-b', 'work']);
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'work']);
  return root;
}

function runScript(cwd, args = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_BASE_REF: '', ...env },
  });
}

const VIOLATING_ARCH_DOC =
  '# Capability Placement\n\n## Implementation Plan\n\n1. Build this later.\n';

describe('findDocumentAuthorityFindings', () => {
  it('flags an architecture map containing an implementation plan section', async () => {
    const root = await createFixture({
      '.agents/specs/architecture-map/capability-placement.md': VIOLATING_ARCH_DOC,
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

  it('flags a design document owning a contract without an owner document change', async () => {
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

  it('does NOT flag package source changes (the advisory owner-spec heuristic is dropped)', async () => {
    const root = await createFixture({
      'packages/widget/src/index.ts': 'export const widget = true;\n',
    });

    const findings = await findDocumentAuthorityFindings({
      root,
      changedFiles: ['packages/widget/src/index.ts'],
    });

    expect(findings).toEqual([]);
  });
});

describe('reportFindings (blocking gate)', () => {
  it('returns exit code 1 on findings — the gate CAN fail', () => {
    const code = reportFindings([
      { file: 'x.md', type: 'architecture-doc-plan-content', detail: 'd' },
    ]);
    expect(code).toBe(1);
  });

  it('returns exit code 0 when clean', () => {
    expect(reportFindings([])).toBe(0);
  });
});

describe('base-ref resolution', () => {
  it('resolves an explicit --base-ref that exists', async () => {
    const root = await createGitFixture({});
    expect(resolveBaseRef({ argv: ['--base-ref', 'base'], env: {}, cwd: root })).toBe('base');
  });

  it('returns undefined (SKIP, not silent pass) when no candidate resolves', async () => {
    const root = await createGitFixture({});
    expect(resolveBaseRef({ argv: [], env: {}, cwd: root })).toBeUndefined();
  });

  it('lists changed files against the base ref', async () => {
    const root = await createGitFixture({ 'docs/new.md': '# new\n' });
    expect(getChangedFiles('base', { cwd: root })).toEqual(['docs/new.md']);
  });

  it('returns undefined from getChangedFiles when the diff fails', async () => {
    const root = await createGitFixture({});
    expect(getChangedFiles('no-such-ref', { cwd: root })).toBeUndefined();
  });
});

describe('end-to-end (subprocess)', () => {
  it('RED: exits 1 when the branch adds a violating architecture doc', async () => {
    const root = await createGitFixture({
      '.agents/specs/architecture-map/capability-placement.md': VIOLATING_ARCH_DOC,
    });
    const result = runScript(root, ['--base-ref', 'base']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('architecture-doc-plan-content');
  });

  it('GREEN: exits 0 when the branch changes are compliant', async () => {
    const root = await createGitFixture({ 'docs/notes.md': '# notes\n\nNothing durable.\n' });
    const result = runScript(root, ['--base-ref', 'base']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('document authority scan passed');
  });

  it('SKIP: exits 0 with an explicit SKIP log when no base ref resolves', async () => {
    const root = await createGitFixture({});
    const result = runScript(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SKIPPED: no base ref could be resolved');
  });
});
