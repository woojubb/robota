# HARNESS-078 — a single-segment dotfile is outside both name checks

**Type:** INFRA
**Status:** in progress
**Filed:** 2026-08-07 (UTC)
**Source:** review finding on PR #1647

## The problem

`.gitignore`, `.npmrc`, `.nvmrc`, `.editorconfig`, `.prettierrc` are named in this repository's own
governed prose — `.agents/rules/git-branch.md` cites `.gitignore`, `scripts/harness/check-plan.mjs`
cites `.nvmrc` — and neither check that verifies a named artifact exists can see them.

Review reported the cause as `hasStem` returning false for a leading-dot token with no second dot.
That conclusion is right; the cause is one layer further out, MEASURED:

| token        | reaches `hasStem`? | why not                                                         |
| ------------ | ------------------ | --------------------------------------------------------------- |
| `.gitignore` | no                 | `PATHISH` requires a slash or a dot AFTER the opening character |
| `.gitignore` | no                 | `NAMED` requires one of ten listed extensions                   |

So `hasStem` never saw them, and fixing `hasStem` alone changes nothing observable. It is fixed
anyway in #1647 — it is the shared answer to "is this a file name", and it should be right for the
next caller — but the gates are what cap the coverage.

## What was tried, and why it is not shipped

Both gates were widened to admit `^\.[A-Za-z0-9][A-Za-z0-9._-]*$`, and
`scan-named-artifact-resolves` was RUN over the repository: **48 findings**, all false. The shape is
not specific to files:

- **Directories** — `.git`, `.agents`, `.husky`, `.turbo`
- **Property accesses** — `.length`, written in prose about code
- **Files outside the tree** — `.bashrc`, `.hookrc`, named while explaining portability

A check that fires on correct work is one that gets turned off, and this scan's own header records
the last time that happened (1656 findings from 470 documents). So the widening was reverted and the
gap is filed instead.

## What a fix has to do

Tell a dotFILE from a dot-DIRECTORY and from a property access, without a closed list of dotfile
names — a list fails SILENTLY here (a name missing from it is simply unchecked), which is the
direction this repository forbids.

Two directions worth measuring:

1. **Resolve first, classify second.** Both checks already have a resolver. A token that resolves to
   a directory is not a missing file; a token that resolves to nothing and is not a known property
   shape is. This inverts the current order and may be cheap.
2. **Use the surrounding prose.** `.length` appears after an identifier; `.gitignore` appears as a
   standalone token. The scan already reads only inside backticks, so the span content is available.

Whichever is chosen, the acceptance test is the 48 findings above going to zero while `.gitignore`
and `.nvmrc` become checkable.

## Verification

- RAN `scan-named-artifact-resolves` with the widening: 48 findings.
- RAN it after the revert: `::examined:: 480 governed documents`, passed.
