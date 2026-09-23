import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { classifyFiles } from '../classify-changed-paths.mjs';
import { makeTemp } from './make-temp.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WORKFLOW_FILE = path.join(ROOT, '.github/workflows/ci.yml');
const CLI_MANIFEST_FILE = path.join(ROOT, 'packages/agent-cli/package.json');

function workflow() {
  return parse(readFileSync(WORKFLOW_FILE, 'utf8'));
}

describe('PAYLOAD-2153 native acceptance topology', () => {
  it('runs exactly one read-only leg on each approved native host', () => {
    const job = workflow().jobs['payload-native'];
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(job.strategy['fail-fast']).toBe(false);
    expect(job.strategy.matrix.include).toEqual([
      {
        target: 'linux-x64',
        runner: 'ubuntu-24.04',
        binary: 'qualification',
        cli_binary: 'robota-linux-x64',
      },
      {
        target: 'linux-arm64',
        runner: 'ubuntu-24.04-arm',
        binary: 'qualification',
        cli_binary: 'robota-linux-arm64',
      },
      {
        target: 'darwin-x64',
        runner: 'macos-26-intel',
        binary: 'qualification',
        cli_binary: 'robota-darwin-x64',
      },
      {
        target: 'darwin-arm64',
        runner: 'macos-26',
        binary: 'qualification',
        cli_binary: 'robota-darwin-arm64',
      },
      {
        target: 'windows-x64',
        runner: 'windows-2025',
        binary: 'qualification.exe',
        cli_binary: 'robota-windows-x64.exe',
      },
    ]);
    const rendered = JSON.stringify(job);
    expect(rendered).toContain('20.19.0');
    expect(rendered).toContain('22.14.0');
    expect(rendered).toContain('bun-version":"1.3.14');
    expect(rendered).toContain('qualify:bun:build');
    expect(rendered).toContain('scenario:verify:external-payload-replay');
    expect(rendered).toContain('e2e-native-file-authority.mjs');
    expect(rendered).toContain('build-bun.mjs');
    expect(rendered).toContain('write-native-evidence.mjs');
    expect(rendered).toContain('${RUNNER_TEMP}/payload-native-install-');
    expect(rendered).toContain('${RUNNER_TEMP}/payload-native-bun-');
    const buildStep = job.steps.find(
      (step) => step.name === 'Build the CLI dependency closure for replay verification',
    );
    expect(buildStep.run).toBe(
      [
        'pnpm --filter @robota-sdk/agent-cli-web... build',
        'pnpm --filter @robota-sdk/agent-cli... build',
      ].join('\n') + '\n',
    );
    expect(rendered).not.toContain('"run":"pnpm build"');
    expect(rendered).not.toContain('$output_root/node-install');
    expect(rendered).not.toContain('$output_root/fresh-cli');
    const packStep = job.steps.find(
      (step) => step.name === 'Pack, clean-install, and verify the Node CLI',
    );
    const cliManifest = JSON.parse(readFileSync(CLI_MANIFEST_FILE, 'utf8'));
    expect(cliManifest.scripts['pack:verified']).toBe('node ../../scripts/artifacts/pack.mjs');
    expect(packStep.run).toMatch(
      /pnpm --filter @robota-sdk\/agent-cli run pack:verified\s+\\\s+--package \.\s+\\\s+--destination "\$pack_root"/u,
    );
    expect(rendered).not.toContain('pnpm --filter @robota-sdk/agent-cli pack');
    expect(rendered).not.toContain('contents":"write');
  });

  it('folds the native evidence gate into the existing PR aggregate', () => {
    const parsed = workflow();
    const aggregate = parsed.jobs['pr-validation'];
    expect(parsed.jobs).not.toHaveProperty('stable-payload-native');
    expect(aggregate.needs).toContain('payload-native');
    expect(aggregate.if).toContain('always()');
    expect(aggregate.if).toContain("needs.payload-native.result != ''");
    expect(aggregate.permissions).toEqual({ contents: 'read' });
    const evidenceSteps = aggregate.steps.slice(1);
    expect(evidenceSteps.map(({ name }) => name)).toEqual([
      'Check out native evidence verifier',
      'Download all native evidence records',
      'Verify the exact native evidence set',
    ]);
    for (const step of evidenceSteps) {
      expect(step.if).toBe("needs.changes.outputs.payload_native == 'true'");
    }
    expect(evidenceSteps[1].with.pattern).toBe('payload-native-*-${{ github.run_id }}');
    expect(evidenceSteps[1].with['merge-multiple']).toBe(true);
    expect(evidenceSteps[2].run).toBe(
      'node scripts/harness/payload-native-evidence.mjs .qualification-evidence',
    );
  });

  it('combines classifier relevance with the control-plane full override', () => {
    const parsed = workflow();
    expect(parsed.jobs.changes.outputs.payload_native).toBe(
      "${{ steps.filter.outputs.payload_native == 'true' || steps.control-plane.outputs.full == 'true' }}",
    );
    expect(parsed.jobs['payload-native'].if).toContain(
      "needs.changes.outputs.payload_native == 'true'",
    );
    const aggregate = parsed.jobs['pr-validation'].steps[0];
    expect(aggregate.env.PAYLOAD_NATIVE_RELEVANCE).toBe(
      '${{ needs.changes.outputs.payload_native }}',
    );

    const selected = (file, controlPlaneFull) => {
      const verdict = classifyFiles([file], { capabilities: {} });
      const expression = parsed.jobs.changes.outputs.payload_native;
      const terms = expression.slice(4, -3).split(/\s*\|\|\s*/u);
      const values = {
        'steps.filter.outputs.payload_native': String(verdict.payloadNative),
        'steps.control-plane.outputs.full': String(controlPlaneFull),
      };
      return terms.some((term) => {
        const match = /^(steps\.[a-z-]+\.outputs\.[a-z_]+) == 'true'$/u.exec(term);
        if (!match || !Object.hasOwn(values, match[1]))
          throw new Error(`Unknown selector: ${term}`);
        return values[match[1]] === 'true';
      });
    };
    const forcedFile = 'scripts/harness/changed-path-capabilities.mjs';
    expect(classifyFiles([forcedFile], { capabilities: {} })).toMatchObject({
      payloadNative: false,
      full: false,
    });
    expect(parsed.jobs.changes.steps.find(({ id }) => id === 'control-plane').run).toContain(
      forcedFile,
    );
    expect(selected(forcedFile, true)).toBe(true);
    expect(
      selected('packages/agent-cli/src/remote-control/remote-control-controller.ts', false),
    ).toBe(false);
  });

  it('executes the PR aggregate with selected failure, skipped, missing, and irrelevant native results', () => {
    const aggregate = workflow().jobs['pr-validation'].steps[0];
    expect(aggregate.env.PAYLOAD_NATIVE_RESULT).toBe('${{ needs.payload-native.result }}');
    const baseEnv = {
      CHANGES_RESULT: 'success',
      BUILD_RESULT: 'skipped',
      REPO_CHECKS_RESULT: 'success',
      CONTRACTS_RESULT: 'skipped',
      HERMETIC_RESULT: 'skipped',
      ACTIONLINT_RESULT: 'skipped',
      EXAMPLES_RESULT: 'skipped',
      WINDOWS_RESULT: 'skipped',
      TUI_RESULT: 'skipped',
      PRODUCT_INTEGRATION_RESULT: 'skipped',
      EXTERNAL_UNITS_RESULT: 'skipped',
      PRODUCT_APPLICABLE: 'false',
      HARNESS_APPLICABLE: 'false',
      HERMETIC_APPLICABLE: 'false',
      WORKFLOW_APPLICABLE: 'false',
      EXAMPLES_APPLICABLE: 'false',
      WINDOWS_APPLICABLE: 'false',
      TUI_APPLICABLE: 'false',
      PRODUCT_INTEGRATION_APPLICABLE: 'false',
      EXTERNAL_UNITS_APPLICABLE: 'false',
    };
    const run = (relevance, result) =>
      spawnSync('bash', ['-c', aggregate.run], {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...baseEnv,
          PAYLOAD_NATIVE_RELEVANCE: relevance,
          PAYLOAD_NATIVE_RESULT: result,
        },
      });
    expect(run('true', 'success').status).toBe(0);
    for (const result of ['failure', 'skipped', '']) {
      const execution = run('true', result);
      expect(execution.status, result).not.toBe(0);
      expect(execution.stdout).toContain('payload-native was selected');
    }
    expect(run('false', 'skipped').status).toBe(0);
    expect(run('', 'skipped').status).not.toBe(0);

    const emptyEvidence = makeTemp('robota-payload-native-fanin-');
    const missing = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts/harness/payload-native-evidence.mjs'), emptyEvidence],
      { encoding: 'utf8' },
    );
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/missing|expected|evidence/iu);
  });
});
