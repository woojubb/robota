import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WORKFLOW_FILE = path.join(ROOT, '.github/workflows/release-bun-binaries.yml');

function workflow() {
  return parse(readFileSync(WORKFLOW_FILE, 'utf8'));
}

describe('PAYLOAD-2153 Bun release topology', () => {
  it('builds and executes exactly one artifact on each matching read-only native host', () => {
    const parsed = workflow();
    expect(parsed.permissions).toEqual({ contents: 'read' });
    const build = parsed.jobs['build-bun'];
    expect(build.permissions).toEqual({ contents: 'read' });
    expect(build.strategy['fail-fast']).toBe(false);
    expect(build.strategy.matrix.include).toEqual([
      { target: 'linux-x64', runner: 'ubuntu-24.04', binary: 'robota-linux-x64' },
      { target: 'linux-arm64', runner: 'ubuntu-24.04-arm', binary: 'robota-linux-arm64' },
      { target: 'darwin-x64', runner: 'macos-26-intel', binary: 'robota-darwin-x64' },
      { target: 'darwin-arm64', runner: 'macos-26', binary: 'robota-darwin-arm64' },
      { target: 'windows-x64', runner: 'windows-2025', binary: 'robota-windows-x64.exe' },
    ]);
    const rendered = JSON.stringify(build);
    expect(rendered).toContain('build-bun.mjs \\"${{ matrix.target }}\\"');
    expect(rendered).toContain('e2e-native-file-authority.mjs');
    expect(rendered).toContain('bun-binary-${{ matrix.target }}-${{ github.run_id }}');
    expect(rendered).toContain('${RUNNER_TEMP}/robota-release-bun-${{ matrix.target }}-');
    expect(rendered).not.toContain('build:bun:all');
    expect(rendered).not.toContain('contents":"write');
  });

  it('gives one dependent publisher the only write grant and validates all six assets after upload', () => {
    const parsed = workflow();
    const publisher = parsed.jobs['publish-bun'];
    expect(publisher.needs).toBe('build-bun');
    expect(publisher.permissions).toEqual({ contents: 'write' });
    const writeJobs = Object.entries(parsed.jobs)
      .filter(([, job]) => job.permissions?.contents === 'write')
      .map(([name]) => name);
    expect(writeJobs).toEqual(['publish-bun']);

    const rendered = JSON.stringify(publisher);
    for (const asset of [
      'robota-darwin-arm64',
      'robota-darwin-x64',
      'robota-linux-x64',
      'robota-linux-arm64',
      'robota-windows-x64.exe',
      'SHA256SUMS.txt',
    ]) {
      expect(rendered).toContain(asset);
    }
    expect(rendered).toContain('pattern":"bun-binary-*-${{ github.run_id }}');
    const validation = publisher.steps.find(
      (step) => step.name === 'Validate the exact input set and generate checksums',
    ).run;
    expect(validation).toContain('"$lines" -ne 5');
    expect(validation).toContain("expected_format='Mach-O 64-bit arm64'");
    expect(validation).toContain("expected_format='ELF 64-bit LSB.*ARM aarch64'");
    expect(validation).toContain("expected_format='PE32+.*x86-64'");
    expect(rendered.match(/gh release upload/gu)).toHaveLength(1);
    expect(rendered).toContain('gh release download');
    expect(rendered).toContain('sha256sum');
    expect(rendered).toContain('published digest');
  });

  it('retains shared-tag serialization with the desktop release', () => {
    expect(workflow().concurrency).toEqual({
      group: 'release-assets-${{ github.event.inputs.tag || github.ref_name }}',
      'cancel-in-progress': false,
    });
  });
});
