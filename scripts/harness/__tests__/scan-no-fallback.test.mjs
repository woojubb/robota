import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  applySwallowBaseline,
  findNoFallbackFindings,
  findNoFallbackFindingsInSource,
} from '../scan-no-fallback.mjs';

/**
 * HARNESS-028 — the No-Fallback mechanical floor.
 *
 * TC-01: flag `catch { return <default-literal> }`; suppress with `allow-fallback: <reason>`.
 * TC-02: no false positives on `??` / defaulting-`||` / rethrow / error-RESULT returns.
 * TC-04: annotation anti-rot (v1 = reason-less-only); stale-detection deferred (inert ≠ stale).
 * TC-06: the live `packages/<pkg>/src` tree is GREEN under v1 semantics.
 *
 * CORE-029 adds the two SWALLOW kinds the diagnostics audit actually found — a `catch` that says
 * nothing, and a discarded promise rejection — behind a burn-down baseline, because the tree already
 * contained dozens and failing on all of them at once would block unrelated work.
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

  it('does NOT flag a promise `.catch(fn)` handler (a different construct)', () => {
    expect(kinds('p.catch(function () { return null; });')).not.toContain('unannotated-fallback');
    expect(kinds('p.catch((e) => { return undefined; });')).not.toContain('unannotated-fallback');
  });

  it('does NOT flag `catch` as a suffix of another identifier', () => {
    expect(kinds('const mismatchcatch = () => { return null; };')).not.toContain(
      'unannotated-fallback',
    );
  });

  it('a `}` inside a string does NOT truncate the body or defeat a trailing annotation', () => {
    const src =
      'try {\n  x();\n} catch {\n  const s = "a}b";\n  return null;\n} // allow-fallback: sanctioned';
    expect(kinds(src)).not.toContain('unannotated-fallback');
  });

  it('does NOT flag `allow-fallback` appearing inside a string literal (anti-rot is comment-only)', () => {
    expect(kinds('const label = "allow-fallback";')).not.toContain('reasonless-annotation');
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

describe('CORE-029 — the swallow kinds', () => {
  it('flags a catch block that says nothing at all', () => {
    expect(kinds('try {\n  risky();\n} catch {}\n')).toContain('silent-catch');
    expect(kinds('try {\n  risky();\n} catch (e) {\n  // nothing\n}\n')).toContain('silent-catch');
  });

  it('does NOT flag a catch that does something — rule (1) judges what', () => {
    expect(kinds('try {\n  risky();\n} catch (e) {\n  report(e);\n}\n')).not.toContain(
      'silent-catch',
    );
    expect(kinds('try {\n  risky();\n} catch (e) {\n  throw e;\n}\n')).not.toContain(
      'silent-catch',
    );
  });

  it('flags a discarded promise rejection', () => {
    expect(kinds('void run().catch(() => undefined);')).toContain('discarded-rejection');
    expect(kinds('void run().catch(() => null);')).toContain('discarded-rejection');
    expect(kinds('void run().catch(() => {});')).toContain('discarded-rejection');
    expect(kinds('void run().catch((_e) => undefined);')).toContain('discarded-rejection');
  });

  it('does NOT flag a rejection handler that reports', () => {
    expect(kinds('void run().catch((e) => logger.warn("failed", { e }));')).not.toContain(
      'discarded-rejection',
    );
  });

  it('both kinds are suppressed by a reasoned allow-fallback', () => {
    // Inside the block is the natural placement for an empty catch — a comment-only body is still
    // "says nothing", so the annotation suppresses without making the block look like it acts.
    const inside = 'try {\n  risky();\n} catch {\n  // allow-fallback: the caller reports it\n}\n';
    expect(kinds(inside)).not.toContain('silent-catch');
    // And the line directly above `catch`, which is the other placement the scan documents.
    const above = 'try {\n  risky();\n  // allow-fallback: the caller reports it\n} catch {}\n';
    expect(kinds(above)).not.toContain('silent-catch');
    const discarded =
      '// allow-fallback: notification only, failure is logged upstream\nvoid run().catch(() => undefined);';
    expect(kinds(discarded)).not.toContain('discarded-rejection');
  });
});

describe('CORE-029 — the burn-down baseline', () => {
  it('a frozen swallow does not fail; a NEW one in the same file does', () => {
    const findings = [
      { file: 'packages/p/src/a.ts', line: 10, kind: 'silent-catch', text: '' },
      { file: 'packages/p/src/a.ts', line: 20, kind: 'silent-catch', text: '' },
    ];
    expect(
      applySwallowBaseline(findings, { 'packages/p/src/a.ts::silent-catch': 2 }).failures,
    ).toEqual([]);
    expect(
      applySwallowBaseline(findings, { 'packages/p/src/a.ts::silent-catch': 1 }).failures,
    ).toHaveLength(1);
  });

  it('a swallow in a file the baseline never mentioned fails', () => {
    const findings = [{ file: 'packages/p/src/new.ts', line: 3, kind: 'silent-catch', text: '' }];
    const { failures } = applySwallowBaseline(findings, {});
    expect(failures).toHaveLength(1);
    expect(failures[0].text).toMatch(/a new silent-catch appeared/);
  });

  it('reports a ratchet when frozen debt is paid down, so the gain gets locked', () => {
    const { ratchet } = applySwallowBaseline([], { 'packages/p/src/a.ts::silent-catch': 2 });
    expect(ratchet).toEqual([{ key: 'packages/p/src/a.ts::silent-catch', frozen: 2, count: 0 }]);
  });

  it('never baselines the kinds that must always fail', () => {
    // `unannotated-fallback` and `reasonless-annotation` predate this change and stay unforgiving.
    const findings = [
      { file: 'packages/p/src/a.ts', line: 1, kind: 'unannotated-fallback', text: '' },
      { file: 'packages/p/src/a.ts', line: 2, kind: 'reasonless-annotation', text: '' },
    ];
    expect(applySwallowBaseline(findings, {}).failures).toHaveLength(2);
  });
});

describe('HARNESS-028 TC-06 — the live source tree is green under current semantics', () => {
  it('packages/<pkg>/src produces no FAILING finding', () => {
    const baseline = JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, '..', 'no-fallback-swallow-baseline.json'),
        'utf8',
      ),
    );
    expect(applySwallowBaseline(findNoFallbackFindings(), baseline).failures).toEqual([]);
  });

  it('the baseline is a burn-down list, not a licence — every entry is a real debt', () => {
    // A baseline that drifts above what the tree contains would quietly permit new swallows.
    const baseline = JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, '..', 'no-fallback-swallow-baseline.json'),
        'utf8',
      ),
    );
    const { ratchet } = applySwallowBaseline(findNoFallbackFindings(), baseline);
    expect(ratchet).toEqual([]);
  });
});
