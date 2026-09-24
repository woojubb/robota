import { expect, it } from 'vitest';
import { resolveDagExecutionByteLimits } from '../types/execution-byte-limits.js';

it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER, 4_194_305])('rejects invalid trusted limit %s', (maxTextRepeatOutputBytes) => {
  expect(() => resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes })).toThrow(RangeError);
});

it('snapshots and freezes host ceilings including zero', () => {
  const source = { maxTextRepeatOutputBytes: 0 };
  const limits = resolveDagExecutionByteLimits(source);
  source.maxTextRepeatOutputBytes = 1;
  expect(limits.maxTextRepeatOutputBytes).toBe(0);
  expect(Object.isFrozen(limits)).toBe(true);
});

it.each([null, undefined])('rejects an explicitly supplied nullish limit %s', (maxTextRepeatOutputBytes) => {
  // JavaScript hosts can violate the TypeScript contract at runtime.
  // @ts-expect-error Exercise invalid runtime host policy.
  expect(() => resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes })).toThrow(RangeError);
});

it('uses the default only when the policy is omitted', () => {
  expect(resolveDagExecutionByteLimits().maxTextRepeatOutputBytes).toBe(4_194_304);
});

it.each([NaN, Infinity, -1, 0.5, 4_194_305, null, undefined])('rejects an invalid literal replacement limit %s', (maxTextReplaceOutputBytes) => {
  // @ts-expect-error intentionally exercise malformed JavaScript host policy
  expect(() => resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1, maxTextReplaceOutputBytes })).toThrow(RangeError);
});

it.each([NaN, Infinity, -1, 0.5, 4_194_305, null, undefined])('rejects an invalid transform limit %s', (maxTextTransformOutputBytes) => {
  // @ts-expect-error intentionally exercise malformed JavaScript host policy
  expect(() => resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1, maxTextTransformOutputBytes })).toThrow(RangeError);
});

it.each([NaN, Infinity, -1, 0.5, 4_194_305, null, undefined])('rejects an invalid uppercase limit %s', (maxTextUpperOutputBytes) => {
  // @ts-expect-error intentionally exercise malformed JavaScript host policy
  expect(() => resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1, maxTextUpperOutputBytes })).toThrow(RangeError);
});

it('retains the uppercase default for older hosts and snapshots a tighter policy', () => {
  expect(resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1 }).maxTextUpperOutputBytes).toBe(4_194_304);
  const source = { maxTextRepeatOutputBytes: 1, maxTextUpperOutputBytes: 0 };
  const resolved = resolveDagExecutionByteLimits(source);
  source.maxTextUpperOutputBytes = 1;
  expect(resolved.maxTextUpperOutputBytes).toBe(0);
});

it.each([NaN, Infinity, -1, 0.5, 4_194_305, null, undefined])('rejects an invalid lowercase limit %s', (maxTextLowerOutputBytes) => {
  // @ts-expect-error intentionally exercise malformed JavaScript host policy
  expect(() => resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1, maxTextLowerOutputBytes })).toThrow(RangeError);
});

it('retains the lowercase default for older hosts and snapshots a tighter policy', () => {
  expect(resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1 }).maxTextLowerOutputBytes).toBe(4_194_304);
  const source = { maxTextRepeatOutputBytes: 1, maxTextLowerOutputBytes: 0 };
  const resolved = resolveDagExecutionByteLimits(source);
  source.maxTextLowerOutputBytes = 1;
  expect(resolved.maxTextLowerOutputBytes).toBe(0);
});

it('retains the replacement default for older host policies and snapshots a tighter policy', () => {
  expect(resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1 }).maxTextReplaceOutputBytes).toBe(4_194_304);
  const source = { maxTextRepeatOutputBytes: 1, maxTextReplaceOutputBytes: 0 };
  const resolved = resolveDagExecutionByteLimits(source);
  source.maxTextReplaceOutputBytes = 1;
  expect(resolved.maxTextReplaceOutputBytes).toBe(0);
});

it.each([NaN, Infinity, -1, 0.5, 4_194_305, null, undefined])('rejects an invalid template limit %s', (maxTextTemplateOutputBytes) => {
  // @ts-expect-error intentionally exercise malformed JavaScript host policy
  expect(() => resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1, maxTextTemplateOutputBytes })).toThrow(RangeError);
});

it('retains the template default for older hosts and snapshots a tighter policy', () => {
  expect(resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1 }).maxTextTemplateOutputBytes).toBe(4_194_304);
  const source = { maxTextRepeatOutputBytes: 1, maxTextTemplateOutputBytes: 0 };
  const resolved = resolveDagExecutionByteLimits(source);
  source.maxTextTemplateOutputBytes = 1;
  expect(resolved.maxTextTemplateOutputBytes).toBe(0);
});

it.each(['maxTextJoinOutputBytes', 'maxTextSplitOutputBytes'] as const)('rejects malformed %s host policy and retains the default for older hosts', (name) => {
  for (const value of [NaN, Infinity, -1, 0.5, 4_194_305, null, undefined]) {
    expect(() => resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1, [name]: value })).toThrow(RangeError);
  }
  expect(resolveDagExecutionByteLimits({ maxTextRepeatOutputBytes: 1 })[name]).toBe(4_194_304);
  const source = { maxTextRepeatOutputBytes: 1, [name]: 0 };
  const resolved = resolveDagExecutionByteLimits(source);
  source[name] = 1;
  expect(resolved[name]).toBe(0);
});
