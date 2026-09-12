import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { assembleGeneration, pinGeneration } from '../generation.mjs';
import { createManifest } from '../manifest.mjs';

const available = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0;

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
    await buildBunBinaryGeneration(${JSON.stringify(root)}, [${JSON.stringify(target)}]);
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
