import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { packVerifiedPackage } from '../pack.mjs';
import { packAll, writeConsumerManifest } from '../../external-proof/run-external-proof.mjs';

vi.mock('../pack.mjs', () => ({ packVerifiedPackage: vi.fn() }));

test('the external consumer proof routes tarballs through the pinned verified pack owner', () => {
  const source = readFileSync(
    new URL('../../external-proof/run-external-proof.mjs', import.meta.url),
    'utf8',
  );
  expect(source).toContain("import { packVerifiedPackage } from '../artifacts/pack.mjs'");
  expect(source).toContain('await packVerifiedPackage(');
  expect(source).not.toContain("run('pnpm', ['pack'");
});

test('external proof consumes returned paths, awaits the pack boundary, and propagates its failure', async () => {
  const root = makeTemp('robota-pack-external-');
  const manifests = new Map([['@example/one', { dir: path.join(root, 'one') }]]);
  const versions = new Map([['@example/one', '1.0.0']]);
  const tarballPath = path.join(root, 'verified.tgz');
  vi.mocked(packVerifiedPackage).mockResolvedValueOnce({ tarballPath });
  expect(await packAll(['@example/one'], manifests, path.join(root, 'tarballs'), versions)).toEqual(
    new Map([['@example/one', tarballPath]]),
  );
  expect(packVerifiedPackage).toHaveBeenCalledWith(
    path.join(root, 'one'),
    expect.objectContaining({ workspaceVersions: versions }),
  );
  vi.mocked(packVerifiedPackage).mockRejectedValueOnce(new Error('manifest mismatch'));
  await expect(
    packAll(['@example/one'], manifests, path.join(root, 'tarballs'), versions),
  ).rejects.toThrow('manifest mismatch');
});

test('file dependencies and overrides resolve from the physical consumer directory through a lexical symlink', () => {
  const root = realpathSync(makeTemp('robota-pack-external-paths-'));
  const physicalWorkdir = path.join(root, 'physical/work');
  mkdirSync(path.join(physicalWorkdir, 'consumer'), { recursive: true });
  mkdirSync(path.join(physicalWorkdir, 'tarballs'));
  const alias = path.join(root, 'alias');
  symlinkSync(physicalWorkdir, alias, 'junction');
  const consumerDir = path.join(alias, 'consumer');
  const tarballPath = path.join(physicalWorkdir, 'tarballs/package.tgz');
  writeFileSync(tarballPath, 'verified tarball bytes');

  writeConsumerManifest(consumerDir, new Map([['@example/package', tarballPath]]));

  const manifest = JSON.parse(readFileSync(path.join(consumerDir, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'overrides']) {
    const spec = manifest[field]['@example/package'];
    expect(spec.startsWith('file:')).toBe(true);
    const resolved = path.resolve(realpathSync(consumerDir), spec.slice('file:'.length));
    expect(resolved).toBe(realpathSync(tarballPath));
    expect(readFileSync(resolved, 'utf8')).toBe('verified tarball bytes');
  }
});
