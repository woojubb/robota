import { describe, expect, it } from 'vitest';

import { findFakeDeclarationsInSource, findFakeInSrc } from '../scan-no-fake-in-src.mjs';

/**
 * HARNESS-032 — the no-fake-in-src mechanical floor: `Fake`/`Mock`/`Stub` name TEST doubles only, never shipped code.
 */

function kinds(src) {
  return findFakeDeclarationsInSource(src).map((f) => f.kind);
}

describe('HARNESS-032 — flags test-double declarations in shipped source', () => {
  it('flags a Fake/Mock/Stub class, interface, or type declaration', () => {
    expect(kinds('export class FakeClockPort implements IClockPort {}')).toContain('fake-in-src');
    expect(kinds('class MockTaskExecutor {}')).toContain('fake-in-src');
    expect(kinds('export interface StubBackendOptions {}')).toContain('fake-in-src');
    // object-literal class expression (the browser-stub shape) is still a declaration
    expect(kinds('  OpenAI: class MockOpenAIProvider {')).toContain('fake-in-src');
  });

  it('flags a declared Fake/Mock/Stub factory', () => {
    expect(kinds('export function createMockUsageSnapshot() {}')).toContain('fake-in-src');
    expect(kinds('const createFakeDriver = () => ({});')).toContain('fake-in-src');
  });

  it('flags const/enum/function test-double declarations (gap closures)', () => {
    expect(kinds('export const MockClient = () => ({});')).toContain('fake-in-src');
    expect(kinds('export const StubZ = class {};')).toContain('fake-in-src');
    expect(kinds('export enum FakeStatus { A, B }')).toContain('fake-in-src');
    expect(kinds('export function MockThing() {}')).toContain('fake-in-src');
  });

  it('flags a re-export of a test-double-named symbol', () => {
    expect(kinds("export { FakeClockPort } from './clock-ports.js';")).toContain('fake-in-src');
  });
});

describe('HARNESS-032 — no false positives', () => {
  it('does NOT flag an import or a bare call site (only the declaration is the violation)', () => {
    expect(kinds("import { createMockUsageSnapshot } from './x.js';")).not.toContain('fake-in-src');
    expect(kinds('const snapshot = createMockUsageSnapshot();')).not.toContain('fake-in-src');
  });

  it('does NOT flag a test-double name inside a string literal (injected browser code)', () => {
    expect(kinds("const code = 'class MockOpenAI {}';")).not.toContain('fake-in-src');
  });

  it('does NOT flag ordinary declarations or words containing the substrings', () => {
    expect(kinds('export class ClockPort {}')).not.toContain('fake-in-src');
    expect(kinds('const remockRegistry = 1;')).not.toContain('fake-in-src'); // not a Fake/Mock/Stub<Name> decl
    expect(kinds('// this is not a mock, just a comment')).not.toContain('fake-in-src');
  });

  it('does NOT flag a declaration name merely mentioned in a comment (comment false-positive fix)', () => {
    expect(kinds('// type FakeThing = the shape of the thing')).not.toContain('fake-in-src');
    expect(kinds(' * class MockRegistry documents the fixture')).not.toContain('fake-in-src');
  });
});

describe('HARNESS-032 — suppression does not BLEED to the next declaration (review SHOULD)', () => {
  it('a trailing allow-fake on one declaration does NOT suppress the following declaration', () => {
    const ks = kinds('export class FakeA {} // allow-fake: sanctioned A\nexport class FakeB {}');
    // FakeA is suppressed (same-line), FakeB must STILL be flagged (no reason of its own)
    expect(ks.filter((k) => k === 'fake-in-src')).toHaveLength(1);
  });

  it('a dedicated comment line above still suppresses the declaration below', () => {
    expect(kinds('// allow-fake: dedicated reason\nexport class FakeClockPort {}')).not.toContain(
      'fake-in-src',
    );
  });
});

describe('HARNESS-032 — suppression + anti-rot', () => {
  it('suppresses a sanctioned occurrence with an adjacent allow-fake: <reason>', () => {
    expect(
      kinds(
        '// allow-fake: test-support port, HARNESS-033 relocates to ./testing\nexport class FakeClockPort {}',
      ),
    ).not.toContain('fake-in-src');
    expect(kinds('export class FakeClockPort {} // allow-fake: sanctioned, tracked')).not.toContain(
      'fake-in-src',
    );
  });

  it('flags a reason-less allow-fake comment (anti-rot)', () => {
    expect(kinds('// allow-fake\nconst x = 1;')).toContain('reasonless-annotation');
    expect(kinds('// allow-fake:\nconst x = 1;')).toContain('reasonless-annotation');
  });

  it('a reason-less allow-fake does NOT suppress a real declaration', () => {
    const ks = kinds('// allow-fake\nexport class FakeClockPort {}');
    expect(ks).toContain('fake-in-src');
    expect(ks).toContain('reasonless-annotation');
  });
});

describe('HARNESS-032 — the live packages/<pkg>/src tree is green', () => {
  it('has zero non-allowlisted test-double declarations in shipped source', () => {
    expect(findFakeInSrc()).toEqual([]);
  });
});
