import { describe, expect, it } from 'vitest';

import { findNoFallbackFindings, findNoFallbackFindingsInSource } from '../scan-no-fallback.mjs';

/**
 * HARNESS-028 — the No-Fallback mechanical floor.
 *
 * TC-01: flag `catch { return <default-literal> }`; suppress with `allow-fallback: <reason>`.
 * TC-02: no false positives on `??` / defaulting-`||` / rethrow / error-RESULT returns.
 * TC-04: annotation anti-rot (v1 = reason-less-only); stale-detection deferred (inert ≠ stale).
 * TC-06: the live `packages/<pkg>/src` tree is GREEN under v1 semantics.
 */

/** Does this source produce a finding of the given kind? */
function kinds(src) {
  return findNoFallbackFindingsInSource(src).map((f) => f.kind);
}

describe('HARNESS-028 TC-01 — flags the silent catch→default-return fallback', () => {
  it('flags a catch whose first act returns a bare default literal (no throw)', () => {
    expect(kinds('try { risky(); } catch { return undefined; }')).toContain('unannotated-fallback');
    expect(kinds('try { risky(); } catch (e) { return null; }')).toContain('unannotated-fallback');
    expect(kinds('try { risky(); } catch { return []; }')).toContain('unannotated-fallback');
    expect(kinds('try { risky(); } catch { return {}; }')).toContain('unannotated-fallback');
    expect(kinds('try { risky(); } catch { return false; }')).toContain('unannotated-fallback');
  });

  it('reports the line of the catch', () => {
    const findings = findNoFallbackFindingsInSource(
      'const a = 1;\ntry { x(); } catch {\n  return null;\n}\n',
    );
    const fb = findings.find((f) => f.kind === 'unannotated-fallback');
    expect(fb?.line).toBe(2);
  });
});

describe('HARNESS-028 TC-01 — suppression by an adjacent allow-fallback: <reason>', () => {
  it('suppresses when the annotation sits inside the catch body', () => {
    const src =
      'try { x(); } catch {\n  // allow-fallback: sanctioned default on read failure\n  return undefined;\n}';
    expect(kinds(src)).not.toContain('unannotated-fallback');
  });

  it('suppresses when the annotation is inline on the return line', () => {
    const src =
      'try { x(); } catch {\n  return undefined; // allow-fallback: sanctioned default\n}';
    expect(kinds(src)).not.toContain('unannotated-fallback');
  });

  it('suppresses when the annotation trails the catch closing brace', () => {
    const src =
      'try {\n  x();\n} catch {\n  return {};\n} // allow-fallback: advisory data skipped';
    expect(kinds(src)).not.toContain('unannotated-fallback');
  });
});

describe('HARNESS-028 TC-02 — no false positives (precision mandate)', () => {
  it('does NOT flag `x ?? default` value-precedence', () => {
    expect(kinds('const v = maybe() ?? defaultValue;')).not.toContain('unannotated-fallback');
  });

  it('does NOT flag defaulting-`||`', () => {
    expect(kinds('const v = maybe() || fallbackValue;')).not.toContain('unannotated-fallback');
  });

  it('does NOT flag a catch that rethrows / wraps-and-throws', () => {
    expect(kinds('try { x(); } catch (e) { throw new Error("wrapped"); }')).not.toContain(
      'unannotated-fallback',
    );
    expect(kinds('try { x(); } catch (e) { logger.warn(e); throw e; }')).not.toContain(
      'unannotated-fallback',
    );
  });

  it('does NOT flag an error-RESULT return (Result / {ok:false} / error string)', () => {
    expect(kinds('try { x(); } catch (e) { return { ok: false, error: e }; }')).not.toContain(
      'unannotated-fallback',
    );
    expect(
      kinds('try { x(); } catch (e) { return { success: false, error: msg }; }'),
    ).not.toContain('unannotated-fallback');
    expect(kinds('try { x(); } catch (e) { return stringifyError(e); }')).not.toContain(
      'unannotated-fallback',
    );
  });

  it('does NOT flag a catch that acts before returning a default (not fully silent)', () => {
    // logging first → the first meaningful statement is not the default return
    expect(
      kinds('try { x(); } catch (e) {\n  logger.warn(e);\n  return undefined;\n}'),
    ).not.toContain('unannotated-fallback');
  });
});

describe('HARNESS-028 TC-04 — annotation anti-rot (v1 = reason-less-only)', () => {
  it('flags a reason-less `allow-fallback` (no colon+reason)', () => {
    expect(kinds('// allow-fallback\nconst x = 1;')).toContain('reasonless-annotation');
    expect(kinds('// allow-fallback:\nconst x = 1;')).toContain('reasonless-annotation');
    expect(kinds('// allow-fallback:   \nconst x = 1;')).toContain('reasonless-annotation');
  });

  it('does NOT flag a well-formed `allow-fallback: <reason>`', () => {
    expect(
      kinds('// allow-fallback: sanctioned because the failure is surfaced downstream'),
    ).not.toContain('reasonless-annotation');
  });

  it('DEFERS stale-detection: an annotation on a not-yet-scanned construct is inert, not stale', () => {
    // `||`-fallback is NOT a v1-flagged construct; a reasoned annotation on it suppresses nothing
    // today but must NOT be reported as stale (v1 = reason-less-only).
    const src =
      'const v = cache.get() || fetch(); // allow-fallback: lazy-init, not a fallback path';
    expect(findNoFallbackFindingsInSource(src)).toEqual([]);
  });
});

describe('HARNESS-028 TC-06 — the live source tree is green under v1 semantics', () => {
  it('packages/<pkg>/src has zero no-fallback findings', () => {
    expect(findNoFallbackFindings()).toEqual([]);
  });
});
