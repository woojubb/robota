# Finding depth, and the two properties a guard has when it is not blocking

Landed 2026-08-01 across #1539, #1541, #1543. Owner directive, mirrored here per
[`../rules/memory-mirroring.md`](../rules/memory-mirroring.md). The rules own the requirements; this
file records what was measured and why the shape is what it is, so the next reader does not have to
re-derive it.

## Depth (owner: [`../rules/finding-depth.md`](../rules/finding-depth.md))

Owner's concern: fixing review findings must not become patch-on-patch. If a finding reveals that
the design underneath is wrong, do not build on it — issue a root item.

A finding carries two independent facts and the pipeline read one. **Severity** is
`pr-review-reviewer`'s. **Depth** — where the defect is — was owned by nobody, so every finding was
fixed where it surfaced. A converged review loop looks identical either way, which is what makes the
cost invisible.

Three questions, any one answered the second way ⇒ FOUNDATIONAL: would it recur in the NEXT change
here; does the fix make the code correct or only stop the symptom; is it about this diff or about
what this diff had to work around.

Applied the same day to five findings. Four were LOCAL and fixed test-first. Two were FOUNDATIONAL
and filed rather than patched: [INFRA-073](../backlog/INFRA-073-one-verdict-for-an-aggregate.md)
(the red-proof gate judges an aggregate and reports a scalar, so a pass hides inside a fail) and
[INFRA-075](../backlog/INFRA-075-substitution-span-restores-its-own-quotes.md) (restoring a `$(…)`
span un-masks the quotes inside it — a live false refusal, reproduced below).

```
out=$(printf 'x git commit -m y' | bash h.sh); echo done   → BLOCKED
printf 'x git commit -m y' | bash h.sh                     → correctly ignored
```

## Two properties a guard has almost all the time (owner: [`../rules/enforcement-architecture.md`](../rules/enforcement-architecture.md))

Neither is visible in a suite of negative cases, and both were measured over 2026-07-27..08-01.

**It leaves correct work alone, silently.** Cost of not checking: an 88% false-positive rate on the
one-branch check (83 reported, 73 already merged), reflex-overridden twice by its own author; a
promotion gate that read the debt being PAID as a violation; a release gate blocked twice; two
parser defects that refused the creation of the branch their own fix lived on. Floor:
`guards-pass-silently.test.mjs`. It found three live defects on its first run — `pre-push-check`
narrating on every successful push, and (once that narration was deleted) a reachability probe that
had been measuring the PRINT rather than a verdict, because its scratch repo sat on `develop` where
the review gate exempts itself and decides nothing.

**It refuses what it cannot read.** The `.mjs` scans had `requireGovernedTree`; the shell layer,
where every instance was, had nothing. Floor: `guards-fail-closed.test.mjs`. Mostly a ratchet and it
says so — it still found an empty payload passing `check-forbidden-patterns`, which meant a broken
host let every edit through unchecked.

The two pull against each other on purpose: one alone gives a guard that refuses everything, the
other alone gives one that permits everything.

## Helper limits (owner: [`../rules/helper-limits.md`](../rules/helper-limits.md))

A helper's documented limits were judged against what its FIRST consumer did with the answer — a
property of the pair, not of the function. When a heavier consumer arrives the function does not
change, so nothing in the diff signals anything and review sees a reuse.

- `git()` trimmed its output: right for a sha, wrong for a patch. Reused to feed `git apply -R`, it
  stripped the final newline and **every reverse-apply the red-proof gate ever attempted threw** —
  twelve CI runs, zero verdicts, no error anyone saw.
- `testExecutesHook` was grep-level for an advisory floor; reused to pick which tests may set a
  verdict, the same imprecision can decide a hook it never ran
  ([INFRA-074](../backlog/completed/INFRA-074-the-spawn-relation-is-not-tied-to-its-argument.md),
  resolved 2026-08-01 by reading the call graph rather than narrowing the text pattern).

Floor: `scan-helper-limits`. `@limits` on the docblock is opt-in; acknowledging it at each importing
module is not.

## The habit underneath

Roughly eight accidental-greens were caught in the agent's own tests in that window, all one shape:
the fix written first, the test after, asserting an observable BOTH states satisfy (usually exit 0).
Write the case against the unfixed code and watch it fail before touching source — the failure
message must name the defect. That is `tdd-and-planning`; what failed was the ORDER, not knowledge
of the rule.
