import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { assembleGeneration, pinGeneration } from '../generation.mjs';
import { createManifest } from '../manifest.mjs';

const repository = path.resolve(import.meta.dirname, '../../..');

it.each(['dag-builder', 'dag-framework'])(
  '%s typechecking keeps incremental state outside its sealed artifact',
  async (name) => {
    const root = realpathSync(makeTemp('robota-typecheck-cache-'));
    const config = JSON.parse(
      readFileSync(path.join(repository, 'packages', name, 'tsconfig.json'), 'utf8'),
    );
    mkdirSync(path.join(root, 'src'));
    const source = path.join(root, 'src/index.ts');
    writeFileSync(source, 'export const value: number = 42;');
    writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        ...config,
        extends: path.join(repository, 'tsconfig.base.json'),
      }),
    );
    const before = await assembleGeneration(root, async ({ outputRoot }) => {
      mkdirSync(path.join(outputRoot, 'node'));
      const contents = 'export const value = 42;';
      writeFileSync(path.join(outputRoot, 'node/index.js'), contents);
      return createManifest([{ path: 'node/index.js', contents }]);
    });
    const typecheck = () =>
      spawnSync(
        path.join(repository, 'node_modules/.bin/tsgo'),
        ['-p', 'tsconfig.json', '--noEmit'],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 15000,
        },
      );
    const success = typecheck();
    expect(success.status, success.stdout + success.stderr).toBe(0);
    expect(pinGeneration(root)).toEqual(before);
    expect(existsSync(path.resolve(root, config.compilerOptions.tsBuildInfoFile))).toBe(true);

    writeFileSync(source, 'export const value: number = "invalid";');
    const failure = typecheck();
    expect(failure.status, failure.stdout + failure.stderr).not.toBe(0);
    expect(failure.stdout).toContain('TS2322');
    expect(pinGeneration(root)).toEqual(before);
  },
  30000,
);
