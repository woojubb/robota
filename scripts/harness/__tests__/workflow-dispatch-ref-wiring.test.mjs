import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const read = (file) => readFileSync(resolve(import.meta.dirname, '../../..', file), 'utf8');

describe('workflow dispatch immutable ref wiring', () => {
  it('normalizes once in changes and passes the pair to selected consumers', () => {
    const source = read('.github/workflows/ci.yml');
    const ci = parse(source);
    const changes = ci.jobs.changes;
    expect(changes.outputs.base_oid).toContain('steps.resolve.outputs.base_oid');
    expect(changes.outputs.head_oid).toContain('steps.resolve.outputs.head_oid');
    expect(changes.steps.find(({ id }) => id === 'resolve').run).toContain(
      'workflow-dispatch-refs.mjs',
    );
    expect(changes.steps.find(({ id }) => id === 'control-plane').env.BASE_REF).toContain(
      'steps.resolve.outputs.base_oid',
    );
    expect(changes.steps.find(({ id }) => id === 'filter').env.BASE_REF).toContain(
      'steps.resolve.outputs.base_oid',
    );
    expect(changes.steps.find(({ id }) => id === 'product-integration').env.BASE_REF).toContain(
      'steps.resolve.outputs.base_oid',
    );
    expect(changes.steps.find(({ id }) => id === 'control-plane').run).not.toContain(
      '< <(git diff',
    );
    expect(changes.steps.find(({ id }) => id === 'control-plane').run).toContain(
      'git diff --name-only --no-renames "${BASE_REF}"...HEAD > "$changed_paths"',
    );
    for (const [name, job] of Object.entries(ci.jobs)) {
      if (name === 'changes') continue;
      const jobText = JSON.stringify(job);
      if (!jobText.includes('needs.changes.outputs.')) continue;
      expect(Array.isArray(job.needs) ? job.needs : [job.needs]).toContain('changes');
      expect(jobText).not.toContain("&& inputs.base_ref || format('origin/{0}'");
      expect(jobText).not.toContain("&& inputs.head_ref || ''");
    }
    expect(ci.jobs['secret-scan'].needs).toBe('changes');
    expect(ci.jobs['secret-scan'].with.base_ref).toContain('needs.changes.outputs.base_oid');
    expect(ci.jobs['secret-scan'].with.head_ref).toContain('needs.changes.outputs.head_oid');
    expect(ci.jobs['secret-scan'].if).toContain("needs.changes.result == 'success'");
    expect(ci.jobs.build.if).not.toContain('inputs.base_ref');
  });

  it('runs the controller before the exact target checkout and verifies the resulting HEAD', () => {
    const steps = parse(read('.github/workflows/ci.yml')).jobs.changes.steps;
    const firstCheckout = steps.findIndex((step) => step.uses === 'actions/checkout@v7');
    const resolver = steps.findIndex((step) => step.id === 'resolve');
    const targetCheckout = steps.findIndex(
      (step) => step.name === 'Checkout the resolved manual head',
    );
    const verification = steps.findIndex(
      (step) => step.name === 'Verify the resolved manual checkout',
    );
    const classifier = steps.findIndex((step) => step.id === 'filter');
    expect(firstCheckout).toBeLessThan(resolver);
    expect(resolver).toBeLessThan(targetCheckout);
    expect(targetCheckout).toBeLessThan(verification);
    expect(verification).toBeLessThan(classifier);
    expect(steps[firstCheckout].with.ref).toBe(
      "${{ github.event_name == 'workflow_dispatch' && github.sha || '' }}",
    );
    expect(steps[targetCheckout].with.ref).toBe('${{ steps.resolve.outputs.head_oid }}');
    expect(steps[targetCheckout].if).toBe("github.event_name == 'workflow_dispatch'");
    expect(steps[verification].run).toContain('HEAD^{commit}');
    expect(steps[verification].env.EXPECTED_HEAD).toBe('${{ steps.resolve.outputs.head_oid }}');
    expect(steps[0].run).toContain('refs/heads/develop');
    expect(steps[0].env.WORKFLOW_REF).toBe('${{ github.ref }}');
  });

  it('selects the same manual jobs for main, a qualified branch, a tag and the same base OID', () => {
    const { jobs } = parse(read('.github/workflows/ci.yml'));
    const selected = [
      'build',
      'product-integration',
      'repo-checks',
      'harness-contracts',
      'harness-hermetic',
      'dependency-security',
      'dependency-policy',
      'secret-scan',
      'security',
      'actionlint',
      'examples-typecheck',
      'windows-shell',
      'tui-e2e',
      'pr-validation',
    ];
    const evaluate = (condition, eventName, baseRef, inputBase) => {
      // Evaluate the workflow's actual boolean expression with all selected children successful.
      const expression = condition
        .replace(/^\$\{\{\s*|\s*\}\}$/gu, '')
        .replace(/needs\.[\w-]+\.outputs\.[\w-]+/gu, "'true'")
        .replace(/needs\.[\w-]+\.result/gu, "'success'");
      return runInNewContext(expression, {
        github: { event_name: eventName, base_ref: baseRef },
        inputs: { base_ref: inputBase },
        always: () => true,
      });
    };
    for (const name of selected) {
      for (const base of ['main', 'refs/heads/main', 'snapshot-main', 'a'.repeat(40)]) {
        // Dependency review compares a PR's changes and intentionally has no manual mode.
        expect(evaluate(jobs[name].if, 'workflow_dispatch', '', base), name).toBe(
          name !== 'dependency-policy',
        );
      }
      expect(evaluate(jobs[name].if, 'pull_request', 'main', ''), name).toBe(false);
      expect(evaluate(jobs[name].if, 'pull_request', 'develop', ''), name).toBe(true);
    }
  });

  it('scans a pre-resolved base range for PRs and manual runs', () => {
    const gitleaks = parse(read('.github/workflows/gitleaks.yml'));
    const steps = gitleaks.jobs.gitleaks.steps;
    expect(steps.find(({ name }) => name === 'Verify resolved scan range').run).toContain(
      'git rev-parse --verify',
    );
    expect(steps.find(({ name }) => name === 'Scan PR commits for secrets').run).toContain(
      '--log-opts "${{ inputs.base_ref }}..HEAD"',
    );
    expect(gitleaks.jobs.gitleaks).not.toHaveProperty('if');
  });
});
