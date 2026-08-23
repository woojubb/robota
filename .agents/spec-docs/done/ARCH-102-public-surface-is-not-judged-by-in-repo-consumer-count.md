---
status: done
type: RULE
tags: [architecture]
---

# ARCH-102: a public surface is not judged by its in-repo consumer count

Paired with
`.agents/tasks/ARCH-102-public-surface-is-not-judged-by-in-repo-consumer-count.md`.
Arising from [issue #2177](https://github.com/woojubb/robota/issues/2177) and the owner instruction
recorded in the Task.

## Problem

See the paired Task for the owner's verbatim instruction. The invariant it establishes:

> `packages/` is a library for composing agents. In-repo consumer count is not evidence about whether
> a surface should be public — at any count. The only grounds for narrowing or removing one are that
> it is genuinely unnecessary, or that it does not fit the design.

## Prior Art Research

Waived: this is an in-repo governance amendment stating an owner's product-identity decision about
this repository's own libraries. There is no external product whose documentation could settle whether
Robota's surfaces are meant for outside composition — the owner is the only source for that, and they
stated it directly. The waiver is recorded rather than the section left empty, per
[research.md](../../rules/research.md).

## Architecture Review

**The rule was already half-written, and the half that was missing is what let it be violated.**
§ Forward-Provisioned Surface Rule stated the negative (a count is not a reason) only for **zero**, and
never stated the positive. A reader who accepted it had no criterion left to apply — which reads as
"never narrow anything", is not the instruction, and is untenable, so in practice the reader fell back
on the count.

**Alternatives considered.**

1. **Amend the prose only.** Rejected on evidence. The prose already existed and was already violated;
   `check-contract-disposition.mjs`'s own header says so ("Prose did not hold, so this is the
   mechanical half"). Amending only the prose would repeat the experiment that failed.
2. **Weaken or exempt `check-orphan-exports`.** Rejected after reading it. Its logic is already
   correct — entry points, `package.json` export sources and barrel-re-exported modules are skipped at
   `check-orphan-exports.mjs:185-188`, so a `packages/` public surface is exempt by construction. The
   defect is that its FINDING TEXT says none of that and states the banned inference as the whole
   story. Changing the logic would have removed a working guard on the strength of a misreading of its
   message. **This is the alternative that nearly shipped**, because a session reported the scan as
   enforcing the inverse of the owner's instruction, and the report was persuasive until the exemption
   code was read.
3. **Amend the prose, the two audit criteria, the disposition skill, and the scan's message.** Chosen.
   The prose owns the invariant; the auditors are where the finding is generated; the skill is where a
   disposition is chosen; the scan message is what an agent acts on at 2am when a gate is red.

**Reachability.** The rule is reached from `.agents/project-structure.md`, which `AGENTS.md` routes to
as the SSOT for package layout. Both auditors and the skill now cite the section by name rather than by
line number — the line-number citations moved by 11 in this very change, which is the failure mode
being avoided.

**Capability preservation.** No guard is weakened. `check-orphan-exports` reports the same findings on
the same inputs — verified by running it before and after the message change. `check-contract-
disposition` is unchanged in behaviour; only its header citation and its proxy-signal table grew a row.

## Completion Criteria

- **TC-01** § Forward-Provisioned Surface Rule states the invariant at any consumer count, not only zero.
- **TC-02** It states the two affirmative grounds that DO support narrowing.
- **TC-03** `architecture-design-auditor` no longer asks whether a public symbol has a consumer.
- **TC-04** `architecture-structure-auditor` bounds what a low consumer count licenses.
- **TC-05** `contract-disposition` covers the one-consumer case and cites the rule by section.
- **TC-06** `check-orphan-exports`'s finding text states what it does not judge; its verdicts are unchanged.
- **TC-07** The sweep for contradicted documents is recorded with its result.
- **TC-08** `pnpm harness:scan` green.

## Test Plan

See the paired Task. The load-bearing check is TC-06's second half: the scan must report identically
before and after, since only its message changed.

## Evidence Log

| Claim                                                 | Verified at                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE-APPROVAL                                         | The owner instructed this change directly in the current conversation, in their own words (quoted verbatim in the paired Task), naming the target as the architecture design/audit rules. This is a direct instruction about a specific change, not a standing delegation, so the delegated-class question does not arise.                                                                                                                                                                                      |
| The rule covered only zero consumers                  | `.agents/project-structure.md` § Forward-Provisioned Surface Rule, pre-change first line                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The design auditor asked the banned question          | `.claude/agents/architecture-design-auditor.md` criterion 3, pre-change: "Does every public symbol have a real consumer?"                                                                                                                                                                                                                                                                                                                                                                                       |
| The same auditor contradicted itself                  | criterion 6, unchanged: "Has a necessary boundary been deferred merely because there is only one present consumer?"                                                                                                                                                                                                                                                                                                                                                                                             |
| `check-orphan-exports` already exempts public surface | `check-orphan-exports.mjs:185-188` — entry basenames, `package.json` export sources, barrel-re-exported modules                                                                                                                                                                                                                                                                                                                                                                                                 |
| The scan's message caused a real action               | A session cleared nine findings by unexporting, and reported that it did so because the scan was red rather than because it had judged the symbols internal                                                                                                                                                                                                                                                                                                                                                     |
| The message change altered no verdict                 | `node scripts/harness/check-orphan-exports.mjs` → "orphan export scan passed" before and after                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Sweep result                                          | `.claude/agents`, `.agents/rules`, `.agents/skills`, `.agents/specs`, `AGENTS.md`, `CLAUDE.md` and `scripts/harness/*.mjs` searched for consumer-count-as-reason. Two live carriers found and amended (`contract-disposition`, `check-contract-disposition` header). `finding-depth.md:156` matched on wording but concerns convergence conditions, not public surface — not a contradiction. Archived and completed records were deliberately NOT rewritten: a record describes the state when it was written. |

## Non-goals

- **Deciding any specific surface's fate.** Issue #2177 was answered by the owner (keep it public);
  this change is about the criterion, not the case.
- **Repairing every line-number citation into `project-structure.md`.** This change moved that file's
  lines by 11 and several open Task records now cite stale numbers. Some were already stale before this
  change, so repairing them means guessing what each meant. The general defect — line-number citations
  into a living document rot silently and nothing checks them — is filed separately rather than fixed
  opportunistically here.

## User Execution Test Scenarios

**Not applicable.** This change delivers rule text, two agent definitions, one skill, and the finding
message of one scan. No runnable user-facing product behaviour changes — no CLI command, TUI action,
browser flow, or public SDK surface. Per `.agents/tasks/README.md`, a rule-only change records the
not-applicable with its reason rather than inventing a product scenario; the checks that do apply are
in the Test Plan, and the load-bearing one is that `check-orphan-exports` reports identically before
and after, since only its message changed.
