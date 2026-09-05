# Finding Depth — a finding is fixed where the defect is

Mandatory. Parent: [index.md](index.md) § Process Sub-Rules. Judged by
[finding-depth-triager](../../.claude/agents/finding-depth-triager.md), a read-only guardian.

A review finding carries two independent facts. The pipeline read one of them.

- **Severity** — how much it matters. Owned by `pr-review-reviewer`: MUST / SHOULD / CONSIDER / NIT.
- **Depth** — where the defect is. Owned by nobody, so every finding was fixed where it was reported.
  It has an owner now: `finding-depth-triager`, a read-only guardian. The verdict is deliberately NOT
  the fixer's: a worker judging the findings it is about to apply is the produce-and-judge split
  [enforcement-architecture.md](enforcement-architecture.md) forbids, and it is the party for whom one
  verdict means finishing and the other means stopping.

Fixing a foundational finding at the place it surfaced is how a wrong design accumulates patches:
each round is locally reasonable, the special cases multiply, and the shape underneath is never
revisited. The cost compounds silently, because a converged review loop looks identical either way.

## The rule

**Every review finding is classified before it is fixed, as a batch.** Use one guardian dispatch
for the current finding set, not one per correction. A worker's routine implementation adjustment
within an approved decision is not a new independent-review finding. Existing LOCAL verdicts cover
their related repairs unless new evidence changes the premise. [execution-cadence.md](execution-cadence.md)
owns when a phase reopens. Four verdicts, because offering only the first two forces a guess.

- **LOCAL** — the defect is in this change. Fix it here, test-first: write the case against the
  unfixed code and watch it fail (`tdd-and-planning`, `check-regression-red-proof`).
- **FOUNDATIONAL** — the finding is reachable only because something underneath is wrong. It MUST NOT
  be patched in place. File the root item, register its GitHub issue, and choose **re-plan** or
  **labelled containment** — never a third option. The registered issue is not a filing cabinet: an
  OPEN GitHub issue outranks unfiled backlog work when choosing what to do next, and stays ahead of
  it until it is closed. A foundational defect that everyone agrees is foundational and nobody
  schedules is the same defect, now with a paper trail.
- **INVALID** — the premise does not hold. Nothing to fix; record what the code actually does. A
  wrong finding must not drive a change.
- **UNDETERMINED** — the verdict could not be reached, naming the specific thing that would settle
  it. It is not a pass: the finding stays open until that thing is obtained and the verdict retaken.

Containment is permitted only when the change must land first, and only under all three conditions:
it is the smallest thing that keeps the tree honest, it introduces no new abstraction, and it names
the root item's ID in both a code comment and the commit body. An unlabelled hold is a patch.

The code comment opens `Contained — <ID>.`, the same opening the document form uses below. One opening
for both, because both are read by the same reader: the ID has to resolve to a filed item, and a
convention spelled differently per artifact would need a second reader that then drifts from the first.

**The label is a condition, not a courtesy.** A hold with no such comment is indistinguishable from
having ignored the finding. It is also what lets the review loop converge: a foundational finding is
not fixed, so the next round sees the same code and would raise it again. The comment at the site IS
the answer to that finding.

**Not the same as "too large to fix safely."** `pr-review-fixer` already defers a SHOULD it cannot
fix cleanly in scope, and that is a judgement about THIS change's size and risk. Depth is a judgement
about WHERE the defect is, and it applies even when the fix would be small. A one-line fix on the
wrong layer is still on the wrong layer.

**Judged locally, not in CI.** The automated reviewer produces findings and severity. It has no depth
verdict to give and must not be asked for one: it reads a diff without the history, cannot run the
guardian, and a verdict produced where nothing can act on it is a verdict nobody takes. The session
holding the checkout does the judging, and posts back the DECISION — verdict, root item, disposition —
because a finding correctly left unfixed is indistinguishable from one ignored to everyone reading the
PR afterwards.

## Where a root item lives

"File the root item" names a place. Unless one document owns WHICH place, each consumer picks its own,
and the writer that creates the item and the floor that verifies it was created end up looking in
different directories — so an item filed on the designed path fails the check that exists to confirm
it was filed. Owned here, once, so every reader resolves against one list:

- `.agents/tasks/` — an open root item.
- `.agents/tasks/completed/` — an archived one. A finding contained under an item that has since
  landed must keep resolving, or archiving the fix would turn every note that cited it into a failure.

