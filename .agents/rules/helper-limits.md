# Helper Limits — re-judged at every consumer whose consequences differ

Mandatory. Parent: [index.md](index.md) § Process Sub-Rules.

A shared function's documented limits were judged against what its FIRST consumer did with the
answer. That judgement is not a property of the function. It is a property of the pair.

When a second consumer arrives whose consequences are heavier, **the function does not change** — so
nothing in the diff signals anything, and review sees a reuse, which reads as good practice. The
defect is invisible in the code and shows up only in behaviour, usually much later.

Two instances, measured in one session:

- `git()` trimmed its output. Right for a sha; wrong for a patch. Reused to produce the input to
  `git apply -R`, it stripped the final newline, git called every patch corrupt, and the red-proof
  gate's mutation step threw for its entire life — twelve CI runs, zero verdicts, no error anyone saw.
- `testExecutesHook` was a grep-level relation for an ADVISORY coverage floor whose own docstring
  called it "structural rather than exact". Reused to pick which tests may set a red-proof VERDICT,
  the same imprecision can hand a verdict to a test that never ran the hook (INFRA-074).

## The rule

**Before reusing a helper in a context with different consequences, re-judge its stated limits at
the new call site, and record the answer there.**

Three outcomes, and only three:

1. **They hold** — say why, at the call site. One line.
2. **They do not hold** — narrow the helper, or use a different one.
3. **They do not hold and the mismatch is being held** — a labelled containment naming a root item,
   per [finding-depth.md](finding-depth.md). Never an unlabelled hold.

The point is not the comment. It is that the question is ASKED where the consequences are known,
which is the only place it can be answered. The author of the helper could not have answered it:
the second consumer did not exist yet.

## Where it is enforced

`scan-helper-limits` (`pnpm harness:scan`). A helper declares its limits with a `@limits <statement>`
line in the docblock attached to its export; every module importing a `@limits` function must carry
`// LIMITS <name>: <why they hold here>` — or a containment naming a root item.

Declaring is **opt-in**, deliberately: requiring every helper to be annotated would be satisfied by
boilerplate and would say nothing. Once declared, acknowledgement is not optional.

Anti-rot, the convention `allow-fake` and `allow-fallback` already use: a `@limits` with no
statement and a `LIMITS <name>:` with no reason both FAIL. A marker that says nothing stops being
read, and then the floor is decorative.

## What this rule does not say

It does not say helpers should not be reused — reuse is how a codebase stays one thing. It does not
ask for the limits to be eliminated; an approximate relation is often exactly right for what rides
on it. It asks only that the trade be re-made by whoever changes what rides on it.
