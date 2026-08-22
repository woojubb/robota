import { spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DUAL_LICENSE,
  deriveDependencyReviewLicenseExemptions,
  main,
  writeDependencyReviewLicenseExemptionsOutput,
} from '../generate-dependency-review-license-exemptions.mjs';
import { makeTemp } from './make-temp.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const SCRIPT = path.join(
  REPO_ROOT,
  'scripts/harness/generate-dependency-review-license-exemptions.mjs',
);
const WORKFLOW_RELATIVE = '.github/workflows/dependency-review.yml';
const WORKFLOW = readFileSync(path.join(REPO_ROOT, WORKFLOW_RELATIVE), 'utf8');
const STATIC_SHARP_PURLS = [
  'pkg:npm/%40img/sharp-libvips-darwin-arm64',
  'pkg:npm/%40img/sharp-libvips-darwin-x64',
  'pkg:npm/%40img/sharp-libvips-linux-arm',
  'pkg:npm/%40img/sharp-libvips-linux-arm64',
  'pkg:npm/%40img/sharp-libvips-linux-ppc64',
  'pkg:npm/%40img/sharp-libvips-linux-riscv64',
  'pkg:npm/%40img/sharp-libvips-linux-s390x',
  'pkg:npm/%40img/sharp-libvips-linux-x64',
  'pkg:npm/%40img/sharp-libvips-linuxmusl-arm64',
  'pkg:npm/%40img/sharp-libvips-linuxmusl-x64',
  'pkg:npm/%40img/sharp-wasm32',
  'pkg:npm/%40img/sharp-win32-arm64',
  'pkg:npm/%40img/sharp-win32-ia32',
  'pkg:npm/%40img/sharp-win32-x64',
];

