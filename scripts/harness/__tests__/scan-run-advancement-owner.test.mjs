import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { inspectRunAdvancementOwnership } from '../scan-run-advancement-owner.mjs';

const DECLARATION = 'worker.ts';
const OWNER = 'coordinator.ts';
const EXPECTED = { declarationFile: DECLARATION, ownerFile: OWNER };

function inspect(extra = {}) {
  const sources = {
    [DECLARATION]: 'class WorkerLoopService { processOnce() {} }',
    [OWNER]: "type Step = Pick<WorkerLoopService, 'processOnce'>; step.processOnce();",
    ...extra,
  };
  return inspectRunAdvancementOwnership(Object.keys(sources), (file) => sources[file], EXPECTED);
}

describe('scan-run-advancement-owner', () => {
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
