---
name: pr-finding-resolution-loop
description: Drives a pull request to convergence by RESOLVING the findings its review automation produces — it does not review. Round A reviews the LOCAL diff once, before the pull request exists and while no reviewer has seen it, where a round costs a minute instead of a CI cycle; Round B reads what the pull request's automation reported, routes each finding to a verdict and a fix, pushes, and re-reads, looping until zero remain — no round cap (owner directive 2026-08-03); the only escape is progress detection. Then hands to the gated merge path. It routes only: it does not review, write, fix, or judge. Dispatching a reviewer on an OPEN pull request is the duplication this skill exists to prevent.
loop: over=finding-set; escape=no-progress
invocable: true
---

# PR Finding Resolution Loop

Route-only orchestrator for driving a PR to convergence. This skill manages ONLY the loop — it does not review,
post, fix, or judge; it routes on the reviewer's machine signal.

**Exactly one reviewer owns a diff at a time.** Before the pull request exists (Round A) the reviewer is
`pr-review-reviewer` on the local diff, because nothing else has seen it and a round there costs a minute
where the same round after a push costs a CI cycle. Once the pull request is open (Round B) the reviewer
is the automation the PR runs, and this loop's job is to RESOLVE what it reports — never to review it
again. All fixing lives in
`pr-review-fixer`; all posting lives in `pr-review-writer`.

## Rule Anchor

- [enforcement-architecture.md](../../rules/enforcement-architecture.md) — worker / guardian / orchestrator; hybrid loop-back.
- [git-branch.md](../../rules/git-branch.md) — Pre-Merge Code-Review Gate; agent never merges `main`; delete-after-confirm.
- Reviewer/writer/fixer agents in `.claude/agents/pr-review-*.md`.

## When to Use

Invoke on an open PR that needs review → converge → merge.

## Invocation — async (018a) and its honest limit

Run this loop in the **trusted local session** (it holds the checkout + keys; the fixer must never run
untrusted fork code in a privileged CI runner — that is the `pull_request_target` pwn surface the design
rejects). Two modes:

