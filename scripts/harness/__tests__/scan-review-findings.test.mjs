import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { collectReviewFindingsFindings, readExamined } from '../scan-review-findings.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-review-findings.mjs', import.meta.url));

const REVIEWER_PATH = '.claude/agents/pr-review-reviewer.md';
const ORCH_PATH = '.agents/skills/pr-finding-resolution-loop/SKILL.md';
const VERIFIER_PATH = '.claude/agents/merge-verifier.md';

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

const GREEN_VERIFIER = `# Merge Verifier

Read the exact merged PR head with \`gh pr view <n> --json headRefOid\`.
The canonical CI verdict is \`gh pr checks <n> --required\` for the exact merged PR head.
Any current required fail,
cancel, or pending result blocks PASS.
A query failure or indeterminate required-check set fails closed.
Unfiltered checks and historical attempts are diagnostic only and must not affect the verdict.
Acknowledgement is consumed only through the required \`review-gate\`;
it is never a blanket bypass.
`;

async function createFixture(overrides = {}) {
  const root = makeTemp('robota-review-findings-');
  const files = {
    [REVIEWER_PATH]: GREEN_REVIEWER,
    [ORCH_PATH]: GREEN_ORCH,
    [VERIFIER_PATH]: GREEN_VERIFIER,
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

  it('reports exactly the artifacts it read, and the same number on a second walk (#2325)', async () => {
    // Three files are read; several assertions run against each. The population is the files, not
    // the assertions — 3, not 9 — and a second walk must report 3 again, not 6: the count is reset
    // at the walk boundary rather than accumulated across calls.
    const root = await createFixture();
    collectReviewFindingsFindings(root);
    expect(readExamined()).toBe(3);
    collectReviewFindingsFindings(root);
    expect(readExamined()).toBe(3);
  });

  it('counts a missing artifact as unread, and forgets the previous walk (#2325)', async () => {
    const full = await createFixture();
    collectReviewFindingsFindings(full);
    expect(readExamined()).toBe(3);

    const root = await createFixture({ [VERIFIER_PATH]: null });
    collectReviewFindingsFindings(root);
    expect(readExamined()).toBe(2);
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
      'pr-finding-resolution-loop: merge gate no longer references the "no unresolved MUST" Pre-Merge rule.',
    ]);
  });

  it('flags an orchestrator that dropped the never-merge-main rule (RED)', async () => {
    const root = await createFixture({
      [ORCH_PATH]: GREEN_ORCH.replace('The agent never merges `main` — do NOT merge main.', ''),
    });

    const findings = collectReviewFindingsFindings(root);
    expect(findings).toEqual([
      'pr-finding-resolution-loop: no longer states the agent never merges `main`.',
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
      'pr-finding-resolution-loop: no longer requires the `merge-verifier` post-merge check on develop.',
    ]);
  });

  it('flags an orchestrator that dropped the git-branch.md anchor (RED)', async () => {
    const root = await createFixture({
      [ORCH_PATH]: GREEN_ORCH.replace('per git-branch.md, no silent deferral', 'per convention'),
    });

    const findings = collectReviewFindingsFindings(root);
    expect(findings).toEqual([
      'pr-finding-resolution-loop: no longer anchors the merge gate to git-branch.md (silent-deferral risk).',
    ]);
  });

  it('flags a missing merge-verifier agent file (RED)', async () => {
    const root = await createFixture({ [VERIFIER_PATH]: null });

    const findings = collectReviewFindingsFindings(root);
    expect(findings).toContainEqual(`merge-verifier: file missing (${VERIFIER_PATH})`);
  });

  it('flags a verifier that dropped the required-check projection (RED)', async () => {
    const root = await createFixture({
      [VERIFIER_PATH]: GREEN_VERIFIER.replace(' --required', ''),
    });

    expect(collectReviewFindingsFindings(root)).toContainEqual(
      'merge-verifier: no longer uses the current required-check projection for the CI verdict.',
    );
  });

  it('flags a verifier that no longer reads the exact PR head (RED)', async () => {
    const root = await createFixture({
      [VERIFIER_PATH]: GREEN_VERIFIER.replace(
        'Read the exact merged PR head with `gh pr view <n> --json headRefOid`.',
        'Read the pull request.',
      ),
    });

    expect(collectReviewFindingsFindings(root)).toContainEqual(
      'merge-verifier: no longer reads the exact merged PR head before judging checks.',
    );
  });

  it('flags a verifier that permits a current required non-success state (RED)', async () => {
    const root = await createFixture({
      [VERIFIER_PATH]: GREEN_VERIFIER.replace(
        'Any current required fail,\ncancel, or pending result blocks PASS.',
        'Inspect the current checks.',
      ),
    });

    expect(collectReviewFindingsFindings(root)).toContainEqual(
      'merge-verifier: no longer blocks every current required fail, cancel, or pending result.',
    );
  });

  it('flags a verifier that does not fail closed on an indeterminate query (RED)', async () => {
    const root = await createFixture({
      [VERIFIER_PATH]: GREEN_VERIFIER.replace(
        'A query failure or indeterminate required-check set fails closed.',
        'If the query is unclear, continue.',
      ),
    });

    expect(collectReviewFindingsFindings(root)).toContainEqual(
      'merge-verifier: no longer fails closed on query failure or an indeterminate required-check set.',
    );
  });

  it('flags a verifier that lets raw or historical checks decide the verdict (RED)', async () => {
    const root = await createFixture({
      [VERIFIER_PATH]: GREEN_VERIFIER.replace(
        'Unfiltered checks and historical attempts are diagnostic only and must not affect the verdict.',
        'Unfiltered checks and historical attempts decide the verdict.',
      ),
    });

    expect(collectReviewFindingsFindings(root)).toContainEqual(
      'merge-verifier: no longer limits unfiltered and historical checks to non-verdict diagnostics.',
    );
  });

  it('flags a verifier that treats acknowledgement as a blanket bypass (RED)', async () => {
    const root = await createFixture({
      [VERIFIER_PATH]: GREEN_VERIFIER.replace(
        'Acknowledgement is consumed only through the required `review-gate`;\nit is never a blanket bypass.',
        'An acknowledgement label bypasses failed checks.',
      ),
    });

    expect(collectReviewFindingsFindings(root)).toContainEqual(
      'merge-verifier: no longer delegates acknowledgement to required review-gate without a blanket bypass.',
    );
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
    expect(result.stdout).toContain('::examined:: 3 review artifacts');
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
