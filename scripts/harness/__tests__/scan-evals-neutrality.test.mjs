import { describe, expect, it } from 'vitest';

import {
  findEvalsContentInSource,
  findEvalsNeutralityFindings,
  isEvalsDatasetContent,
  inEvalsSubsystem,
} from '../scan-evals-neutrality.mjs';

/**
 * HARNESS-034 — the evals-neutrality mechanical floor (TC-05 guardian for SELFHOST-011).
 *
 * TC-01: dataset/corpus DATA file class (path/name predicate).
 * TC-02: concrete metric/definition VALUE class; the neutral type/factory surface is NOT flagged.
 * TC-03: suppression + anti-rot (v1 = reason-less-only).
 * TC-04: the live packages/ tree is GREEN.
 */

function kinds(src) {
  return findEvalsContentInSource(src).map((f) => f.kind);
}

describe('HARNESS-034 TC-01 — evals-dataset-content file-path class', () => {
  it('flags a data-file corpus under an /evals/ dir or with a corpus-marked basename', () => {
    expect(isEvalsDatasetContent('packages/agent-framework/src/evals/cases.json')).toBe(true);
    expect(isEvalsDatasetContent('packages/agent-framework/src/evals/dataset.jsonl')).toBe(true);
    expect(isEvalsDatasetContent('packages/foo/src/coding.evalset.json')).toBe(true);
    expect(isEvalsDatasetContent('packages/foo/src/x.cases.yaml')).toBe(true);
  });

  it('does NOT flag the neutral TS surface or unrelated data files', () => {
    expect(isEvalsDatasetContent('packages/agent-framework/src/evals/runner.ts')).toBe(false);
    expect(isEvalsDatasetContent('packages/agent-framework/src/evals/metric-helpers.ts')).toBe(
      false,
    );
    // a plain package.json / config json outside /evals/ and without a corpus marker is not content
    expect(isEvalsDatasetContent('packages/agent-framework/package.json')).toBe(false);
    expect(isEvalsDatasetContent('packages/agent-framework/src/config/settings.json')).toBe(false);
  });
});

describe('HARNESS-034 TC-02 — library-eval-content value class', () => {
  it('flags a checked-in case-corpus array, a concrete IEvalDefinition, and a concrete IMetric value', () => {
    expect(kinds(`export const cases = [{ input: 'a', expected: 'b' }];`)).toContain(
      'library-eval-content',
    );
    expect(kinds(`export const codingDataset = [\n  { input: 'x' },\n];`)).toContain(
      'library-eval-content',
    );
    expect(
      kinds(`export const codingEval: IEvalDefinition = { cases, metrics, threshold: 0.8 };`),
    ).toContain('library-eval-content');
    expect(
      kinds(
        `export const exactAnswer: IMetric = { name: 'exact', score: (r) => r.response === '42' };`,
      ),
    ).toContain('library-eval-content');
  });

  it('does NOT flag the neutral mechanism — the IMetric TYPE, factories, or the runner contract', () => {
    // parameterized factory (declared as a function returning IMetric) — the neutral surface
    expect(kinds(`export function exactMatch(expected?: string): IMetric {`)).not.toContain(
      'library-eval-content',
    );
    // the type/interface itself
    expect(
      kinds(`export interface IMetric {\n  score(result: IExecutionResult): number | boolean;\n}`),
    ).not.toContain('library-eval-content');
    // runner takes IEvalDefinition as a PARAM, does not export a value of it
    expect(
      kinds(`export async function runEval(def: IEvalDefinition, runFn: TEvalRunFn) {`),
    ).not.toContain('library-eval-content');
  });
});

describe('HARNESS-034 TC-03 — suppression + anti-rot', () => {
  it('suppresses a flagged value with an adjacent allow-evals-content: <reason>', () => {
    const src = [
      '// allow-evals-content: neutral reference definition used by the runner self-test',
      `export const selfTestEval: IEvalDefinition = { cases, metrics };`,
    ].join('\n');
    expect(kinds(src)).not.toContain('library-eval-content');
  });

  it('fails a reason-less allow-evals-content annotation (anti-rot)', () => {
    expect(kinds('// allow-evals-content\nconst x = 1;')).toContain('reasonless-annotation');
  });
});

describe('HARNESS-034 TC-04 — live packages/ tree is neutral', () => {
  it('produces no findings on the current tree', () => {
    expect(findEvalsNeutralityFindings()).toEqual([]);
  });

  it('inEvalsSubsystem detects the /evals/ directory segment', () => {
    expect(inEvalsSubsystem('packages/agent-framework/src/evals/runner.ts')).toBe(true);
    expect(inEvalsSubsystem('packages/agent-framework/src/runtime/agent-runtime.ts')).toBe(false);
  });
});
