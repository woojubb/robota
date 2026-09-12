import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { assembleGeneration } from '../generation.mjs';
import { createManifest, verifyManifest } from '../manifest.mjs';
import { materializeGeneration } from '../generation-image.mjs';

it('copies the pinned expected generation into a new ordinary directory without admitting extra files', async () => {
  const owner = realpathSync(makeTemp('robota-generation-image-'));
  const generation = await assembleGeneration(owner, async ({ outputRoot }) => {
    writeFileSync(path.join(outputRoot, 'index.js'), 'expected');
    return createManifest([{ path: 'index.js', contents: 'expected' }]);
  });
  const destination = path.join(owner, 'image');
  materializeGeneration(generation, destination);
  expect(readFileSync(path.join(destination, 'index.js'), 'utf8')).toBe('expected');
  expect(() => verifyManifest(destination, generation.manifest)).not.toThrow();
  expect(() => materializeGeneration(generation, destination)).toThrow(/exist/);
  writeFileSync(path.join(generation.root, 'obsolete.js'), 'stale');
  expect(() => materializeGeneration(generation, path.join(owner, 'stale-image'))).toThrow(
    /unexpected/,
  );
});
