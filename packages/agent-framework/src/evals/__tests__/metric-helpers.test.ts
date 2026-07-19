import { describe, expect, it } from 'vitest';

import { parseEvalCases } from '../dataset.js';
import { formatEvalReport } from '../format.js';
import {
  exactMatch,
  includesText,
  regexMatch,
  responseIsJson,
  usedTool,
} from '../metric-helpers.js';
import { runEval } from '../runner.js';

import type { IEvalCase, TEvalRunFn } from '../eval-types.js';
import type { IExecutionResult, IToolSummary } from '../../interactive/types.js';

/** SELFHOST-011 P3 — neutral metric helpers + dataset parser + shared formatter. */

function result(response: string, toolSummaries: IToolSummary[] = []): IExecutionResult {
  return {
    response,
    history: [],
    toolSummaries,
    contextState: { maxTokens: 0, usedTokens: 0, usedPercentage: 0, remainingPercentage: 0 },
  };
}

describe('metric helpers — mechanism only, over IExecutionResult (TC-01)', () => {
  it('includesText / regexMatch / responseIsJson / usedTool', () => {
    expect(includesText('index.ts').score(result('see index.ts'))).toBe(true);
    expect(includesText('nope').score(result('see index.ts'))).toBe(false);
    expect(regexMatch(/^\d+$/).score(result('42'))).toBe(true);
    expect(regexMatch(/^\d+$/).score(result('4a'))).toBe(false);
    expect(responseIsJson().score(result('{"a":1}'))).toBe(true);
    expect(responseIsJson().score(result('not json'))).toBe(false);
    const wrote: IToolSummary = { name: 'Write', args: '{}' };
    expect(usedTool('Write').score(result('', [wrote]))).toBe(true);
    expect(usedTool('Read').score(result('', [wrote]))).toBe(false);
  });

  it('exactMatch works as a closure (fixed expected) AND per-case (reads evalCase.expected)', () => {
    // closure form
    expect(exactMatch('yes').score(result('yes'))).toBe(true);
    expect(exactMatch('yes', { trim: false }).score(result(' yes '))).toBe(false);
    // per-case form: no closure arg → reads the threaded eval case's `expected`
    const perCase = exactMatch();
    const caseA: IEvalCase = { input: 'q', expected: 'A' };
    expect(perCase.score(result('A'), caseA)).toBe(true);
    expect(perCase.score(result('B'), caseA)).toBe(false);
    expect(perCase.score(result('A'))).toBe(false); // no expected anywhere → false
  });

  it('runEval threads each case into exactMatch() so per-case expected scores correctly (contract fix)', async () => {
    const cases = parseEvalCases(
      '[{"input":"a","expected":"A"},{"input":"b","expected":"B"}]',
      'json',
    );
    const runFn: TEvalRunFn = (input) => Promise.resolve(result(input === 'a' ? 'A' : 'B'));
    const report = await runEval({ cases, metrics: [exactMatch()], threshold: 1 }, runFn);
    expect(report.passed).toBe(true); // each case matched its OWN expected
  });
});

describe('parseEvalCases (TC-02)', () => {
  it('parses json + jsonl into IEvalCase[]', () => {
    expect(parseEvalCases('[{"input":"a","expected":"x"},{"input":"b"}]', 'json')).toEqual([
      { input: 'a', expected: 'x' },
      { input: 'b' },
    ]);
    expect(parseEvalCases('{"input":"a"}\n\n{"input":"b","expected":"y"}\n', 'jsonl')).toEqual([
      { input: 'a' },
      { input: 'b', expected: 'y' },
    ]);
  });

  it('throws on malformed input (missing string input / non-array json / non-string expected)', () => {
    expect(() => parseEvalCases('[{"expected":"x"}]', 'json')).toThrow(/input/);
    expect(() => parseEvalCases('{"input":"a"}', 'json')).toThrow(/array/);
    expect(() => parseEvalCases('not json', 'jsonl')).toThrow();
    // present-but-wrong-typed expected is malformed, not silently dropped (review CONSIDER)
    expect(() => parseEvalCases('[{"input":"a","expected":123}]', 'json')).toThrow(/expected/);
  });
});

describe('regexMatch — stateless across cases (review CONSIDER)', () => {
  it('a /g-flagged pattern scores consistently case-to-case (no lastIndex leak)', () => {
    const m = regexMatch(/\d+/g);
    // Called repeatedly as the runner would; each is independent.
    expect(m.score(result('42'))).toBe(true);
    expect(m.score(result('7'))).toBe(true);
    expect(m.score(result('99'))).toBe(true);
  });
});

describe('formatEvalReport (TC-03)', () => {
  it('renders per-case lines + an overall PASS/FAIL line', async () => {
    const runFn: TEvalRunFn = () => Promise.resolve(result('ok'));
    const report = await runEval(
      { name: 'demo', cases: [{ input: 'q' }], metrics: [includesText('ok')], threshold: 1 },
      runFn,
    );
    const text = formatEvalReport(report);
    expect(text).toContain('Eval: demo');
    expect(text).toContain('case 1');
    expect(text).toContain('→ PASS');
  });
});