`resolveRootItems` in `scripts/harness/record-local-review.mjs` is the single READER of that list —
`--foundational <ID>` and the containment-label floor both go through it, and
`depth-verdict-reachable.test.mjs` asserts the reader resolves exactly what this section declares.

**Not the spec-doc tree, and not because of the reader.** A spec-doc is a _plan_ under a gate pipeline:
its schema demands prior art, alternatives, a decision, TC-numbered completion criteria and a test plan.
At the moment a foundational finding is raised, none of that is knowable — the point of the verdict is
that the cause has not been designed away yet — so a filing on that path is either a blocked review round
or a draft of placeholders. The backlog item is the problem statement, which is precisely what has been
established. An ID whose only home is `.agents/spec-docs/rejected/` would also satisfy a widened reader,
and "a root item exists" would then be true of a plan somebody declined.

Filing is not a separate worker's. The content is the guardian's finding, already produced, plus a
location — no production judgement is left to make, and `enforcement-architecture.md` says a tier bought
for reliability buys none. The orchestrator that routes the verdict files the item under
[`.agents/tasks/README.md`](../tasks/README.md)'s format and registers its GitHub issue, exactly as
it already registers the issue. `backlog-writer` remains the author of gate-pipeline spec documents;
when the root item is later picked up it enters that pipeline and gains a spec-doc under the same ID,
which is the pairing the two trees already have.

## The cause's location does not decide the depth — the corrected claim does

A finding whose cause lies somewhere other than where it surfaced is not foundational for that reason
alone. The sharpest case is a DOCUMENTATION finding, where the cause is almost always in the code and
the document is the symptom, so "the cause is elsewhere" would classify every one of them foundational
and empty the word. The question is the third one, read on the artifact in hand: is the finding about
this document, or about what this document had to describe? Ask what the CORRECTED sentence would say.

- The code changed legitimately and the document lagged — a rename, a new flag, a moved path. The
  corrected sentence is one the design is glad to make. **LOCAL.** Correct the document.
- The document can be made accurate only by writing down something the design should not be doing — an
  internal presented as public API, a workaround presented as the supported path, one fact with two
  owners, a layer boundary documented as the way through. **FOUNDATIONAL.** The corrected sentence would
  be true, and that is the problem: it is the wrong design written down twice, the second time with an
  accurate-looking document standing in front of it.

## In a document, the containment label is a note the reader can see

Containment in code is a comment naming the root item. A document needs its own form of the same label,
and copying the code one is wrong for a reason worth stating: a code comment is invisible to the running
program and visible to the maintainer, which is correct there, because what the program's consumer
consumes is behavior. A reader IS the document's consumer. A containment hidden from them would leave
every reader trusting a claim the pipeline has already judged to describe a wrong design.

The convention, written here once so a second one is not invented per pipeline: a **containment note** —
a blockquote placed immediately below the claim it contains, opening with the root item's ID.

```markdown
> **Contained — ARCH-042.** The command resolves the path twice because the loader owns two
> resolvers. Correcting this section would describe that faithfully; it stands until the root item lands.
```

The first line is the machine-readable part — `> **Contained — <ID>.**`, the ID optionally a markdown
link. Three properties, each of which is why it is this and not something else:

- **At the site**, like the code comment. The answer to the finding lives where the finding was raised,
  or the next audit round raises it again and the loop stops converging.
- **Visible in the rendered document**, unlike the code comment. An HTML comment would be containment
  that the people the document is written for never learn about.
- **Naming a filed root item.** A note whose ID resolves to no backlog item is refused, exactly as
  `record-local-review` refuses one: a hold labelled with an item that does not exist is
  indistinguishable from having ignored the finding.

"Immediately below" is literal for a paragraph, a heading's section, or a list item (indented with it).
When the contained claim is a TABLE ROW, the note goes directly below the table and names the row, because
a blockquote cannot live inside one — the property that must hold is that a reader meets the label in the
same breath as the claim, not that the two lines are adjacent.

## A loop converges on RESOLVED, not on FIXED

A review loop that stops at "no findings left" can only stop by editing something. A finding correctly
left unfixed keeps it running, and the pressure that produces is to fix it anyway — which for a
foundational finding is the patch this rule forbids. So the stop condition is that every finding is
RESOLVED: fixed, contained under a filed root item, or recorded INVALID with what the code actually
does. It terminates for the same reason the code label works: a contained finding does not recur,
because the label at the site is the answer to it.

