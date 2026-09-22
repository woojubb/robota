import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { makeTemp } from './make-temp.mjs';
import { literalLocalImportClosure } from '../literal-local-import-closure.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

describe('issue #2826 delivery simplification', () => {
  it('splits pull-request verification into independently retriable responsibilities', () => {
    const workflow = parse(read('.github/workflows/ci.yml'));
    const jobs = workflow.jobs;

    expect(jobs).toHaveProperty('repo-checks');
    expect(jobs).toHaveProperty('harness-contracts');
    expect(jobs).toHaveProperty('harness-hermetic');
    expect(jobs).toHaveProperty('external-units');
    expect(jobs).toHaveProperty('pr-validation');
    expect(jobs).toHaveProperty('security');
    expect(jobs).toHaveProperty('secret-scan');
    for (const removed of ['quality', 'scans', 'format-check', 'commitlint', 'patch-coverage']) {
      expect(jobs).not.toHaveProperty(removed);
    }

    expect(jobs['harness-contracts'].if).toContain("needs.changes.outputs.harness == 'true'");
    expect(jobs['harness-hermetic'].if).toContain("needs.changes.outputs.hermetic == 'true'");
    expect(
      jobs.build.steps.find((step) => step.name?.startsWith('Verify artifact generation')).if,
    ).toContain('artifact_tests_required');
    expect(jobs.actionlint.if).not.toContain("github.event_name == 'pull_request'");
    expect(jobs.actionlint.steps[0].with.ref).toContain('inputs.head_ref');
    expect(jobs['pr-validation'].needs).toEqual(
      expect.arrayContaining([
        'repo-checks',
        'harness-contracts',
        'harness-hermetic',
        'external-units',
      ]),
    );
    expect(jobs['external-units'].if).toContain("needs.changes.outputs.external_units == 'true'");
    expect(jobs.changes.steps.find(({ id }) => id === 'external-units').if).toContain(
      'head.repo.full_name != github.repository',
    );
    for (const aggregate of ['pr-validation', 'security']) {
      expect(jobs[aggregate].if).toContain('always()');
      expect(jobs[aggregate].if).not.toContain('cancelled()');
    }
  });

  it('forces owner jobs even when a changed PR-side selector becomes permissive', () => {
    const workflow = parse(read('.github/workflows/ci.yml'));
    const changes = workflow.jobs.changes;
    const outer = changes.steps.find(({ id }) => id === 'control-plane');
    expect(outer.run).toContain('git diff --name-only --no-renames');
    expect(changes.outputs.harness).toContain('steps.control-plane.outputs.harness');
    expect(changes.outputs.full).toContain('steps.control-plane.outputs.full');
    expect(changes.outputs.product_integration).toContain(
      'steps.control-plane.outputs.product_integration',
    );

    const root = makeTemp('robota-ci-control-plane-');
    spawnSync('git', ['init', '--quiet', '--initial-branch=base', root]);
    spawnSync('git', ['-C', root, 'config', 'user.email', 'harness@example.test']);
    spawnSync('git', ['-C', root, 'config', 'user.name', 'Harness']);
    const classifierClosure = literalLocalImportClosure(ROOT, [
      'scripts/harness/classify-changed-paths.mjs',
    ]);
    expect(classifierClosure).toEqual([
      'scripts/harness/changed-path-capabilities.mjs',
      'scripts/harness/classify-changed-paths.mjs',
      'scripts/harness/entrypoint.mjs',
      'scripts/harness/git-base-ref-resolution.mjs',
      'scripts/harness/harness-test-classification.mjs',
      'scripts/harness/manifest-change-classification.mjs',
      'scripts/harness/shared.mjs',
    ]);
    const controlPlaneFiles = [
      ...classifierClosure,
      'scripts/harness/product-integration-tests.mjs',
    ];
    for (const file of controlPlaneFiles) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), 'export const applicable = true;\n');
    }
    spawnSync('git', ['-C', root, 'add', '-A']);
    spawnSync('git', ['-C', root, 'commit', '--quiet', '-m', 'base']);

    for (const file of classifierClosure) {
      spawnSync('git', ['-C', root, 'checkout', '--quiet', '-B', 'pr', 'base']);
      writeFileSync(path.join(root, file), 'export const applicable = false;\n');
      spawnSync('git', ['-C', root, 'add', '-A']);
      spawnSync('git', ['-C', root, 'commit', '--quiet', '-m', `weaken ${file}`]);
      const output = path.join(root, `github-output-${path.basename(file)}`);
      const result = spawnSync('bash', ['-c', outer.run], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, BASE_REF: 'base', GITHUB_OUTPUT: output },
      });
      expect(result.status, `${file}: ${result.stderr}`).toBe(0);
      const decisions = readFileSync(output, 'utf8');
      expect(decisions, file).toContain('harness=true');
      expect(decisions, file).toContain('hermetic=true');
      expect(decisions, file).toContain('full=true');
    }

    spawnSync('git', ['-C', root, 'checkout', '--quiet', '-B', 'pr', 'base']);
    const productSelector = 'scripts/harness/product-integration-tests.mjs';
    writeFileSync(path.join(root, productSelector), 'export const applicable = false;\n');
    spawnSync('git', ['-C', root, 'add', '-A']);
    spawnSync('git', ['-C', root, 'commit', '--quiet', '-m', 'weaken product selector']);
    const output = path.join(root, 'github-output-product');
    const result = spawnSync('bash', ['-c', outer.run], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, BASE_REF: 'base', GITHUB_OUTPUT: output },
    });
    expect(result.status, result.stderr).toBe(0);
    const decisions = readFileSync(output, 'utf8');
    expect(decisions).toContain('product=true');
    expect(decisions).toContain('product_integration=true');
  });

  it('runs dependency and license checks only for semantic dependency or policy changes', () => {
    const ci = parse(read('.github/workflows/ci.yml'));
    const policy = parse(read('.github/workflows/dependency-review.yml'));
    expect(policy.on).toHaveProperty('workflow_call');
    expect(Object.keys(policy.jobs)).toEqual(['dependency-review']);
    expect(ci.jobs['dependency-policy'].needs).toBe('changes');
    expect(ci.jobs['dependency-policy'].if).toContain(
      "needs.changes.outputs.dependencies == 'true'",
    );
    expect(ci.jobs['dependency-policy'].uses).toBe('./.github/workflows/dependency-review.yml');
    expect(ci.jobs.security.needs).toEqual(
      expect.arrayContaining(['dependency-security', 'dependency-policy', 'secret-scan']),
    );
    expect(ci.jobs.security.steps[0].env).toMatchObject({
      DEPENDENCY_RESULT: '${{ needs.dependency-security.result }}',
      POLICY_RESULT: '${{ needs.dependency-policy.result }}',
      SECRET_RESULT: '${{ needs.secret-scan.result }}',
    });
    expect(read('.github/workflows/ci.yml')).not.toContain('Detect dependency graph changes');
  });

  it('keeps secret detection enabled for external contributions', () => {
    const workflow = parse(read('.github/workflows/gitleaks.yml'));
    const ci = parse(read('.github/workflows/ci.yml'));
    expect(workflow.on).toHaveProperty('workflow_call');
    expect(workflow.jobs.gitleaks).not.toHaveProperty('if');
    expect(workflow.jobs.gitleaks.permissions ?? workflow.permissions).toEqual({
      contents: 'read',
    });
    expect(ci.jobs['secret-scan'].uses).toBe('./.github/workflows/gitleaks.yml');
    expect(ci.jobs['secret-scan'].if).not.toContain('head.repo.full_name');
    expect(ci.on.pull_request.types).toEqual(['opened', 'synchronize', 'reopened', 'edited']);
  });

  it('keeps full repository, contract, and hermetic execution reachable outside PR CI', () => {
    const workflow = parse(read('.github/workflows/scans-full.yml'));
    expect(workflow.on).not.toHaveProperty('schedule');
    expect(workflow.jobs).toHaveProperty('repo-checks-full');
    expect(workflow.jobs).toHaveProperty('harness-contracts-full');
    expect(workflow.jobs).toHaveProperty('harness-hermetic-full');
    expect(workflow.jobs).toHaveProperty('full-harness');
    expect(read('.github/workflows/scans-full.yml')).not.toMatch(/--body\s+"[^"\n]*`\$short_sha`/u);
  });

  it('declares only the four stable develop contexts', () => {
    const declaration = JSON.parse(read('.github/required-status-checks.json'));
    expect(
      declaration.branches.develop.required_status_checks.map(({ context }) => context),
    ).toEqual(['pr-validation', 'security', 'review-policy', 'workflow provenance']);
  });

  it('keeps review policy free of disabled compatibility jobs', () => {
    const workflow = parse(read('.github/workflows/review-gate.yml'));
    expect(Object.keys(workflow.jobs)).toEqual(['review-policy', 'disarm-auto-merge']);
    expect(workflow.jobs['review-policy']).not.toHaveProperty('needs');
    expect(read('.github/workflows/review-gate.yml')).not.toContain('check-review-gate.mjs');
  });

  it('does not demand revalidation merely because a conflict-free target branch advanced', () => {
    const gate = read('.claude/hooks/merge-gate.sh');
    const branchRule = read('.agents/rules/git-branch.md');
    expect(gate).toContain('merge-tree --write-tree "$CURRENT_BASE_OID" "$CURRENT_HEAD_OID"');
    expect(gate).toContain('The reviewed comparison stands because the exact live base/head pair');
    expect(gate).toContain('CLEAN | BEHIND');
    expect(gate).not.toContain('comm -12');
    expect(gate).not.toContain('The review never saw that interaction');
    expect(branchRule).toContain('publish exactly one `PR_MERGE_DECISION`');
    expect(branchRule).toContain('exact live head/base pair produces a conflict-free tree');
    expect(branchRule).not.toContain('`POST_FINDINGS_ACTION_REQUEST` decision');
    expect(branchRule).not.toContain('GitHub reports the unchanged head mergeable');
  });

  it('reuses commit-time local checks instead of repeating them at pre-push', () => {
    const prePush = read('scripts/harness/pre-push-verification-execution.mjs');
    expect(prePush).not.toContain("'format-check'");
    expect(prePush).toContain('reused from commit hooks');

    const preCommit = read('.husky/pre-commit');
    expect(preCommit).not.toContain('scan-user-execution-plan-order');
    expect(preCommit).toContain('pnpm lint:fix:staged');
    expect(read('.husky/commit-msg')).toContain('commitlint');
  });

  it('keeps integration bases bound to one authoritative identity without a Task/spec pair', () => {
    const hook = read('.claude/hooks/pre-push-check.sh');
    const branchRule = read('.agents/rules/git-branch.md');
    const historyScan = read('scripts/harness/scan-ci-base-history.mjs');

    expect(hook).not.toContain('TRUSTED_TASK_PATHS');
    expect(hook).not.toContain('TRUSTED_SPEC_PATHS');
    expect(hook).not.toContain('Task/spec pair');
    expect(branchRule).toContain('does not require a duplicate Task/spec pair');
    expect(branchRule).not.toContain('Plan-order validates each child');
    expect(historyScan).not.toContain('user-execution-plan-order');
  });

  it('keeps ordinary PR and review entry points focused instead of mandating broad suites', () => {
    const template = read('.github/PULL_REQUEST_TEMPLATE.md');
    const packageReview = read('.agents/skills/package-code-review/SKILL.md');

    expect(template).not.toMatch(/`pnpm (?:build|typecheck|lint|test)\b/u);
    expect(template).not.toContain('`pnpm harness:scan`');
    expect(template).toContain('Focused local tests');
    expect(template).toContain('Exact-head required CI');

    expect(packageReview).not.toContain('`pnpm harness:scan`');
    expect(packageReview).not.toContain('`pnpm --filter <pkg> build');
    expect(packageReview).toContain('existing exact-head verification evidence');
    expect(packageReview).toContain('specifically justified focused reproducer');
  });

  it('continuously fills bounded contract-test slots and reports each completion immediately', () => {
    const execution = read('scripts/harness/harness-contract-execution.mjs');
    expect(execution).toContain('runBoundedContractTasks');
    expect(execution).toContain('onComplete(task, result)');
    expect(execution).not.toContain('index += concurrency');
    expect(execution).not.toContain('const batch = await Promise.all(');
  });

  it('uses one work record with entry and completion boundaries for ordinary work', () => {
    const gate = read('.agents/skills/user-request-gate/SKILL.md');
    const execution = read('.agents/skills/backlog-execution-orchestrator/SKILL.md');
    for (const document of [gate, execution]) {
      expect(document).toContain('Entry boundary');
      expect(document).toContain('Completion boundary');
      expect(document).not.toContain('finding-depth-triager');
      expect(document).not.toContain('user-execution-scenario-author');
      expect(document).not.toContain('gate.mjs judge');
    }
  });
});
