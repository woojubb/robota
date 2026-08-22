import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findDocumentAuthorityFindings,
  getChangedFiles,
  readDocumentsExamined,
  reportFindings,
  resolveBaseRef,
} from '../check-document-authority.mjs';

const SCRIPT = path.resolve(import.meta.dirname, '../check-document-authority.mjs');

async function createFixture(files) {
  const root = makeTemp('robota-document-authority-');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

/**
 * Environment for git subprocesses in fixtures, with every inherited GIT_* variable stripped.
 * CRITICAL: when this suite runs inside a git hook (husky pre-push runs harness checks), the hook
 * exports GIT_DIR/GIT_INDEX_FILE etc., which REDIRECT any child `git` call to the REAL repository
 * regardless of cwd — a fixture `git init`/`add`/`commit`/`checkout` would then mutate the actual
 * checkout (this happened once: rogue `base`/`work` fixture commits landed on a live branch).
 */
function gitSafeEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  return { ...env, ...extra };
}

function git(cwd, args) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: gitSafeEnv(),
  });
}

/** Temp git repo with a `base` branch (clean) and a work branch containing `files`. */
async function createGitFixture(files) {
  const root = makeTemp('robota-document-authority-git-');
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
    env: gitSafeEnv({ GITHUB_BASE_REF: '', ...env }),
  });
}

// The in-process resolveBaseRef/getChangedFiles tests spawn git via the scan's own tryGit, which
// inherits process.env. Scrub GIT_* for this file (vitest isolates env per test file) so a git-hook
// context (husky pre-push exports GIT_DIR) cannot redirect fixture lookups to the real repository.
const SAVED_GIT_ENV = {};
beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GIT_')) {
      SAVED_GIT_ENV[key] = process.env[key];
      delete process.env[key];
    }
  }
});
afterAll(() => {
  Object.assign(process.env, SAVED_GIT_ENV);
});

const VIOLATING_ARCH_DOC =
  '# Capability Placement\n\n## Implementation Plan\n\n1. Build this later.\n';

describe('findDocumentAuthorityFindings', () => {
  // RULE-013: two classification changes to a BLOCKING gate, each pinned so it cannot regress.
  const DESIGN_DOC_WITH_CONTRACT = ['# Renderer', '', '## Public API', '', '`render()`', ''].join(
    '\n',
  );

  it('classifies a package design document as a design doc, including nested packages', async () => {
    // Before RULE-013 this location was invisible to this gate, so the placement criterion the
    // skill states was not in force anywhere a machine could see.
    const root = await createFixture({
      'packages/dag-nodes/tool/docs/design/renderer.md': DESIGN_DOC_WITH_CONTRACT,
    });

    const findings = await findDocumentAuthorityFindings({
      root,
      changedFiles: ['packages/dag-nodes/tool/docs/design/renderer.md'],
    });

    expect(findings.map((finding) => finding.file)).toContain(
      'packages/dag-nodes/tool/docs/design/renderer.md',
    );
  });

  it('does not classify an ADR as a design document', async () => {
    // `.design/decisions/` is the ADR location the taxonomy declares and RULE-010's gate owns.
    // Worse than a mislabel: the escape hatch derives from a packages|apps scope that a
    // `.design/**` path cannot produce, so a finding here could not be cleared by any change.
    const root = await createFixture({
      '.design/decisions/ADR-002-auth-credits-package-boundaries.md': DESIGN_DOC_WITH_CONTRACT,
    });

    const findings = await findDocumentAuthorityFindings({
      root,
      changedFiles: ['.design/decisions/ADR-002-auth-credits-package-boundaries.md'],
    });

    expect(findings).toEqual([]);
  });

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

  it('prefers HARNESS_BASE_REF over the GitHub PR target', async () => {
    const root = await createGitFixture({});
    expect(
      resolveBaseRef({
        argv: [],
        env: { HARNESS_BASE_REF: 'base', GITHUB_BASE_REF: 'main' },
        cwd: root,
      }),
    ).toBe('base');
  });

  it('returns undefined when no candidate resolves (the caller must FAIL, not pass)', async () => {
    const root = await createGitFixture({});
    expect(resolveBaseRef({ argv: [], env: {}, cwd: root })).toBeUndefined();
  });

  // INFRA-048-B: the removed `git fetch --depth=50` fallback was itself a graft (INFRA-050). A
  // fixture repo has no `origin`, so a fetch attempt would be visible as a mutated ref store.
  it('performs NO fetch while resolving — a depth fetch grafts the history it was meant to supply', async () => {
    const root = await createGitFixture({});
    execFileSync('git', ['remote', 'add', 'origin', path.join(root, 'nonexistent-remote')], {
      cwd: root,
      env: gitSafeEnv(),
    });
    expect(resolveBaseRef({ argv: [], env: { GITHUB_BASE_REF: 'develop' }, cwd: root })).toBe(
      undefined,
    );
    const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: root,
      encoding: 'utf8',
      env: gitSafeEnv(),
    });
    expect(shallow.stdout.trim()).toBe('false');
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

  // INFRA-048-B — fail closed. Before this, an unresolvable base printed `SKIPPED … Not a pass`
  // and exited 0, so `run-all-scans` (a REQUIRED CI gate) recorded a pass for a gate that never
  // ran. The fixture deliberately carries a REAL violation: the point is not "a code path was
  // taken", it is "a tree with a finding in it reported success".
  it('FAIL-CLOSED: exits 1 when no base ref resolves, even though the tree violates', async () => {
    const root = await createGitFixture({
      '.agents/specs/architecture-map/capability-placement.md': VIOLATING_ARCH_DOC,
    });
    const result = runScript(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAILED: no base ref could be resolved');
  });

  it('FAIL-CLOSED: exits 1 when the base ref is named but the diff cannot run', async () => {
    const root = await createGitFixture({
      '.agents/specs/architecture-map/capability-placement.md': VIOLATING_ARCH_DOC,
    });
    const result = runScript(root, ['--base-ref', 'origin/never-fetched']);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAILED: (no base ref could be resolved|git diff against)/);
  });
});

describe('the declared size is the subject, not the input (HARNESS-057)', () => {
  it('counts the documents the walk read, not every path in the diff', async () => {
    // The first attempt declared `changedFiles.length` — every diffed path, while this scan examines
    // only the markdown among them that still exists on disk. Review caught it: a fifteen-file diff
    // carrying one document declared fifteen. A number larger than the subject, taken from the input
    // rather than from the walk, is precisely the defect the `::examined::` line exists to expose,
    // committed by the change that introduced the line.
    const root = await createFixture({
      'docs/a.md': '# A\n',
      'docs/b.mdx': '# B\n',
      'src/index.ts': 'export const x = 1;\n',
      'package.json': '{}\n',
    });

    const changedFiles = ['docs/a.md', 'docs/b.mdx', 'src/index.ts', 'package.json'];
    await findDocumentAuthorityFindings({ root, changedFiles });

    const declared = readDocumentsExamined();
    expect(declared, `declared ${declared} over ${changedFiles.length} changed paths`).toBe(2);
  });

  it('reports zero when the diff carries no document, and does not carry a previous count', async () => {
    // The holder is RESET at the top of the walk. Without that, a run that read nothing reports the
    // last run's number — a pass over nothing wearing a healthy count, which is the exact state this
    // invariant was written to make impossible.
    const root = await createFixture({ 'src/index.ts': 'export const x = 1;\n' });

    await findDocumentAuthorityFindings({ root, changedFiles: ['src/index.ts'] });

    expect(readDocumentsExamined()).toBe(0);
  });
});