function writeManifest(packagesRoot, relativeDirectory, manifest) {
  const directory = path.join(packagesRoot, relativeDirectory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
}

describe('dependency-review first-party license exemptions', () => {
  it('derives sorted canonical PURLs from exact-license manifests at any nesting depth', () => {
    const root = makeTemp('robota-license-exemptions-');
    const packagesRoot = path.join(root, 'packages');
    writeManifest(packagesRoot, 'z-package', {
      name: '@robota-sdk/z-package',
      license: DUAL_LICENSE,
    });
    writeManifest(packagesRoot, 'group/a-package', {
      name: '@robota-sdk/a-package',
      license: DUAL_LICENSE,
    });
    writeManifest(packagesRoot, 'not-selected', {
      name: '@robota-sdk/not-selected',
      license: 'MIT',
    });

    expect(deriveDependencyReviewLicenseExemptions(packagesRoot)).toEqual([
      'pkg:npm/%40robota-sdk/a-package',
      'pkg:npm/%40robota-sdk/z-package',
    ]);
  });

  it('rejects a selected manifest whose name is outside the Robota npm scope', () => {
    const root = makeTemp('robota-license-exemptions-name-');
    const packagesRoot = path.join(root, 'packages');
    writeManifest(packagesRoot, 'foreign', {
      name: '@third-party/foreign',
      license: DUAL_LICENSE,
    });

    expect(() => deriveDependencyReviewLicenseExemptions(packagesRoot)).toThrow(
      /field "name" expected canonical @robota-sdk\/<name>; received "@third-party\/foreign"/,
    );
  });

  it('rejects a selected manifest whose package name is missing', () => {
    const root = makeTemp('robota-license-exemptions-missing-name-');
    const packagesRoot = path.join(root, 'packages');
    writeManifest(packagesRoot, 'unnamed', { license: DUAL_LICENSE });

    expect(() => deriveDependencyReviewLicenseExemptions(packagesRoot)).toThrow(
      /field "name" expected canonical @robota-sdk\/<name>; received undefined/,
    );
  });

  it('rejects duplicate selected package identities', () => {
    const root = makeTemp('robota-license-exemptions-duplicate-');
    const packagesRoot = path.join(root, 'packages');
    const manifest = { name: '@robota-sdk/duplicate', license: DUAL_LICENSE };
    writeManifest(packagesRoot, 'first', manifest);
    writeManifest(packagesRoot, 'nested/second', manifest);

    expect(() => deriveDependencyReviewLicenseExemptions(packagesRoot)).toThrow(
      /duplicate selected package identity "@robota-sdk\/duplicate"/,
    );
  });

  it('fails closed when no manifest matches the owned dual license', () => {
    const root = makeTemp('robota-license-exemptions-empty-');
    const packagesRoot = path.join(root, 'packages');
    writeManifest(packagesRoot, 'mit-only', {
      name: '@robota-sdk/mit-only',
      license: 'MIT',
    });

    expect(() => deriveDependencyReviewLicenseExemptions(packagesRoot)).toThrow(
      /selected population is empty/,
    );
  });

  it('identifies a malformed manifest instead of treating it as absent', () => {
    const root = makeTemp('robota-license-exemptions-json-');
    const packagesRoot = path.join(root, 'packages');
    const directory = path.join(packagesRoot, 'broken');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), '{broken', 'utf8');

    expect(() => deriveDependencyReviewLicenseExemptions(packagesRoot)).toThrow(
      /broken[/\\]package\.json: invalid JSON; expected a package manifest object/,
    );
  });

  it('fails closed when a discovered manifest cannot be read', () => {
    const root = makeTemp('robota-license-exemptions-read-');
    const packagesRoot = path.join(root, 'packages');
    writeManifest(packagesRoot, 'unreadable', {
      name: '@robota-sdk/unreadable',
      license: DUAL_LICENSE,
    });

    expect(() =>
      deriveDependencyReviewLicenseExemptions(packagesRoot, {
        readFile: () => {
          throw new Error('EACCES fixture');
        },
      }),
    ).toThrow(/could not read manifest; expected readable UTF-8 JSON; received EACCES fixture/);
  });

  it('rejects JSON whose root is not a package manifest object', () => {
    const root = makeTemp('robota-license-exemptions-shape-');
    const packagesRoot = path.join(root, 'packages');
    writeManifest(packagesRoot, 'null-root', null);

    expect(() => deriveDependencyReviewLicenseExemptions(packagesRoot)).toThrow(
      /field "root" expected object; received null/,
    );
  });

  it('does not traverse symlinked directories', () => {
    const root = makeTemp('robota-license-exemptions-symlink-');
    const packagesRoot = path.join(root, 'packages');
    writeManifest(packagesRoot, 'selected', {
      name: '@robota-sdk/selected',
      license: DUAL_LICENSE,
    });
    const external = path.join(root, 'external');
    mkdirSync(external, { recursive: true });
    writeFileSync(path.join(external, 'package.json'), '{malformed-if-followed', 'utf8');
    symlinkSync(external, path.join(packagesRoot, 'linked-directory'), 'dir');

    expect(deriveDependencyReviewLicenseExemptions(packagesRoot)).toEqual([
      'pkg:npm/%40robota-sdk/selected',
    ]);
  });

  it('covers the complete live exact-license population without freezing its size', () => {
    const packagesRoot = path.join(REPO_ROOT, 'packages');
    const expected = globSync('**/package.json', { cwd: packagesRoot })
      .map((relativePath) =>
        JSON.parse(readFileSync(path.join(packagesRoot, relativePath), 'utf8')),
      )
      .filter((manifest) => manifest.license === DUAL_LICENSE)
      .map((manifest) => {
        const [scope, packageName] = manifest.name.split('/');
        return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}`;
      })
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

    expect(expected.length).toBeGreaterThan(0);
    expect(deriveDependencyReviewLicenseExemptions(packagesRoot)).toEqual(expected);
  });
});

describe('the GitHub Actions output boundary', () => {
  it('writes the complete comma-separated set as one step output', () => {
    const root = makeTemp('robota-license-exemptions-output-');
    const outputPath = path.join(root, 'github-output');

    writeDependencyReviewLicenseExemptionsOutput(
      ['pkg:npm/%40robota-sdk/a', 'pkg:npm/%40robota-sdk/b'],
      outputPath,
    );

    expect(readFileSync(outputPath, 'utf8')).toBe(
      'purls=pkg:npm/%40robota-sdk/a,pkg:npm/%40robota-sdk/b\n',
    );
  });

  it('rejects a missing GitHub output target before writing', () => {
    expect(() =>
      writeDependencyReviewLicenseExemptionsOutput(['pkg:npm/%40robota-sdk/a'], undefined),
    ).toThrow(/\$GITHUB_OUTPUT: field "path" expected non-empty string; received undefined/);
  });

  it('writes the live derived set when the module runs as a workflow command', () => {
    const root = makeTemp('robota-license-exemptions-cli-');
    const outputPath = path.join(root, 'github-output');
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(outputPath, 'utf8')).toBe(
      `purls=${deriveDependencyReviewLicenseExemptions(path.join(REPO_ROOT, 'packages')).join(',')}\n`,
    );
  });

  it('exits non-zero without partial output when the workflow target is missing', () => {
    const env = { ...process.env };
    delete env.GITHUB_OUTPUT;
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '$GITHUB_OUTPUT: field "path" expected non-empty string; received undefined',
    );
    expect(result.stdout).toBe('');
  });

  it('does not create a partial output file when manifest derivation fails', () => {
    const root = makeTemp('robota-license-exemptions-partial-');
    const packagesRoot = path.join(root, 'packages');
    const outputPath = path.join(root, 'github-output');
    const directory = path.join(packagesRoot, 'broken');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), '{broken', 'utf8');

    expect(() => main({ packagesRoot, outputPath })).toThrow(/invalid JSON/);
    expect(existsSync(outputPath)).toBe(false);
  });
});

describe('the live dependency-review workflow contract', () => {
  it('runs the generator before dependency review and consumes its step output', () => {
    const generatorStep = WORKFLOW.indexOf('id: robota-license-exemptions');
    const dependencyReviewStep = WORKFLOW.indexOf('uses: actions/dependency-review-action@v5');

    expect(generatorStep, `${WORKFLOW_RELATIVE} must declare the generator step`).toBeGreaterThan(
      -1,
    );
    expect(generatorStep).toBeLessThan(dependencyReviewStep);
    expect(WORKFLOW).toContain(
      'run: node scripts/harness/generate-dependency-review-license-exemptions.mjs',
    );
    expect(WORKFLOW).toContain('${{ steps.robota-license-exemptions.outputs.purls }}');
  });

  it('replaces every hard-coded Robota PURL while preserving the complete sharp family', () => {
    const hardCodedRobotaPurls = [
      ...WORKFLOW.matchAll(/pkg:npm\/%40robota-sdk\/[a-z0-9._-]+/g),
    ].map(([purl]) => purl);
    const sharpPurls = [...WORKFLOW.matchAll(/pkg:npm\/%40img\/sharp[a-z0-9._/-]*/g)].map(
      ([purl]) => purl,
    );

    expect(hardCodedRobotaPurls).toEqual([]);
    expect(sharpPurls).toEqual(STATIC_SHARP_PURLS);
  });

  it('runs when manifests, the generator, or the workflow contract changes', () => {
    expect(WORKFLOW).toContain("- '**/package.json'");
    expect(WORKFLOW).toContain(
      "- 'scripts/harness/generate-dependency-review-license-exemptions.mjs'",
    );
    expect(WORKFLOW).toContain("- '.github/workflows/dependency-review.yml'");
  });

  it('preserves the global policy and non-license security inputs', () => {
    expect(WORKFLOW).toContain('fail-on-severity: high');
    expect(WORKFLOW).toContain('fail-on-scopes: runtime, development');
    expect(WORKFLOW).toContain('allow-ghsas: GHSA-mh99-v99m-4gvg');
    expect(WORKFLOW).toContain(
      'allow-licenses: 0BSD, Apache-2.0, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, CC-BY-4.0, CC0-1.0, ISC, MIT, MIT-0, MPL-2.0, Python-2.0, Unlicense, WTFPL',
    );
    expect(WORKFLOW).toContain('comment-summary-in-pr: on-failure');
  });
});
