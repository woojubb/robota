import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { assertStandaloneNativeRuntime } from '../../../packages/agent-cli/scripts/e2e-native-file-authority.mjs';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { assembleGeneration, pinGeneration } from '../generation.mjs';
import { createManifest } from '../manifest.mjs';

const available = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0;

it('refuses standalone evidence beneath any node_modules ancestor', () => {
  const root = realpathSync(makeTemp('robota-bun-standalone-refusal-'));
  const binaryDirectory = path.join(root, 'node_modules', 'fixture');
  mkdirSync(binaryDirectory, { recursive: true });

  expect(() => assertStandaloneNativeRuntime(path.join(binaryDirectory, 'robota'))).toThrow(
    /node_modules ancestor/u,
  );
});

it.skipIf(!available)(
  'compiles a real Bun binary without mutating the sealed Node generation',
  async () => {
    const root = realpathSync(makeTemp('robota-bun-variant-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        version: '1.2.3',
        robota: { artifact: { builder: 'tsdown', variants: { bun: { output: 'dist-bun' } } } },
      }),
    );
    const contents = 'process.stdout.write("binary-fixture");';
    const node = await assembleGeneration(root, async ({ outputRoot }) => {
      mkdirSync(path.join(outputRoot, 'node'));
      writeFileSync(path.join(outputRoot, 'node/bin.js'), contents);
      return createManifest([{ path: 'node/bin.js', contents }]);
    });
    const moduleUrl = new URL('../../../packages/agent-cli/scripts/build-bun.mjs', import.meta.url)
      .href;
    const target = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
    const child = spawnSync(
      'bun',
      [
        '--eval',
        `
    import { buildBunBinaryGeneration } from ${JSON.stringify(moduleUrl)};
    await buildBunBinaryGeneration(${JSON.stringify(root)}, ${JSON.stringify(target)});
  `,
      ],
      { encoding: 'utf8' },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(pinGeneration(root)).toEqual(node);
    const binary = pinGeneration(root, { outputName: 'dist-bun' });
    expect(binary.manifest.files).toHaveLength(1);
    const run = spawnSync(path.join(binary.root, binary.manifest.files[0].path), [], {
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe('binary-fixture');
  },
  30000,
);

it.skipIf(!available)(
  'rejects mismatched and unsupported targets before changing a binary generation',
  async () => {
    const root = realpathSync(makeTemp('robota-bun-refusal-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        version: '1.2.3',
        robota: { artifact: { builder: 'tsdown', variants: { bun: { output: 'dist-bun' } } } },
      }),
    );
    await assembleGeneration(root, async ({ outputRoot }) => {
      mkdirSync(path.join(outputRoot, 'node'));
      const contents = 'process.stdout.write("binary-fixture");';
      writeFileSync(path.join(outputRoot, 'node/bin.js'), contents);
      return createManifest([{ path: 'node/bin.js', contents }]);
    });
    const previous = await assembleGeneration(
      root,
      async ({ outputRoot }) => {
        const contents = 'previous-binary';
        writeFileSync(path.join(outputRoot, 'robota-previous'), contents);
        return createManifest([{ path: 'robota-previous', contents }]);
      },
      { outputName: 'dist-bun' },
    );
    const before = readdirSync(path.join(root, '.robota-artifacts')).sort();
    const moduleUrl = new URL('../../../packages/agent-cli/scripts/build-bun.mjs', import.meta.url)
      .href;
    const hostTarget = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
    const mismatch = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'windows-x64'].find(
      (target) => target !== hostTarget,
    );

    for (const target of [mismatch, 'all', 'freebsd-x64']) {
      const child = spawnSync(
        'bun',
        [
          '--eval',
          `
      import { buildBunBinaryGeneration } from ${JSON.stringify(moduleUrl)};
      await buildBunBinaryGeneration(${JSON.stringify(root)}, ${JSON.stringify(target)});
    `,
        ],
        { encoding: 'utf8' },
      );
      expect(child.status, `target=${target}\n${child.stdout}\n${child.stderr}`).not.toBe(0);
      expect(pinGeneration(root, { outputName: 'dist-bun' }).id).toBe(previous.id);
      expect(readdirSync(path.join(root, '.robota-artifacts')).sort()).toEqual(before);
    }

    const { bunTargetForHost } = await import(moduleUrl);
    for (const [platform, arch] of [
      ['freebsd', 'x64'],
      ['linux', 'ppc64'],
      ['win32', 'arm64'],
      ['darwin', 'ia32'],
    ]) {
      expect(() => bunTargetForHost(platform, arch)).toThrow(/unsupported/u);
    }
  },
  30000,
);
