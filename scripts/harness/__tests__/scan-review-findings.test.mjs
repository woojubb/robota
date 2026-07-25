import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectReviewFindingsFindings } from '../scan-review-findings.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-review-findings.mjs', import.meta.url));

const REVIEWER_PATH = '.claude/agents/pr-review-reviewer.md';
const ORCH_PATH = '.agents/skills/pr-review-orchestration/SKILL.md';

const GREEN_REVIEWER = `---
name: pr-review-reviewer
---

End every report with the machine line \`ACTIONABLE FINDINGS: <n>\`.
`;

const GREEN_ORCH = `# PR Review Orchestration

Merge gate: no unresolved MUST findings (per git-branch.md, no silent deferral).
The agent never merges \`main\` — do NOT merge main.
After merging to develop, dispatch merge-verifier and require MERGE VERIFIED.
`;

async function createFixture(overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-review-findings-'));
  const files = {
    [REVIEWER_PATH]: GREEN_REVIEWER,
    [ORCH_PATH]: GREEN_ORCH,
    ...overrides,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    if (content === null) continue;
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('collectReviewFindingsFindings', () => {
  it('passes when both pipeline contracts are declared', async () => {
    const root = await createFixture();
    expect(collectReviewFindingsFindings(root)).toEqual([]);
  });

  it('flags a missing reviewer agent file (RED)', async () => {
    const root = await createFixture();
    rmSync(path.join(root, REVIEWER_PATH));

    const findings = collectReviewFindingsFindings(root);
    expect(findings).toContainEqual(`pr-review-reviewer: file missing (${REVIEWER_PATH})`);
  });

  it('flags a reviewer that dropped the ACTIONABLE FINDINGS contract (RED)', async () => {
    const root = await createFixture({
      [REVIEWER_PATH]: '---\nname: pr-review-reviewer\n---\n\nJust review the code.\n',
    });

    const findings = collectReviewFindingsFindings(root);
    expect(findings).toEqual([
      'pr-review-reviewer: no longer declares the `ACTIONABLE FINDINGS: <n>` output contract (the orchestrator routes on it).',
    ]);
  });

  it('flags an orchestrator that dropped the unresolved-MUST merge gate (RED)', async () => {
    const root = await createFixture({
      [ORCH_PATH]: GREEN_ORCH.replace('no unresolved MUST findings', 'merge when it looks fine'),
    });

    const findings = collectReviewFindingsFindings(root);
    expect(findings).toEqual([
      'pr-review-orchestration: merge gate no longer references the "no unresolved MUST" Pre-Merge rule.',
    ]);
  });

  it('flags an orchestrator that dropped the never-merge-main rule (RED)', async () => {
    const root = await createFixture({
      [ORCH_PATH]: GREEN_ORCH.replace('The agent never merges `main` — do NOT merge main.', ''),
    });

    const findings = collectReviewFindingsFindings(root);
    expect(findings).toEqual([
      'pr-review-orchestration: no longer states the agent never merges `main`.',
    ]);
  });

  it('flags an orchestrator that dropped the merge-verifier post-check (RED)', async () => {
    const root = await createFixture({
      [ORCH_PATH]: GREEN_ORCH.replace(
        'After merging to develop, dispatch merge-verifier and require MERGE VERIFIED.',
        'After merging to develop, celebrate.',
      ),
    });

    const findings = collectReviewFindingsFindings(root);
    expect(findings).toEqual([
      'pr-review-orchestration: no longer requires the `merge-verifier` post-merge check on develop.',
    ]);
  });

  it('flags an orchestrator that dropped the git-branch.md anchor (RED)', async () => {
    const root = await createFixture({
      [ORCH_PATH]: GREEN_ORCH.replace('per git-branch.md, no silent deferral', 'per convention'),
    });

    const findings = collectReviewFindingsFindings(root);
    expect(findings).toEqual([
      'pr-review-orchestration: no longer anchors the merge gate to git-branch.md (silent-deferral risk).',
    ]);
  });
});

describe('scan-review-findings CLI', () => {
  // The scan anchors its default root at `<script dir>/../..`, so the CLI is exercised by copying
  // the (unmodified) script into the fixture's scripts/harness/ and running that copy.
  async function createCliFixture(overrides = {}) {
    const root = await createFixture(overrides);
    const scriptCopy = path.join(root, 'scripts/harness/scan-review-findings.mjs');
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
    const { root, scriptCopy } = await createCliFixture();
    const result = runScan(scriptCopy, root);
    expect(result.stdout).toContain('review-findings scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings when a contract is dropped (RED)', async () => {
    const { root, scriptCopy } = await createCliFixture({
      [REVIEWER_PATH]: '---\nname: pr-review-reviewer\n---\n\nJust review the code.\n',
    });

    const result = runScan(scriptCopy, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('review-findings scan: FINDINGS');
    expect(result.stderr).toContain('ACTIONABLE FINDINGS');
  });
});
