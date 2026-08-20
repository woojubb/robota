# A conditional spread is not an object literal, so the compiler stops checking its keys

## STATUS: measured 2026-08-21 from issue #1949; no mechanism built, deliberately

In-repo mirror (memory-mirroring rule). Host mirror: `conditional-spread-hides-a-misplaced-key`.

## The fact

`exactOptionalPropertyTypes` makes `...(x !== undefined ? { k: v } : {})` the idiom for an optional
key. Excess-property checking applies to object **literals**, and a spread result is not one — so a
key placed on the wrong object compiles silently.

Verified with a probe compiled by this repository's own `tsgo`:

```ts
const a: ITarget = { config: { permissions: [], topLevel: v } }; // TS2353
const b: ITarget = { config: { permissions: [], ...(v !== undefined ? { topLevel: v } : {}) } }; // silent
```

Worth writing down because the natural assumption is the opposite: the repository is strict, so the
compiler is presumed to be watching. On this construct it is not.

## What the measurements said, in the order they corrected each other

| claim                                                      | outcome                                                                                                                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "446 sites are exposed" (as filed)                         | wrong — 446 counted test files; shipped `src` has 356                                                                                                          |
| "99% are nested" (first cut)                               | wrong — it counted every `{`, so a function body made every spread look nested. A result reading "essentially all of them" is a broken question, not an answer |
| exposed = spread inside an object that is a property VALUE | **22 of 356 (6%)**                                                                                                                                             |
| any of the 22 misplaced?                                   | **none** — read all 22; every key belongs to the object it is spread into                                                                                      |

So the gap is real and latent: one historical instance, caught by review while the change was still
open, and zero in the tree.

## Two options that were tested rather than assumed

- **A `defined()` helper does NOT restore the check.** It changes what is spread, not that it is a
  spread. Measured: still silent. That refutation is worth keeping — it would have been a 356-site
  migration buying nothing on this axis.
- **Annotating the spread SOURCE does work**, because the check then runs on the inner literal:
  `const inner: Partial<ITarget['config']> = …` errors on a key that belongs to the outer object. It
  only applies where the spread is hoisted to a named binding, so it is a tool for a composition
  boundary, not a sweep.

A type-aware lint rule is the only thing that scales, and it is unavailable here: `.eslintrc.json`
has no `project` in `parserOptions` and zero type-aware rules enabled.

## How it was found

Not by a probe. Review caught it on pull request #1946: an options key passed INSIDE `config` while
the constructor read it at the top level, so production always fell back and reproduced the bug the
change existed to fix. Both gates that should have caught it stayed green — the compiler for the
reason above, and the tests because they constructed the object directly and never traversed the
composition root. See [[wiring-tests-assert-the-wrong-half]] for that second half.
