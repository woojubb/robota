import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { classifyFiles, isBuildMachineryPath } from '../classify-changed-paths.mjs';
import { createWorkspaceAffectedPlan, planWorkspaceAffected } from '../workspace-affected.mjs';
import { createVerificationPlan, WORKSPACE_WIDE_BUILD_TOOLING_PATHS } from '../check-plan.mjs';
import { makeTemp } from './make-temp.mjs';

const workflow = parse(
  readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
);
const build = workflow.jobs.build;
const changedFile = 'packages/agent-framework/src/index.ts';
const proof = build.steps.find((step) => step.id === 'clean_framework_proof');

function inlineNode(step, bindings) {
  const body = /node --input-type=module <<'EOF'\n([\s\S]*?)\nEOF/u.exec(step.run)?.[1];
  expect(body).toBeTypeOf('string');
  // Execute the actual workflow body, substituting only imported I/O/owner dependencies.
  return runInNewContext(body.replace(/^import .+;\n/gmu, ''), bindings);
}

describe('ARTIFACT clean framework proof CI wiring', () => {
  it('declares the root artifact driver and gives every runtime artifact module actual full build/test scope', () => {
    expect(WORKSPACE_WIDE_BUILD_TOOLING_PATHS).toContain('scripts/artifacts/build-workspace.mjs');
    const runtimeFiles = readdirSync(new URL('../../artifacts/', import.meta.url), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
      .map((entry) => `scripts/artifacts/${entry.name}`);
    expect(runtimeFiles.length).toBeGreaterThan(0);
    const scopes = ['a', 'b'].map((name) => ({
      kind: 'package',
      relativeDir: `packages/${name}`,
      workspaceName: name,
      scripts: { build: 'build', test: 'test' },
      hasTsconfig: true,
      workspaceDependencies: [],
    }));
    for (const file of [
      ...runtimeFiles,
      'scripts/harness/workspace-execution-engine.mjs',
      'scripts/harness/workspace-operation-selection.mjs',
    ]) {
      const verification = createVerificationPlan({ scopes, changedFiles: [file] });
      expect(verification.scopes, file).toHaveLength(2);
      for (const scope of verification.scopes)
        expect(scope.checks, file).toEqual(expect.arrayContaining(['build', 'test']));
      for (const operation of ['build', 'test']) {
        const plan = createWorkspaceAffectedPlan({ operation, changedFiles: [file] });
        expect(plan.mode, file).toBe('global');
        expect(plan.reason, file).toBe(`workspace-wide input changed: ${file}`);
      }
    }
    expect(
      createVerificationPlan({ scopes, changedFiles: ['scripts/artifacts/README.md'] }).scopes,
    ).toEqual([]);
  });
  it('runs the Linux clean partial proof before any workspace build or artifact regression', () => {
    const steps = build.steps;
    const index = steps.findIndex((step) => step.id === 'clean_framework_proof');
    expect(index).toBeGreaterThan(steps.findIndex((step) => step.name === 'Install dependencies'));
    expect(index).toBeLessThan(
      steps.findIndex((step) => step.name === 'Build full or affected workspace'),
    );
    expect(index).toBeLessThan(
      steps.findIndex(
        (step) =>
          step.name === 'Verify artifact generation, exact pack and release-path regressions',
      ),
    );
    expect(build['runs-on']).toBe('ubuntu-latest');
    expect(steps[index].if).toBe(
      "env.PRODUCT_APPLICABLE == 'true' && steps.build_requirement.outputs.clean_framework_proof == 'true'",
    );
    expect(steps[index]['continue-on-error']).toBeUndefined();
  });

  it.each([
    'scripts/artifacts/generation.mjs',
    'scripts/harness/workspace-operation-selection.mjs',
    'scripts/build-types-ordered.mjs',
  ])('routes %s to PRODUCT_APPLICABLE without relying on another changed file', (file) => {
    expect(classifyFiles([file]).product).toBe(true);
    expect(build.env.PRODUCT_APPLICABLE).toContain("needs.changes.outputs.product == 'true'");
    expect(
      build.steps.find(
        (step) =>
          step.name === 'Verify artifact generation, exact pack and release-path regressions',
      ).if,
    ).toBe("env.PRODUCT_APPLICABLE == 'true'");
  });

  it.each([
    ['scripts/artifacts/generation.mjs', true],
    ['scripts/harness/workspace-operation-selection.mjs', true],
    ['packages/agent-core/tsdown.config.ts', true],
    ['packages/agent-framework/package.json', true],
    ['packages/agent-framework/src/index.ts', false],
    ['scripts/harness/scan-task-plan-items.mjs', false],
    ['docs/artifacts.md', false],
  ])('selects the clean proof from the existing plan paths: %s → %s', (file, selected) => {
    let output = '';
    inlineNode(
      build.steps.find((step) => step.id === 'build_requirement'),
      {
        readFileSync: () => JSON.stringify({ changedFiles: [file], scopes: [] }),
        appendFileSync: (_file, contents) => {
          output += contents;
        },
        process: { env: { FULL_VERIFICATION: 'false', GITHUB_OUTPUT: 'output' } },
        console: { log() {} },
        isBuildMachineryPath,
      },
    );
    expect(output).toContain(`clean_framework_proof=${selected}\n`);
  });

  it('requires the regular build when the existing workspace plan promotes artifact-only changes to global', () => {
    let output = '';
    inlineNode(
      build.steps.find((step) => step.id === 'build_requirement'),
      {
        readFileSync: (file) =>
          JSON.stringify(
            file.endsWith('workspace-build-plan.json')
              ? { mode: 'global' }
              : { changedFiles: ['scripts/artifacts/generation.mjs'], scopes: [] },
          ),
        appendFileSync: (_file, contents) => {
          output += contents;
        },
        process: { env: { FULL_VERIFICATION: 'false', GITHUB_OUTPUT: 'output' } },
        console: { log() {} },
        isBuildMachineryPath,
      },
    );
    expect(output).toContain('required=true\n');
    expect(classifyFiles(['scripts/artifacts/generation.mjs']).full).toBe(false);
  });

  it('the current source graph really selects 15 including replay and analytics, without global fallback', () => {
    const plan = planWorkspaceAffected({ operation: 'build', changedFiles: [changedFile] });
    expect(plan).toMatchObject({ mode: 'packages', globalFallback: false });
    expect(plan.packages).toHaveLength(15);
    expect(plan.packages.map((pkg) => pkg.name)).toEqual(
      expect.arrayContaining([
        '@robota-sdk/agent-provider-replay',
        '@robota-sdk/agent-session-analytics',
      ]),
    );
  });

  it.each(['clean', 'global', 'wrong-count', 'missing-producer', 'warm-dist', 'warm-store'])(
    'executes the actual proof assertions against %s input',
    (state) => {
      const packages = [
        'agent-framework',
        'agent-provider-replay',
        'agent-session-analytics',
        ...Array.from({ length: 12 }, (_, index) => `fixture-${index}`),
      ].map((name) => ({ name: `@robota-sdk/${name}`, directory: `packages/${name}` }));
      const plan = { mode: 'packages', globalFallback: false, packages };
      if (state === 'global') plan.globalFallback = true;
      if (state === 'wrong-count') packages.pop();
      if (state === 'missing-producer') packages[1].name = '@fixture/wrong';
      const execute = () =>
        inlineNode(proof, {
          assert,
          path,
          readFileSync: () => JSON.stringify(plan),
          lstatSync: (file, options) => {
            expect(options.throwIfNoEntry).toBe(false);
            const warm =
              state === 'warm-dist' ? 'dist' : state === 'warm-store' ? '.robota-artifacts' : null;
            return file === `packages/unselected/${warm}`
              ? { isSymbolicLink: () => true }
              : undefined;
          },
          readWorkspaceGraph: () => ({
            packages: [...packages, { directory: 'packages/unselected' }],
          }),
          process: { env: { RUNNER_TEMP: '/fixture' }, cwd: () => '/fixture' },
          console: { log() {} },
        });
      if (state === 'clean') expect(execute).not.toThrow();
      else expect(execute).toThrow();
    },
  );

  it.each(['none', 'build', 'regressions', 'test'])(
    'executes ordered workflow commands and propagates %s failure without running real builds',
    (failure) => {
      const result = spawnSync(
        'bash',
        [
          '-euo',
          'pipefail',
          '-c',
          `
        node() {
          printf 'node %s\\n' "$*" >&2
          if [[ "$*" == *workspace-affected-run.mjs* && "$*" == *"--operation $FAILURE "* ]]; then return 23; fi
        }
        pnpm() {
          printf 'pnpm %s\\n' "$*" >&2
          [[ "$FAILURE" != regressions ]] || return 23
        }
        ${proof.run}
      `,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, RUNNER_TEMP: makeTemp('artifact-ci-proof-'), FAILURE: failure },
        },
      );
      const commands = result.stderr.trim().split('\n');
      expect(result.status, result.stderr).toBe(failure === 'none' ? 0 : 23);
      expect(commands[0]).toBe(
        `node scripts/harness/workspace-affected.mjs --operation build --changed-file ${changedFile} --format json`,
      );
      expect(commands[1]).toBe('node --input-type=module');
      expect(commands[2]).toBe(
        `node scripts/harness/workspace-affected-run.mjs --operation build --changed-file ${changedFile}`,
      );
      if (failure !== 'build') {
        expect(commands[3]).toBe(
          'pnpm --filter @robota-sdk/agent-framework exec vitest run --no-cache src/interactive/__tests__/interactive-session-background-tasks.test.ts src/testing/__tests__/session-log-external-payload-replay-functional.test.ts src/testing/__tests__/usage-assertion-functional.test.ts',
        );
      }
      if (failure === 'none' || failure === 'test')
        expect(commands[4]).toBe(
          `node scripts/harness/workspace-affected-run.mjs --operation test --changed-file ${changedFile}`,
        );
      expect(commands).toHaveLength(failure === 'build' ? 3 : failure === 'regressions' ? 4 : 5);
    },
  );
});
