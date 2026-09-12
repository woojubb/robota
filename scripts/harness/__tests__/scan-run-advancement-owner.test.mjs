import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { inspectRunAdvancementOwnership } from '../scan-run-advancement-owner.mjs';
import { makeTemp } from './make-temp.mjs';

const DECLARATION = 'worker.ts';
const OWNER = 'coordinator.ts';
const EXPECTED = { declarationFile: DECLARATION, ownerFile: OWNER };

function scanFixture(root) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../scan-run-advancement-owner.mjs', import.meta.url))],
    { cwd: root, encoding: 'utf8' },
  );
}

function inspect(extra = {}) {
  const sources = {
    [DECLARATION]: 'class WorkerLoopService { processOnce() {} }',
    [OWNER]: "type Step = Pick<WorkerLoopService, 'processOnce'>; step.processOnce();",
    ...extra,
  };
  return inspectRunAdvancementOwnership(Object.keys(sources), (file) => sources[file], EXPECTED);
}

describe('scan-run-advancement-owner', () => {
  it('ignores stored declarations without hiding real unauthorized callers', () => {
    const root = makeTemp('robota-run-advancement-storage-');
    const declarationFile = path.join(
      'packages',
      'dag-worker',
      'src/services/worker-loop-service.ts',
    );
    const ownerFile = path.join(
      'packages',
      'dag-worker',
      'src/services/run-advancement-coordinator.ts',
    );
    const sources = {
      [declarationFile]: 'class WorkerLoopService { processOnce() {} }',
      [ownerFile]: 'worker.processOnce();',
      'packages/dag-cli/src/direct.ts': 'worker.processOnce();',
      'packages/dag-cli/.robota-artifacts-source/direct.ts': 'worker.processOnce();',
      'packages/dag-worker/.robota-artifacts/generation/previous-dist/node/index.d.ts':
        'declare class WorkerLoopService { processOnce(): void; }',
    };
    for (const [relative, source] of Object.entries(sources)) {
      const target = path.join(root, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    const result = scanFixture(root);
    const errors = result.stderr.split(path.sep).join('/');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::examined:: 4 production TypeScript files');
    expect(errors).toContain('2 finding(s)');
    expect(errors).toContain('packages/dag-cli/.robota-artifacts-source/direct.ts:1 [call]');
    expect(errors).toContain('packages/dag-cli/src/direct.ts:1 [call]');
    expect(errors).not.toContain('/.robota-artifacts/');
    expect(errors).not.toContain('canonical-');
  });

  it('the existing CLI fails closed when its fixture has no governed source tree', () => {
    const result = scanFixture(makeTemp('robota-run-advancement-empty-'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no production TypeScript files found');
    expect(result.stdout).not.toContain('scan passed');
  });

  it('accepts exactly one declaration and one coordinator call', () => {
    expect(inspect().findings).toEqual([]);
  });

  it('rejects a direct call in another production consumer', () => {
    expect(
      inspect({ 'prompt-backend.ts': 'execution.workerLoop.processOnce();' }).findings,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'prompt-backend.ts', kind: 'call' }),
      ]),
    );
  });

  it('rejects bracket calls and extracted aliases', () => {
    const found = inspect({
      'local-runner.ts': "loop['processOnce'](); const { processOnce } = loop; processOnce();",
    }).findings;
    expect(found.some((finding) => finding.file === 'local-runner.ts')).toBe(true);
  });

  it('fails closed when the canonical owner call disappears', () => {
    const result = inspect({ [OWNER]: "type Step = Pick<WorkerLoopService, 'processOnce'>;" });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: 'canonical-owner-call-count', count: 0 }),
    );
  });

  it('is registered and passes against production source', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const output = execFileSync('node', ['scripts/harness/scan-run-advancement-owner.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(output).toContain('::examined::');
    expect(output).toContain('run-advancement-owner scan passed');
  });
});
