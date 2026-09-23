/**
 * ARCH-111 — `agent-core`'s provider helpers have one exporter, and it is not this package.
 *
 * A `grep` would pass the moment someone re-added the export with different whitespace, and a runtime
 * `expect(mod.normalizeProviderConfig).toBeUndefined()` would pass against a package that failed to
 * build at all. These are TYPE-level assertions: if either name returns to this package's surface the
 * assignment stops compiling, so `tsgo --noEmit` fails before any test runs.
 *
 * The duplicate they replace was created by ARCH-PROVIDER-003 "so existing consumers are unaffected"
 * — a backward-compatibility guarantee this repository does not make. What it bought instead was
 * `agent-framework` importing `createProviderFromConfig` from here while `agent-product` imported the
 * same function from `agent-core`, both compiling, with nothing able to notice.
 */
import { describe, expect, it } from 'vitest';

// The RUNTIME surface, read as values. The type assertions below are compile-time only, and vitest
// does not typecheck — so on their own their `expect` body is a tautology over five literal `true`s
// that passes against the very code this file exists to forbid. This import is what makes the test
// go red without the change.
// Every LEVEL of the re-export chain, not just the package surface. The change spans three files —
// `provider-factory.ts`, `providers/index.ts`, `src/index.ts` — and reversing any ONE of them leaves
// the other two still narrowing, so a test that reads only the outermost surface stays green against
// each single-file reversal. It would guard the whole chain and nothing in it.
import * as FactoryModule from './provider-factory.js';
import * as ProvidersBarrel from './index.js';
import * as ExecutorSurface from '../index.js';

import type * as Core from '@robota-sdk/agent-core';
// The package's OWN entry source, not '@robota-sdk/agent-executor'. Importing by package name
// resolves through `dist/`, so the assertion would describe the last build rather than this source —
// measured: re-adding the re-export and typechecking produced no error at all until this line
// changed. A surface assertion that reads a stale artifact is the vacuous-green shape this
// repository spends its time removing.
import type * as Executor from '../index.js';

// Absent from the executor.
const normalizeIsNotExecutors: 'normalizeProviderConfig' extends keyof typeof Executor
  ? false
  : true = true;
const createFromConfigIsNotExecutors: 'createProviderFromConfig' extends keyof typeof Executor
  ? false
  : true = true;

// THE POSITIVE CONTROL. Present on the owner — without these, the two assertions above would hold
// just as well in a workspace where both functions had been deleted outright, which is a different
// and worse outcome than the one being asserted.
const normalizeIsCores: 'normalizeProviderConfig' extends keyof typeof Core ? true : false = true;
const createFromConfigIsCores: 'createProviderFromConfig' extends keyof typeof Core ? true : false =
  true;

// This package's OWN provider helper stays: it depends on the executor-owned
// `ISerializableProviderProfile` and is not a re-export of anything.
const profileHelperStays: 'resolveProfileApiKey' extends keyof typeof Executor ? true : false =
  true;

describe('ARCH-111: one owner for the core provider helpers', () => {
  // Written as three plain cases rather than one `it.each`. A parameterised title is `'%s …'` in the
  // source and interpolated at run time, so `check-regression-red-proof.mjs` — which matches the
  // titles a diff ADDED against the titles that ran — cannot recognise it as an added case. It
  // reported `added-cases-pass`: a case did fail with the fix reversed, and the checker could not
  // tell it was one of mine. A test invisible to the red-proof matcher guards nothing it can prove.
  it('provider-factory.ts does not re-export agent-core provider helpers', () => {
    const surface = Object.keys(FactoryModule);
    expect(surface).not.toContain('normalizeProviderConfig');
    expect(surface).not.toContain('createProviderFromConfig');
  });

  it('providers/index.ts does not re-export agent-core provider helpers', () => {
    const surface = Object.keys(ProvidersBarrel);
    expect(surface).not.toContain('normalizeProviderConfig');
    expect(surface).not.toContain('createProviderFromConfig');
  });

  it('src/index.ts does not re-export agent-core provider helpers', () => {
    const surface = Object.keys(ExecutorSurface);
    expect(surface).not.toContain('normalizeProviderConfig');
    expect(surface).not.toContain('createProviderFromConfig');
  });

  it("still exports this package's own profile helpers", () => {
    // The positive control for the case above: without it, both assertions would hold against a
    // package whose entry file failed to export anything at all.
    const surface = Object.keys(ExecutorSurface);
    expect(surface).toContain('resolveProfileApiKey');
    expect(surface).toContain('createProviderFromProfile');
  });

  it('holds the surface assertions at compile time', () => {
    expect([
      normalizeIsNotExecutors,
      createFromConfigIsNotExecutors,
      normalizeIsCores,
      createFromConfigIsCores,
      profileHelperStays,
    ]).toEqual([true, true, true, true, true]);
  });
});
