import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WORKFLOW_FILE = path.join(ROOT, '.github/workflows/ci.yml');

function workflow() {
  return parse(readFileSync(WORKFLOW_FILE, 'utf8'));
}

describe('PAYLOAD-2153 native acceptance topology', () => {
  it('runs exactly one read-only leg on each approved native host', () => {
    const job = workflow().jobs['payload-native'];
    expect(job.permissions).toEqual({ contents: 'read' });
    expect(job.strategy['fail-fast']).toBe(false);
    expect(job.strategy.matrix.include).toEqual([
      { target: 'linux-x64', runner: 'ubuntu-24.04', binary: 'qualification' },
      { target: 'linux-arm64', runner: 'ubuntu-24.04-arm', binary: 'qualification' },
      { target: 'darwin-x64', runner: 'macos-26-intel', binary: 'qualification' },
      { target: 'darwin-arm64', runner: 'macos-26', binary: 'qualification' },
      { target: 'windows-x64', runner: 'windows-2025', binary: 'qualification.exe' },
    ]);
    const rendered = JSON.stringify(job);
    expect(rendered).toContain('20.19.0');
    expect(rendered).toContain('22.14.0');
    expect(rendered).toContain('bun-version":"1.3.14');
    expect(rendered).toContain('qualify:bun:build');
    expect(rendered).toContain('write-native-evidence.mjs');
    expect(rendered).not.toContain('contents":"write');
  });

  it('publishes one stable fail-closed fan-in over the exact evidence checker', () => {
    const parsed = workflow();
    const job = parsed.jobs['stable-payload-native'];
    expect(job.name).toBe('stable payload native');
    expect(job.needs).toEqual(['changes', 'payload-native']);
    expect(job.if).toContain('always()');
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
    expect(parsed.jobs['stable-payload-native'].steps[1].env.RELEVANT).toBe(
      '${{ needs.changes.outputs.payload_native }}',
    );
  });
});
