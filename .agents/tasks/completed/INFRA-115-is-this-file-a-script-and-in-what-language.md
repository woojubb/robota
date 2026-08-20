---
title: 'INFRA-115: "is this committed file a script, and in what language" has no owner'
status: done
completed: 2026-08-21
created: 2026-08-20
priority: high
urgency: next
area: scripts/harness
issue: 'https://github.com/woojubb/robota/issues/1912'
depends_on: []
---

# INFRA-115: one population, two hand-written constants, an invariant held only in prose

## Objective

A scan that judges committed scripts has to answer two halves of one question: **which files are
scripts**, and **in what language**. Each scan answers it with two independent hand-written
constants — an extension pattern and a shebang alternation — and nothing checks that the two halves
describe the same population.

## The measurement

`scan-symlink-following-enumeration.mjs` admits `dash`, `ksh` and `ash` by shebang while
`SCANNED_EXTENSIONS` has no matching entry. The same file, same content:

| written as          | verdict   |
| ------------------- | --------- |
| `scripts/sweep`     | reported  |
| `scripts/sweep.ksh` | **clean** |

Same for `dash` and `ash`. The file's own comment claims the interpreters are "exactly the ones
`SCANNED_EXTENSIONS` also admits, and no more", and the commit that wrote that sentence shipped the
counter-example.

## Why it is a cause and not a typo

The three names were copied verbatim out of `scan-shell-portability.mjs`, which carries the identical
asymmetry — `EXTENSIONS = /\.(sh|bash|zsh)$/` against
`SHEBANG = /^#!.*\b(sh|bash|zsh|dash|ksh|ash)\b/` — into the file whose comment cites that scan as
the lesson to follow. The lesson copied; the defect copied with it.

Aligning three names in one file leaves the first copy self-disagreeing, leaves the invariant held in
prose in both, and leaves the next scan that needs this predicate to hand-write a third pair. A test
can pin one out-of-set example, which is what the current one does; it cannot pin the invariant while
the invariant is a sentence.

## Completion criteria

- [x] TC-1: one table maps a language to its extensions AND its interpreter names.
      `scripts/harness/script-language.mjs`. Stronger than asked: the extensions ARE the interpreter
      map, so there is no second list for the two halves to disagree in.
- [x] TC-2: both filters in each consuming scan are derived from it, not hand-written beside it.
- [x] TC-3: a test asserts the agreement over the WHOLE table, per INTERPRETER rather than per
      language — see the two cuts below that could not fail on the condition they named.
- [x] TC-4: `scan-shell-portability.mjs` consumes the same owner, so the copy that started this is
      not left behind. Its private `hasExtension` — a third copy of the leading-dot rule — is gone
      with it.

## Contained by

The follow-up to pull request #1886 shipped the alternation with the asymmetry labelled at the site
(`Contained — INFRA-115.`), under [finding-depth.md](../rules/finding-depth.md). That containment is
DISCHARGED here: the label is gone because the two hand-written constants it labelled are gone.

## Progress

### 2026-08-21

Closed. `scripts/harness/script-language.mjs` owns the predicate; both scans read it, and
`scan-shell-portability.mjs` — where the asymmetry started — is fixed rather than left behind.

**The shape is stronger than TC-1 asked for, because two weaker shapes were built first and both
failed their own red proof.** Recording them, since the failures are the reason for the final form:

1. **Two lists plus a whole-table assertion.** The assertion was "every interpreter's LANGUAGE has at
   least one extension". Mutating the table back to the original — `dash`, `ksh`, `ash` against
   `.sh`, `.bash`, `.zsh` — left it green, because shell had five sibling extensions and the count
   was never zero. The invariant was one level too coarse to see the defect it was written for.
2. **Two lists plus a `namesAreExtensions` flag** gating a per-interpreter cross-check. Reintroducing
   the EXACT original asymmetry and setting the flag false left it green again. A check a row can
   switch off says yes to the case it exists to refuse — the same shape as the defect, one layer up.

The third form has neither: each interpreter carries the extensions that name a file it runs, and a
language's extension set is the union of them. There is no second list, so the halves cannot
disagree; and the only assertion left — every interpreter names at least one file — cannot be turned
off by a row. Mutating `ksh: ['.ksh']` to `ksh: []` now fails three cases and names `shell/ksh`.

Also removed: `hasExtension` in `scan-shell-portability.mjs`, a third copy of "a leading dot is not
an extension". Each consumer had discovered that rule separately, and the comment in each says so.

`npx vitest run scripts/harness/__tests__/` — 223 files, 4199 tests, all passed.
`pnpm harness:scan` — 129 passed, 2 skipped.

One thing the scan caught that this change had wrong: the new test was named
`script-language-table-agrees.test.mjs`, and `harness-script-import-safety` pairs a script with a
test by prefix, so it read the module as UNTESTED and refused the baseline growth. Renamed to
`script-language.table-agrees.test.mjs` rather than baselined — adopting the debt was the thing that
scan exists to refuse.
