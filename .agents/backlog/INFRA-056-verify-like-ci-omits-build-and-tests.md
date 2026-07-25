---
id: INFRA-056
title: verify-like-ci is named as the CI mirror but runs neither build nor the package tests
status: todo
priority: high
type: INFRA
created: 2026-07-26
---

## Problem

`pnpm harness:verify-like-ci` is referred to across the harness — in rules, in skills, and in the
prompts that dispatch implementation agents — as **the** CI-equivalent verification entry point: the
one command that reproduces what CI asserts. Its five stages are:

| Stage                  | What it actually runs                                 |
| ---------------------- | ----------------------------------------------------- |
| `harness-self-test`    | `pnpm harness:test` — the **harness scan** test suite |
| `format-check`         | prettier over changed files                           |
| `scan-suite`           | the scan suite on a built tree                        |
| `scan-suite-dist-free` | the scan suite on a dist-free worktree                |
| `typecheck`            | `pnpm typecheck`                                      |

**It runs neither `pnpm build` nor any package's test suite.** CI runs both — `build` and `quality`
are required status checks. So the command every agent is told is "the CI mirror" omits the two
gates most likely to catch a functional regression, and `harness-self-test`'s name invites the
reading that package tests were covered when only the harness's own tests were.

## How it surfaced

A `HARNESS-049` increment proposed replacing four hardcoded verification commands in a skill with a
pointer to "the project's CI-equivalent verification entry point" — a change that reads as a
strengthening, since it removes duplicated command names. An independent `proposal-reviewer` caught
that it was a **loss**: the four commands included the package test suite, and the entry point does
not. The gate would have silently stopped running tests.

The same misreading is present in this session's own agent dispatch prompts, which named
`verify-like-ci` as the CI-equivalent gate and relied on agents to also run package tests on their
own initiative. They did — but the instruction was weaker than it appeared.

## Why this is worth fixing rather than documenting

The whole point of a single named entry point is that nobody has to remember what it covers. One
that omits build and tests while being called the CI mirror is worse than having no entry point: it
converts "I ran the CI-equivalent check" from a strong claim into a weak one **without anyone
noticing the difference**. It is the same shape as the fail-open defects INFRA-048/INFRA-050 closed
— a check that reports success over ground it never covered.

## Direction

Either:

1. **Add the missing stages** — `build` and the affected packages' tests — so the name is true. Cost:
   the command gets much slower, which matters because agents run it in the foreground. Consider
   scoping the test stage to affected packages, as CI does, rather than the whole workspace.
2. **Rename it** to what it is (a scan/format/typecheck gate) and introduce a separate, explicitly
   named full-CI entry point that the rules and skills point at instead.

Option 1 is preferable if the runtime can be kept tolerable, because a second entry point recreates
the "which one do I run" problem. Whichever is chosen, every rule, skill and agent-definition that
currently names `verify-like-ci` as the CI-equivalent gate must be updated in the same change — a
partial rename leaves the misleading claim in place where it does the damage.

## Acceptance

- [ ] The entry point named as the CI mirror genuinely covers what CI's required checks assert, or is
      no longer named as the CI mirror.
- [ ] A mechanical check that the stage list and CI's required jobs cannot drift apart — the same
      anti-drift shape `review-gate` uses to pin its glob list to `codeql.yml`'s `paths-ignore`.
- [ ] Red-first: a tree that CI would reject on `build` or a package test, which `verify-like-ci`
      currently passes, and which the fixed entry point fails.

## References

- `scripts/harness/verify-like-ci.mjs` (`CI_STAGES`)
- `.github/workflows/ci.yml` — `build`, `quality` (both required)
- The `HARNESS-049` increment whose reviewer caught the gain-that-was-a-loss
