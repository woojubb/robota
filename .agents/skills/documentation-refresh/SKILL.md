---
name: documentation-refresh
description: Thin orchestration for the recurring documentation audit→depth→fix→re-audit loop. It holds NO documentation policy — it only sequences three subagents (doc-auditor, finding-depth-triager, doc-fixer), routes each finding on its depth verdict, and re-calls them until every finding of a round is RESOLVED. All judgement (what to audit, what "good" means, where the defect is, how to fix) lives in the agents. Use when docs must be brought current with the code and a single pass won't finish it.
loop: over=finding-set; escape=no-progress
invocable: true
---

# Documentation Refresh — pipeline only

This skill is a **thin pipeline**. It carries no documentation policy: what counts as an in-scope doc, the quality criteria, how to verify, and how to edit all live in the agents. The skill only calls them, checks the convergence signal, and re-calls them.

- **`doc-auditor`** (`agentType: doc-auditor`, read-only) owns: scoping/enumeration, the doc-quality criteria, verification against code, and the `ACTIONABLE FINDINGS: <n>` signal.
- **`finding-depth-triager`** (`agentType: finding-depth-triager`, read-only) owns: the `DEPTH:` verdict on each finding.
- **`doc-fixer`** (`agentType: doc-fixer`, edits docs only) owns: the apply discipline (verify-before-write, scope-disjoint, deletions, i18n).

Do not restate the agents' policy here.

## Pipeline

1. **Audit.** Dispatch `doc-auditor` over the target. For a large surface, fan out one auditor per disjoint area (auditors are read-only, so over-provisioning is safe). Collect each area's findings + its `ACTIONABLE FINDINGS` count.
2. **Converged?** Convergence — not a fixed number of passes — is the loop's stop condition, and it is **resolved**, not **fixed**: a round is converged when every material finding across every area has a disposition, which is one of corrected, contained under a filed root item, or recorded INVALID. If any area still reports material findings without one, you are **not** done, regardless of how many rounds have already run. Stopping only at "nothing left to edit" is what forces a foundational finding to be corrected anyway; [finding-depth.md](../../rules/finding-depth.md) owns why. **Re-plan is not on that list, deliberately:** it is a decision to change the code, which this pipeline cannot do, so a finding disposed of that way HALTS this loop and is reported with its root item rather than counted as resolved. A loop that treated it as resolved would claim "docs current" over a document nobody has brought current.
3. **Judge the depth.** Dispatch `finding-depth-triager` on the round's findings and keep its `DEPTH:` verdicts. Hand it the DOCUMENT each finding was raised against together with the code the document describes — that pairing is the change it was raised against here — and point it at [finding-depth.md](../../rules/finding-depth.md) § "The cause's location does not decide the depth — the corrected claim does", which reads its third question on a document rather than on a diff. Without that pointer the guardian applies the diff form and the cause of a doc finding is almost always in the code, which would classify every one of them FOUNDATIONAL. This step is here because `doc-fixer` cannot do it: it carries no `Agent` tool, so a verdict can only ever be HANDED to it — and its instruction to take one reads as enforced while being unreachable if this pipeline never produces it.
4. **Fix.** For each area, dispatch one `doc-fixer` with exactly that area's findings and each finding's verdict. **Fixers must own disjoint files** (never two fixers on the same file) so parallel writes cannot collide. Route by verdict:
   - **LOCAL** → the fixer corrects the document.
   - **FOUNDATIONAL** → the document is not corrected. File the root item where [finding-depth.md](../../rules/finding-depth.md) § "Where a root item lives" says it goes — under `.agents/tasks/`, in the format [its README](../../tasks/README.md) defines — and register its GitHub issue, then take the disposition: **labelled containment** (hand the filed ID to `doc-fixer`, which writes the containment note at the claim, and the loop continues) or **re-plan** (the code is what changes next — **halt** this loop and report the finding with its item, per step 2). Search the Task tree before filing — the architecture pipeline often already owns an item for the same code-side cause, and its ID is the one to cite. Never hand a containment instruction without an ID: an unresolvable label is worse than no label.
   - **INVALID** → the premise does not hold. Record what the code actually does; do not let a wrong finding drive an edit.
   - **UNDETERMINED** → not a pass. Obtain the specific thing the verdict names as missing, then re-judge that finding at step 3.

5. **Re-audit.** Run `doc-auditor` again on the areas that changed — confirming both that each applied fix is correct AND that it introduced no new inconsistency (a fix can create fresh drift). A contained claim comes back `CONTAINED`, not as a finding, which is what lets a round with a foundational verdict in it still reach zero.
6. **Loop** the audit → depth → fix → re-audit cycle until step 2 reports convergence, or until the same finding set recurs unchanged — then STOP and escalate to the user ([no-progress escape](../../rules/enforcement-architecture.md), which owns what that means). Do **not** stop after one or two passes because "it looks done" — a large surface rarely converges that fast; keep going while any round still finds unresolved material drift. A **round cap** is only a safety checkpoint, never a finish line: on reaching it with material findings still open, pause and report the itemized residuals for a human decision — do not silently stop, and do not claim "docs current". Only a final, materially-resolved audit round licenses the "docs current" claim.
7. **Land** the result through the repo's normal review/CI/merge flow, and pass any root items filed at step 4 into the repo's gated backlog.

That is the whole skill. Everything else is the agents'.

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop documentation-refresh
node scripts/harness/loop-run.mjs round --loop documentation-refresh --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop documentation-refresh --run <id> --terminal <reason>
```
