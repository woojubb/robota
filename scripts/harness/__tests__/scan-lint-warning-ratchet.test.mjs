/**
 * INFRA-039 — the lint warning CEILING is a ratchet, and this pins that it can fail.
 *
 * The spec's problem is not the warning volume, which is a deliberate two-tier policy. It is that a
 * genuinely NEW warning is invisible inside it. Measured 2026-08-22: 0 errors, 2093 warnings across
 * 1861 files — against the 1798 the spec recorded on 2026-07-16. The count grew by 295 while the
 * document sat in draft, which is the argument for a ratchet BEFORE a reduction pass rather than
 * after one.
 *
 * The enforcement is `--max-warnings` on the root `lint` script — eslint's own mechanism, on the
 * release path where that script already runs. This scan governs the CEILING that script carries,
 * so the number does not become a hand-maintained second source.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ceilingIn, judge } from '../scan-lint-warning-ratchet.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

const manifest = (lint) => JSON.stringify({ scripts: lint === null ? {} : { lint } });

describe('reading the ceiling out of the lint script', () => {
  it('reads the number the script actually carries', () => {
    expect(
      ceilingIn(manifest('eslint packages apps --ext .ts,.tsx --cache --max-warnings 2093')),
    ).toEqual({ ceiling: 2093, reason: null });
  });

  it('accepts the `=` spelling, which eslint also accepts', () => {
    expect(ceilingIn(manifest('eslint . --max-warnings=7')).ceiling).toBe(7);
  });

  it('reports NO ceiling when the flag is absent, rather than inventing one', () => {
    // A script without the flag reports warnings and gates nothing. Returning a default here would
    // make the scan pass over a ratchet that does not exist.
    const { ceiling, reason } = ceilingIn(manifest('eslint packages apps --ext .ts,.tsx --cache'));
    expect(ceiling).toBeNull();
    expect(reason).toMatch(/gates nothing/);
  });

  it('reports no ceiling when there is no lint script at all', () => {
    expect(ceilingIn(manifest(null)).ceiling).toBeNull();
  });
});

describe('the ratchet may fall and may never rise', () => {
  it('passes when the ceiling equals its baseline', () => {
    expect(judge(2093, null, { warnings: 2093 }).ok).toBe(true);
  });

  it('FAILS when the ceiling rises', () => {
    const verdict = judge(2094, null, { warnings: 2093 });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/ROSE/);
  });

  it('FAILS when the ceiling falls without a re-freeze', () => {
    // A fall is a gain, and an unfrozen gain is a licence to grow back — the same rule every other
    // baseline in this directory carries.
    const verdict = judge(2000, null, { warnings: 2093 });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/FELL/);
  });

  it('FAILS when the flag is missing, even though no number rose', () => {
    // The case a ratchet most needs: deleting the flag makes every count pass. Without this the
    // scan would be green on a lint script that gates nothing.
    const verdict = judge(null, 'the `lint` script carries no `--max-warnings`', {
      warnings: 2093,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/--max-warnings/);
  });

  it('FAILS closed when there is no baseline to compare against', () => {
    expect(judge(2093, null, undefined).ok).toBe(false);
  });
});

describe('this repository', () => {
  it('carries the flag on its root lint script', () => {
    const { ceiling } = ceilingIn(readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8'));
    expect(ceiling).not.toBeNull();
  });

  it('and the ceiling matches the frozen baseline', () => {
    const { ceiling, reason } = ceilingIn(
      readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8'),
    );
    const baseline = JSON.parse(
      readFileSync(path.join(WORKSPACE_ROOT, 'scripts/harness/lint-warning-baseline.json'), 'utf8'),
    );
    expect(judge(ceiling, reason, baseline).ok).toBe(true);
  });
});