- **Async execution (available now).** The calling session spawns this orchestration as a **background Agent**
  (the Agent tool's `run_in_background`), so the caller is not blocked while the reviewer→fixer loop runs.
  This is the same background-agent mechanism used elsewhere in the harness.
- **Automatic on-PR triggering (out of scope).** There is no server-side webhook that fires this without a
  running agent host, because the only server-side option (`pull_request_target` executing fork code with
  secrets) is rejected on security. So firing is: the calling session (or a human) starts it when a PR is up.
  GitHub Actions on the plain `pull_request` event remains only the required-check floor (`ci.yml`).

## The Loop (route-only)

The loop runs in TWO places, and which one comes first is the whole point.

### Round A — on the LOCAL DIFF, before the pull request exists (required, once)

**Round A runs before there is a pull request, and stops the moment one is open.** From then on the
reviewer is the automation the pull request runs, Round B is the only round, and a push exists to
deliver resolutions rather than to buy another opinion. Running A on an open pull request is the
duplication this skill exists to prevent — it does not add a reviewer, it multiplies the remote ones,
because each local round ends in a push and each push buys another remote review of the same change.
`pre-push-check` decides this the same way and waives its demand for exactly that case; the two must
keep saying one thing.

Measured across one session (2026-07-28), PRs #1514/#1518/#1519/#1520/#1521: 38 review rounds, 24 of them
carrying a blocking finding, at 6–10 minutes of CI each. Not one of those findings needed CI to be visible —
every one was read out of the diff. Several were regressions introduced by the previous round's fix, which a
review of the NEXT diff would have caught just as cheaply. This loop used to wait for required checks to go
green before its first review round, so the reviewer only ever saw a diff that had already been pushed,
opened as a PR and run through CI: every finding cost a round trip before anyone could look at it.

`pr-review-reviewer` already accepts a local diff (`git diff origin/<base>...HEAD`) — only the precondition
forced the trip. So:

A1. **Review the local diff.** Dispatch `pr-review-reviewer` with `git diff origin/<base>...HEAD`. No PR, no
CI, no push. Read its terminal `ACTIONABLE FINDINGS: <n>`.
A2. **Not zero?** Dispatch `finding-depth-triager` on the findings and route on its `DEPTH:` verdicts —
the judgement is the guardian's, the routing is this skill's, and neither does the other's job. Required by
[finding-depth.md](../../rules/finding-depth.md), which owns the three questions and what each verdict requires:

- **LOCAL** → fix (`pr-review-fixer` or directly), commit, and repeat A1. A round here costs about a
  minute. The same round after a push costs a CI cycle.
- **INVALID** → the premise does not hold. Nothing to fix; record what the code actually does, and do not
  let a wrong finding drive a change.
- **UNDETERMINED** → not a pass. Obtain the specific thing the verdict names as missing, then re-run
  A1 on that finding. Treating it as LOCAL is how a guess enters the loop wearing a verdict's clothes.
- **FOUNDATIONAL** → do NOT send it back into the fix loop. File the root item where
  [finding-depth.md](../../rules/finding-depth.md) § "Where a root item lives" says it goes — under
  `.agents/tasks/`, in the format [its README](../../tasks/README.md) defines — register its GitHub
  issue, then take the disposition: **re-plan** (the change is withdrawn or reduced) or
  **labelled containment** (the smallest hold, opening `Contained — <ID>.` in a code comment, and naming
  the item's ID in the commit body).
  Record the IDs with the round: `pnpm harness:review:record -- --findings 0 --foundational <ID>[,<ID>...]`.
  Then **return to A1**: the containment is a change like any other, and the next round reads it.
  Push is A3's, and only once a round comes back zero.

A loop that fixes every finding where it was reported converges just as cleanly as one that does not, which
is why the depth question has to be asked before the fix rather than noticed afterwards.

**Depth is judged locally, and only locally.** The CI reviewer produces findings and severity; it has no
depth verdict to give and must not be asked for one. It reads a diff with no checkout history, cannot run
the guardian, and — the part that matters — a verdict produced where nothing can act on it is a verdict
nobody takes. This session holds the checkout, the history and the tools, so the judgement belongs here.
What travels back to the PR is the DECISION, not the reasoning — Round B step 2 is where that happens,
because that is where the CI comments exist.

A3. **Record the verdict.** When the findings count is zero, record it with
`pnpm harness:review:record -- --findings 0`; when non-zero, record the actual count and resolve each
finding. **Before every next action, read the latest verdict and stop until it is recorded.** A further
push, rebase, or merge requires the exact `POST_FINDINGS_ACTION_REQUEST` comment and maintainer approval
defined in `git-branch.md`, including the latest verdict count and head, action, ground, inspectable
evidence, and scope. Never substitute a private judgement or local review record.

`pre-push-check` enforces A3: a feature-branch push whose HEAD has no matching record is refused, naming
`PRE_PUSH_ALLOW_UNREVIEWED=1` for a deliberate exception. The record says a review RAN at this commit and
reported zero gating findings; it does not claim the review was good, which is the reviewer's job and not a
hook's. Integration branches and `release/promote-*` are exempt — a promotion carries develop's
already-reviewed content and no diff of its own. **A branch with an open pull request is exempt too**, for
the reason at the top of this round: the demand would be for a second review, and the hook says so on the
way through rather than waiving it silently.

### Round B — on the open PR, before merge

Track: `last_findings = {}` (set of finding identities `file:line + severity`).

0. **Wait for the gate precondition** the rule sets (required checks green): dispatch
   [ci-gate-watch](../ci-gate-watch/SKILL.md) on the PR's checks. `GREEN` → step 1. `RED` or `STALLED` →
   **leave the loop** and route it as a build/test failure under the verification rules, not as a review
   finding; re-enter here once the head is green. This precondition belongs HERE and only here: the merge
   round must judge what will actually merge, and `merge-gate` requires a verdict for the exact current
   base/head SHA pair.
1. **Read the review CI produced. Do not perform one.** The reviewer on an open PR is the review
   automation the pull request runs; this loop RESOLVES what it reports. Fetch its findings —
   [automated-review-convergence](../automated-review-convergence/SKILL.md) owns that procedure,
   including the trap that a green check is not an absence of findings — and count the actionable ones.
   (Do NOT judge them yourself at this step — take the set as given; judging is step 2.)

   **Dispatching a reviewer agent here is the defect this step exists to prevent.** It pays for the
   review twice, and the second opinion is the one without the PR's comment history, so it cannot see
   which findings a previous round already answered. A local reviewer belongs in Round A, BEFORE the
   push, where its whole purpose is to spend a minute instead of a CI cycle.

2. **Take each comment one at a time, judging before replying.** CI posts a summary comment and inline
   comments; each carries a finding and each is judged on its own — `finding-depth-triager` returns one
   verdict per finding, not one per round, because a PR routinely mixes a LOCAL defect with a FOUNDATIONAL
   one and a premise that does not hold. For each: obtain the verdict, decide the handling, then hand the
   decision to `pr-review-writer` to post — inline where the finding was inline. **Judge before replying,
   never after**: a reply written first becomes a commitment the verdict then has to agree with.

   Posting is the writer's, not this skill's. An orchestrator that writes to the PR is the produce-and-route
   violation this file declares against itself two sections down, and it would be the fourth instance in this
   change of a boundary stated and then crossed.

   What gets posted is the DECISION, not the reasoning. For a foundational one that is the verdict, the root
   item and its issue, and the disposition taken. This is not bookkeeping: a finding correctly left unfixed
   looks identical to one that was ignored — to the next reviewer, to the merge gate, and to anyone reading
   the PR later. It is the visible half of the containment label, which otherwise lives only in a code
   comment and a commit body the PR page never shows.

   **EVERY finding gets a reply, and an ACCEPTED one most of all.** The natural pull is the opposite: a
   refutation feels like it owes an argument, while a fix feels self-evident. It is not. The fix lands in a
   commit the thread does not link to, so on the PR page an accepted finding and an ignored one are the same
   thing — a comment with no answer under it. Measured once: 27 inline threads left open across 18 merged
   pull requests, every finding genuinely fixed, not one of them answered where it was raised.

   **Then RESOLVE the thread.** Replying is the answer; resolving is what tells the next reader the answer
   is final. A thread left open says the conversation is still going. Resolve only after the reply is
   posted and the fix is pushed — resolving first hides a finding instead of closing it, which is the one
   direction this step must never trade in.

   Mechanically enforced: `merge-gate` refuses a merge while any review thread is unresolved, and refuses
   equally when it cannot read their state. That is the floor, not the rule — the rule is that a reader can
   tell a handled finding from an ignored one without opening the commit log.

3. **Converged?** If `n == 0` → go to **Merge path**. The count is a **resolved** count, not a fixed one:
   a finding is out of it when it is corrected, contained under a filed root item, or recorded INVALID.
   `pr-review-reviewer` does not raise a hold that already carries its `Contained — <ID>.` comment, which
   is what lets a round holding a foundational verdict reach zero without anyone patching the wrong layer
   to get there — the whole reason the label is a condition and not a courtesy
   ([finding-depth.md](../../rules/finding-depth.md)). Re-plan is not a resolution: it withdraws or
   reduces the change, so it **halts** this loop rather than counting toward zero.
4. **Progress detection — the only escape.** If the current finding-identity set equals `last_findings` (the
   same findings recurred unchanged) → **STOP and escalate to the user** (the loop is stuck; do not spin).
   Else set `last_findings` to it and continue. There is **no round cap**, and asking the user "another
   round or merge?" is not a step of this loop: the stopping condition is zero.

   Owner directive, 2026-08-03: _"라운드는 계속 돌려. 앞으로도"_ — keep running the rounds, from now on too.
   It replaced an `iteration >= 3` cap whose action was **STOP and escalate**, so what the cap bought
   was not a merge but a question, and the directive is that the question is the wrong move.

   The evidence is the PR open when it was given (#1615), stated as the counterfactual it actually is:
   the cap would have halted the loop after round 3 and handed back an unconverged PR whose state then
   still contained round 4's findings — among them `README.md`'s Quick Start naming `agent-provider`,
   a package that does not exist and that the owning document says does not exist, in a front-door
   document, in the very PR whose HARNESS-068 is about a front-door document naming a package that
   does not exist. Verified rather than asserted: that line is unchanged from the merge-base through
   round 3's head.

   (Two earlier versions of this paragraph were wrong. The first said the PR "would have merged" with
   three defects it named: the cap escalates rather than merges, and two of the three — the
   `agent-transport-webrtc` and `-protocol` npm links — were introduced at round 5, after the cap
   would have fired. The second said all three postdated the cap; the third, `agent-provider-bytedance`,
   is PRE-EXISTING — a 404 npm link in the "start here — the minimal set" table, unchanged from the
   merge-base through round 3's head — which strengthens the counterfactual rather than weakening it.
   A rationale for removing a bound, wrong twice, in the paragraph telling the next reader not to
   restore it. Rounds 8 and 9 caught them.)

   A stuck loop and a productive one look the same to a counter and different to the finding SET,
   which is why that is the test kept. The cost is real and is the point: rounds are not free, and the
   owner has priced them. Do not reintroduce a cap without the owner.

5. **Record + fix.** Dispatch `pr-review-writer` (posts the review to the PR), then `pr-review-fixer` (applies the
   MUST/SHOULD fixes). Each fix returns to **Round A** — review the new local diff and record it before pushing
   again — then go to step 1.

## Merge path (on `ACTIONABLE FINDINGS: 0`)

Hand to the gated merge path (detailed wiring is HARNESS-018d). The gate is mechanical:
`.claude/hooks/merge-gate.sh` refuses `gh pr merge` unless CI is `CLEAN` and the newest verdict names
the exact current `headRefOid` and a base that is the base branch's live tip (read with
`git ls-remote` — GitHub's `baseRefOid` lags the branch, issue #2309) or moved over no file the PR
touches (PROC-016), and refuses outright while
`ACTIONABLE FINDINGS: <n>` is non-zero — so a step of this pipeline cannot be skipped by merging
directly. A newer timestamp cannot substitute for that pair because the base may change without a
new child-head commit.

It also refuses while any of the reviewer's inline finding threads is unanswered. Resolved with no
reply under it counts as unanswered: anyone can resolve a thread, and a finding with no reply is the
state this loop exists to make visible.

It MUST honor [git-branch.md](../../rules/git-branch.md):

- Merge allowed only when there is **no unresolved MUST** and **every SHOULD is fixed or filed-and-linked** as a
  justified backlog item (never silently deferred), AND required CI checks are green.
- `develop`: gated admin-merge, then hand to [post-merge-cycle](../post-merge-cycle/SKILL.md) — which
  requires `merge-verifier`'s `MERGE VERIFIED: PASS` before it will delete anything, and owns the branch
  deletion and base-reset steps. Do not verify, delete, or re-base here.
- `main`: **do NOT merge.** Enable auto-merge / mark ready and hand to the user — the agent never merges `main`.

## What This Skill Does NOT Do

| Not this skill's job                   | Owner                                            |
| -------------------------------------- | ------------------------------------------------ |
| Judge findings / assign severity       | `pr-review-reviewer` (guardian)                  |
| Post the review to the PR              | `pr-review-writer` (worker)                      |
| Reply on each finding and RESOLVE it   | `pr-review-writer` (worker) — inline, per thread |
| Edit/fix code                          | `pr-review-fixer` (worker)                       |
| Decide the PR is "good"                | the reviewer's `ACTIONABLE FINDINGS` count       |
| Merge `main`                           | the user (never the agent)                       |
| Verify the landing / delete the branch | [post-merge-cycle](../post-merge-cycle/SKILL.md) |

If you find yourself reviewing, writing, or fixing inside this skill, stop — route to the owning agent instead.

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop pr-finding-resolution-loop
node scripts/harness/loop-run.mjs round --loop pr-finding-resolution-loop --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop pr-finding-resolution-loop --run <id> --terminal <reason>
```
