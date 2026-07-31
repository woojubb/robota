# Finding Depth — a finding is fixed where the defect is

Mandatory. Parent: [index.md](index.md) § Process Sub-Rules. Procedure:
[root-cause-triage](../skills/root-cause-triage/SKILL.md).

A review finding carries two independent facts. The pipeline read one of them.

- **Severity** — how much it matters. Owned by `pr-review-reviewer`: MUST / SHOULD / CONSIDER / NIT.
- **Depth** — where the defect is. Owned by nobody, so every finding was fixed where it was reported.

Fixing a foundational finding at the place it surfaced is how a wrong design accumulates patches:
each round is locally reasonable, the special cases multiply, and the shape underneath is never
revisited. The cost compounds silently, because a converged review loop looks identical either way.

## The rule

**Every finding is classified LOCAL or FOUNDATIONAL before it is fixed.**

- **LOCAL** — the defect is in this change. Fix it here, test-first: write the case against the
  unfixed code and watch it fail (`tdd-and-planning`, `check-regression-red-proof`).
- **FOUNDATIONAL** — the finding is reachable only because something underneath is wrong. It MUST NOT
  be patched in place. File the root item, register its GitHub issue, and choose **re-plan** or
  **labelled containment** — never a third option.

Containment is permitted only when the change must land first, and only under all three conditions:
it is the smallest thing that keeps the tree honest, it introduces no new abstraction, and it names
the root item's ID in both a code comment and the commit body. An unlabelled hold is a patch.

## Where it is enforced

Prose does not enforce (`enforcement-architecture.md`). The floors:

- `record-local-review.mjs` accepts `--foundational <ID>[,<ID>...]` and REFUSES an ID that resolves to
  no backlog item — a foundational finding whose root item does not exist is the same as not having
  filed it. `pre-push-check` already refuses a push with no record, so the field is reached by the
  real invocation on every push rather than when remembered.
- `pr-review-fixer` stops and reports on a finding it judges foundational instead of applying it;
  `pr-review-orchestration` routes that verdict to the root item rather than back into the fix loop.

## What this rule does not do

It does not decide severity, does not decide whether the PR merges, and does not make "architectural"
a way to defer work. Calling a finding foundational is a claim that costs someone work: it must state
the cause and what it has already cost. A repeat of the same finding on an earlier PR is the evidence
that carries it; a feeling is not.
