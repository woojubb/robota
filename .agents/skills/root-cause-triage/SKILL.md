---
name: root-cause-triage
description: Classify a review finding by DEPTH before fixing it — a local defect in this change, or a symptom of a wrong foundation underneath. A foundational finding is filed as a root item (backlog + GitHub issue) instead of being patched in place, so a wrong design is not built on. Use on every finding that is about to be fixed, from any reviewer including yourself.
---

# Root-Cause Triage

The procedure for [finding-depth.md](../../rules/finding-depth.md), which owns what depth is and why
it is asked. This skill decides it: it does not decide severity, and does not perform the fix.

## When to Use

On every finding that is about to be fixed — from `pr-review-reviewer`, from CI, from a human, or from
your own reading. Before the edit, not after.

## The Two Verdicts

- **LOCAL** — the defect is in this change. The fix belongs here. Most findings are local.
- **FOUNDATIONAL** — the finding is reachable only because something underneath is wrong. Fixing it
  here would make the symptom disappear and leave the cause.

## Three Questions

Ask in order. Any one answered the second way makes it foundational.

1. **Would the same finding recur in the next change to this area?**
   Local: it came from a mistake in this diff. Foundational: anyone touching this next hits it again.
2. **Does the fix make the code correct, or only make this symptom stop?**
   Adding a special case for a shape the design should never have produced is not a fix.
3. **Is the finding about this diff, or about what this diff had to work around?**
   If the diff's shape was forced by something underneath, the finding is about the underneath.

A useful tell for question 1: the same finding has already been raised on an earlier PR. A repeat is
evidence of depth, and the repeat itself belongs in the root item as measurement.

## What Each Verdict Requires

**LOCAL** — fix it here. Write the test first, against the unfixed code, and watch it fail; a
regression test that passes on the unfixed code guards nothing (`check-regression-red-proof`).

**FOUNDATIONAL** — do not build on it.

1. **File the root item.** A backlog item describing the CAUSE, not the symptom: what the design gets
   wrong, what it has cost (with the findings that measured it), and the directions considered. The
   `backlog-writer` skill owns the format.
2. **Register the GitHub issue.** `gh issue create --title "<ID>: <title>" --body "…"`, then write the
   URL into the item's frontmatter as `issue: <url>`. Issue tracking may move to GitHub wholesale
   (PROC-004); until that is decided both exist, the issue carries state and the backlog file stays
   the detailed one. Mechanizing this step is PROC-004's, and it is done by hand until then — said
   plainly rather than by naming a command that does not exist.
3. **Choose the disposition, and say which:**
   - **Re-plan** — the current change is withdrawn or reduced until the root is fixed. Correct when
     the change cannot be made honest without the root fix.
   - **Containment** — a minimal, explicitly labelled hold, under the three conditions the rule
     states. Correct when the change must land first.

Never a third option. A foundational finding that is quietly fixed in place is the failure this
skill exists to prevent.

The containment comment is also what lets the review loop converge: the finding is not fixed, so a
reviewer reading the next diff would raise it again and `ACTIONABLE FINDINGS` would never reach zero.
The comment at the site — naming the root item, why it is held, and what must happen before the gate
it belongs to becomes binding — is the answer to that finding.

## Recording

The review record carries the depth verdicts for the round:

```bash
pnpm harness:review:record -- --findings <n> [--foundational <ID>[,<ID>...]]
```

Every ID must resolve to a real backlog item; the recorder refuses unresolvable ones, because a
foundational finding whose root item does not exist is the same as not having filed it. `pre-push-check`
already refuses a push with no record, so this is reached on every push rather than when remembered.

## Terminal Signal

Report one line per finding, so an orchestrator can route on it without re-reading the prose:

```
DEPTH: LOCAL — <finding>
DEPTH: FOUNDATIONAL <BACKLOG-ID> — <finding> — disposition: re-plan | containment
```

## Boundaries

- Judges depth only. Severity is `pr-review-reviewer`'s; the fix is `pr-review-fixer`'s; the root item
  is `backlog-writer`'s.
- Does not decide whether the PR merges. That is the review loop's convergence signal.
- Calling a finding foundational is a claim that costs someone work. State the cause and what it has
  cost; "this feels architectural" is not a verdict.
