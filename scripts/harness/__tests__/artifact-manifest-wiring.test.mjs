import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const manifests = globSync(['packages/*/package.json', 'packages/dag-nodes/*/package.json'], {
  cwd: root,
  follow: false,
  ignore: ['**/node_modules/**'],
})
  .sort()
  .map((file) => ({ file, value: JSON.parse(readFileSync(path.join(root, file), 'utf8')) }));

describe('complete artifact manifest wiring (ARTIFACT-2655)', () => {
  it('routes all 31 compiler-watch dev owners through complete assembly, excluding product dev servers', () => {
    const watchOwners = manifests.filter(
      ({ value }) =>
        /^(?:tsup|tsdown)\b.*--watch/u.test(value.scripts?.dev ?? '') ||
        value.scripts?.dev?.endsWith('/scripts/artifacts/watch-package.mjs'),
    );
    expect(watchOwners).toHaveLength(31);
    for (const { file, value } of watchOwners) {
      expect(value.name).not.toBe('@robota-sdk/agent-cli');
      const relativeRoot = path
        .relative(path.dirname(path.join(root, file)), root)
        .split(path.sep)
        .join('/');
      expect(value.scripts.dev, file).toBe(
        `node ${relativeRoot}/scripts/artifacts/watch-package.mjs`,
      );
    }
    expect(
      manifests.find(({ value }) => value.name === '@robota-sdk/agent-cli').value.scripts.dev,
    ).toMatch(/^tsx\b/u);
    expect(
      manifests.find(({ value }) => value.name === '@robota-sdk/agent-cli-web').value.scripts.dev,
    ).toMatch(/^vite\b/u);
  });
  it('ignores package generation storage and interrupted publication pointers', () => {
    const lines = readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n');
    expect(lines).toContain('.robota-artifacts/');
    expect(lines).toContain('packages/**/.dist-*');
  });

  it('routes every package build alias through the complete assembly entrypoint', () => {
    expect(manifests.length).toBeGreaterThan(0);
    for (const { file, value } of manifests) {
      const relativeRoot = path
        .relative(path.dirname(path.join(root, file)), root)
        .split(path.sep)
        .join('/');
      expect(value.scripts.build, file).toBe(
        `node ${relativeRoot}/scripts/artifacts/build-package.mjs`,
      );
      expect(value.scripts['build:js'], file).toBe('pnpm run build');
      expect(value.scripts['build:types'], file).toBe('pnpm run build');
      expect(value.scripts.prepack, file).toBe(
        `node ${relativeRoot}/scripts/artifacts/pack-guard.mjs`,
      );
      expect(value.robota?.artifact?.builder, file).toBe(
        value.name === '@robota-sdk/agent-cli-web' ? 'vite' : 'tsdown',
      );
    }
    expect(
      manifests.find(({ value }) => value.name === '@robota-sdk/agent-cli').value.robota.artifact
        .copies,
    ).toEqual([{ package: '@robota-sdk/agent-cli-web', target: 'web' }]);
    const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(manifest.scripts.build).toBe(
      'node scripts/artifacts/build-workspace.mjs && node scripts/build-agent-app-if-full.mjs',
    );
  });
});
