import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

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

  it('publishes one stable fail-closed fan-in over the exact evidence checker', () => {
    const parsed = workflow();
    const job = parsed.jobs['stable-payload-native'];
    expect(job.name).toBe('stable payload native');
    expect(job.needs).toEqual(['changes', 'payload-native']);
    expect(job.if).toContain('always()');
    expect(job.if).toContain("needs.changes.result != ''");
    expect(job.if).toContain("needs.payload-native.result != ''");
    expect(job.if).not.toContain("needs.payload-native.result != 'cancelled'");
    const rendered = JSON.stringify(job);
    expect(rendered).toContain('payload_native relevance is missing or invalid');
    expect(rendered).toContain('pattern":"payload-native-*-${{ github.run_id }}');
    expect(rendered).toContain('merge-multiple":true');
    expect(rendered).toContain('payload-native-evidence.mjs .qualification-evidence');
  });

  it('gets applicability only from the canonical changed-path classifier', () => {
    const parsed = workflow();
    expect(parsed.jobs.changes.outputs.payload_native).toBe(
      '${{ steps.filter.outputs.payload_native }}',
    );
    expect(parsed.jobs['payload-native'].if).toContain(
      "needs.changes.outputs.payload_native == 'true'",
    );
    const relevanceStep = parsed.jobs['stable-payload-native'].steps.find(
      (step) => step.name === 'Fail closed on relevance or native-leg failure',
    );
    expect(relevanceStep.env.RELEVANT).toBe('${{ needs.changes.outputs.payload_native }}');
  });
});