Of the two dispositions a foundational finding may take, only **containment** is a resolution. **Re-plan**
is a decision to change something the loop cannot reach, so it HALTS the loop and is reported with its
root item — counting it as resolved would let a round claim convergence over work nobody has done. That
distinction is the reason containment is worth a convention at all.

This holds for **every** loop that converges on a findings count, not for the one that adopted it first.
A convergence condition only one consumer implements reads as governing while the others keep stopping at
"nothing left to edit" — and two loops over the same tree then disagree about the same claim, because the
one that does not read the label re-raises what the other has already answered. Which loops
those are is not enumerated here: the prose would go stale the first time a pipeline is added.
`depth-verdict-reachable.test.mjs` enumerates them from the orchestration map and fails the ones that
have not adopted it, so the set is derived rather than remembered.

The label is read by whoever produces the count. An auditor that does not know the convention counts a
contained claim as a finding, which makes the loop unable to converge on anything but an edit — the exact
pressure this section removes. So each guardian feeding such a loop excludes a contained claim from its
count, treats a label whose ID resolves to nothing as a finding in its own right, and re-raises a claim
whose containment has gone stale.

## Where it is enforced

Prose does not enforce (`enforcement-architecture.md`). The floors:

- `record-local-review.mjs` accepts `--foundational <ID>[,<ID>...]` and REFUSES an ID that resolves to
  no backlog item — a foundational finding whose root item does not exist is the same as not having
  filed it. `pre-push-check` already refuses a push with no record, so the field is reached by the
  real invocation on every push rather than when remembered.
- `task-tracking.sh` lists OPEN issues at session start, which is when the choice of what to work on
  is made — the priority sentence above enforces nothing if the issues are never in front of the
  reader. `open-issues-are-shown.test.mjs` holds the properties that make the notice worth reading:
  it is start-only, it survives an unresponsive or unauthenticated `gh` and says which happened, it
  does not depend on a task directory existing, and it says when its list is truncated. This is a
  REPORTING floor, not a refusing one, and the difference is stated because it matters: nothing here
  fails a build when an issue is ignored — it only makes ignoring one a decision rather than an
  oversight.
- `pr-review-fixer` TAKES the verdict rather than producing it, and stops on a foundational one;
  `pr-finding-resolution-loop` routes that verdict to the root item rather than back into the fix loop.
- `depth-verdict-reachable.test.mjs` refuses a worker that is told to take a `DEPTH:` verdict when no
  pipeline produces one for it. That is this repository's dominant defect stated at this rule's layer:
  the instruction reads as enforced, the worker carries no `Agent` tool so it cannot obtain the verdict
  itself, and nothing fails. The same file refuses a containment label — in a document or in code —
  whose ID resolves to no backlog item, which is `record-local-review`'s refusal applied to both forms.
- The same file holds the two clauses above to every consumer rather than to the first one: it refuses a
  root-item location this rule does not declare or the reader does not resolve, a pipeline that routes a
  filing somewhere else, a findings-count loop whose convergence is still stated as FIXED, and a guardian
  feeding such a loop that does not read the containment label. Each is a rule stated repo-wide with one
  implementer until something enumerates the rest.

## It applies to a PLAN, not only to a finding

A finding is the late place to ask. The same three questions answer at two earlier moments, and both
are cheaper:

- **Before planning** — the observation that produced the item. Is what was noticed the defect, or the
  symptom of one? An item scoped to a symptom produces a plan that cannot be right, and every later gate
  will pass it, because each of them judges the plan against the item rather than the item against
  reality.
- **After planning, before implementing** — the plan itself. Does it address the cause, or make the
  symptom stop? A plan can be well-formed, well-reviewed, correctly sequenced and still be a patch on
  the wrong layer, and no amount of execution quality repairs that.

This is a different question from `proposal-reviewer`'s. That one asks whether the chosen decision is
the right one AMONG THE ALTERNATIVES; depth asks whether the problem being solved is the real one. Both
can pass while the other fails, which is why neither substitutes for the other.

## What this rule does not do

It does not decide severity and does not make "architectural" a way to defer work. It DOES reach the
merge, in one direction only: `re-plan` is published to the pull request as the `disposition-re-plan`
label when it is recorded, and `review-gate` and `merge-gate.sh` read it there by PR number, so a
withdrawn change cannot be merged. A `containment` hold still lands — that is what makes it
the resolution. Calling a finding foundational is a claim that costs someone work: it must state
the cause and what it has already cost. A repeat of the same finding on an earlier PR is the evidence
that carries it; a feeling is not.
