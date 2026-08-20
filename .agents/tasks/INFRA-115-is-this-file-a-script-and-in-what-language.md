---
title: 'INFRA-115: "is this committed file a script, and in what language" has no owner'
status: todo
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

- [ ] TC-1: one table maps a language to its extensions AND its interpreter names.
- [ ] TC-2: both filters in each consuming scan are derived from it, not hand-written beside it.
- [ ] TC-3: a test asserts the agreement over the WHOLE table — every interpreter's language has at
      least one admitted extension — rather than over one chosen example.
- [ ] TC-4: `scan-shell-portability.mjs` consumes the same owner, so the copy that started this is
      not left behind.

## Contained by

The follow-up to pull request #1886 ships the alternation with the asymmetry labelled at the site
(`Contained — INFRA-115.`), under [finding-depth.md](../rules/finding-depth.md).
