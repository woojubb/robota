/**
 * ONE implementation of "a path cited in prose must exist" (HARNESS-062).
 *
 * Five scans each carried their own copy of this rule — `check-spec-paths`,
 * `check-architecture-map-paths`, `check-ghost-package-refs`, `check-done-evidence`,
 * `check-harness-config-paths`. Two shared a byte-identical `REPO_PATH_PATTERN`; a third's comment
 * admitted the fork ("keeps a local, intentionally-narrow copy"). Each carried its own exemption
 * vocabulary, so ONE sentence got THREE verdicts:
 *
 *   `The loader was relocated; packages/ghost-pkg/src/loader.ts is gone.`
 *     arch-map-paths : 0 findings   ('relocated' was in its wide NEGATION set)
 *     ghost-pkg-refs : 1 finding    ('relocated' was not in its narrow ABSENCE_VOCAB)
 *     spec-paths     : 1 finding    (only '(planned)' was exempt)
 *
 * A rule with three implementations is three rules, and an author cannot write a sentence that
 * satisfies all of them. This module owns the patterns and the vocabulary; each scan keeps its own
 * CORPUS and its own marker-style exemptions (`evidence-superseded`,
 * `harness-config-path-allow-missing`, the ghost-package allowlist) — the corpus is each scan's own
 * business, the rule is not.
 *
 * ## Why the vocabulary is the NARROW one
 *
 * Measured on the real tree before choosing (2026-08-01):
 *   - architecture-map corpus (16 docs after its two historical-log skips): 8 lines carry a cited
 *     source path, and ZERO of them were exempted by the wide vocabulary. Narrowing costs nothing
 *     there — the wide set was live only in `layering-audit.md` / `architecture-lessons.md`, which
 *     that scan skips wholesale anyway.
 *   - ghost-package-refs corpus: ZERO lines would change verdict either way; every line matching
 *     wide-but-not-narrow sits in a doc tree the scan already excludes as immutable history.
 *
 * So the choice is free of both false positives and coverage loss, and the narrow set is the better
 * rule on its merits: it exempts on an EXPLICIT annotation the author wrote for the guard
 * (`(planned)`, `(removed)`, `(deleted)`, `(renamed)`) or on a phrase that can only be a statement
 * of absence, never on incidental narrative words like "stale", "migrated" or "relocated" appearing
 * anywhere on the line. "The loader was relocated" describes history; it does not license citing a
 * path that is gone.
 */

/**
 * A repo-rooted source path under a package: `packages/<name>/(src|scripts|bin)/….(tsx|ts|mjs|cjs)`.
 * Was byte-identical in check-spec-paths and check-architecture-map-paths.
 */
export const REPO_SOURCE_PATH_PATTERN =
  /packages\/[\w-]+\/(?:src|scripts|bin)\/[\w\-./]+\.(?:tsx|ts|mjs|cjs)(?!\w)/g;

/**
 * A package-local source path: `src/….(tsx|ts|mjs|cjs)`, resolved against the package that owns the
 * document. The lookbehind rejects the tail of a repo-rooted path (`packages/a/src/x.ts`), which is
 * the other pattern's business.
 */
export const LOCAL_SOURCE_PATH_PATTERN = /(?<![\w/])src\/[\w\-./]+\.(?:tsx|ts|mjs|cjs)(?!\w)/g;

/**
 * Any repo-rooted workspace file path with an extension: `(packages|apps|scripts)/….<ext>`.
 * Capture group 1 is the path; group 0 includes the preceding delimiter.
 *
 * Re-exported by check-done-evidence as `PATH_PATTERN` for `scan-unearned-done-claims.mjs`, which
 * already consumes it under that name.
 */
export const REPO_FILE_PATH_PATTERN =
  /(?:^|[\s`("'[])((?:packages|apps|scripts)\/[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)/g;

/** The same path, but only when it appears inside a quoted string literal. */
export const QUOTED_REPO_FILE_PATH_PATTERN =
  /['"`]((?:packages|apps|scripts)\/[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)['"`]/g;

/**
 * The shared vocabulary: a line stating that the path it cites is deliberately absent.
 *
 * Explicit parenthetical annotations plus two phrases that cannot mean anything else. Deliberately
 * NOT here: "relocated", "moved to", "renamed" as a bare verb, "stale", "migrated", "was extracted",
 * "MISSING" — narrative words that describe what happened to code, not a claim that the cited path
 * is gone. See the module header for the measurement behind that choice.
 */
export const ABSENCE_VOCABULARY =
  /\(planned\)|\(removed\)|\(deleted\)|\(renamed\)|no longer|does not exist/i;

/**
 * The strict level, as a NAMED option rather than a fork.
 *
 * `check-spec-paths` and `check-harness-config-paths` keep it deliberately: a package SPEC is the
 * contract for what the package IS, not a changelog, so "`src/old.ts` was removed" is a sentence
 * that should be deleted rather than exempted — the SPEC should name a path that exists. Widening
 * those two to the shared vocabulary is a decision to be taken with its own measurement, not a side
 * effect of consolidating the rule.
 */
export const PLANNED_ONLY_VOCABULARY = /\(planned\)/i;

/** Marker-only scans (e.g. done-evidence) pass this: no prose exempts anything. */
export const NO_VOCABULARY = null;

/**
 * The paths a line cites, or `[]` when the line's vocabulary marks the absence as deliberate.
 *
 * Glob and parent-relative tokens are dropped: they name a set or a computed location, not a file
 * whose existence can be checked.
 */
export function citedRepoPaths(line, options = {}) {
  const { pattern = REPO_SOURCE_PATH_PATTERN, vocabulary = ABSENCE_VOCABULARY } = options;
  if (vocabulary !== null && vocabulary.test(line)) return [];
  const paths = [];
  for (const match of line.matchAll(pattern)) {
    const token = match[1] ?? match[0];
    if (token.includes('*') || token.includes('..')) continue;
    paths.push(token);
  }
  return paths;
}
