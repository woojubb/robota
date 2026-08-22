import { globSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DUAL_LICENSE,
  deriveDependencyReviewLicenseExemptions,
} from '../generate-dependency-review-license-exemptions.mjs';
import { makeTemp } from './make-temp.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

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
