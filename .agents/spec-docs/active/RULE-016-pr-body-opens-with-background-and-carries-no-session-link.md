---
status: in-progress
type: RULE
tags: [harness]
---

# RULE-016: a PR body opens with what was broken and for whom, and carries no agent-session link

## Problem

PR #2402 was opened on 2026-08-28 (01:17 KST) with a body whose first substantive section — after
an H2 title, a `Closes` line and a records line — was

```
### Accepted recommendation
A2 — identity measurement plus per-test home isolation, labelled. …
**REVIEW VERDICT:** `proposal-reviewer` REVISE → REVISE → **ENDORSE** …
```

and whose last lines were `🤖 Generated with Claude Code` and `https://claude.ai/code/session_…`.
Every commit on that branch, and on PR #2396's, carries a `Claude-Session: https://claude.ai/code/session_…`
trailer. The owner rejected both: "왜 pr올리는데 내 클로드 세션 링크까지 같이 올리는거야? 그리고 pr에는
왜 배경이나 목적이 제대로 설명이 안되어 있는거야?" — rewrote the body by hand three minutes later
(GraphQL `userContentEdits`, 16:20:49Z) — and asked that the rule live in the repository.

Measured on `develop` `63ee7f22d` (2026-08-28):

- `.agents/rules/backlog-execution.md` § PR Unit Rule, last bullet: "Every PR description must
  include the accepted recommendation, its `REVIEW VERDICT`, rationale, implementation summary, tests
  run, user execution test scenario gate result or not-applicable reason, and residual risks."
  Fields only — no order, no background, no purpose. PR #2396's body IS that field list rendered in
  the bullet's own order; the shape was not invented, it was the contract read literally. The bullet
  was written 2026-05-09 (`5cf55a16a`) and never reshaped.
- **The PR body has three owner documents that do not cite each other.** `.github/PULL_REQUEST_TEMPLATE.md`
  and `.github/pull_request_template.md` (byte-identical, added 2026-05-10 and 2026-07-23) order the
  body for human authors: `## Summary` → `## Related issue` → `## Type of change` →
  `## How was this tested?` → `## Checklist`. `agent-conduct.md:65-67` says PR descriptions are
  "prose without bullets, numbered lists, or excessive bolding". The owner's exemplar body on PR #2402 is
  headings and bullets throughout. Of the 59 merged PRs before PR #2402 the opening line takes at least
  eight shapes (`## What` 14, `Closes #N` ~17, `## Summary` 2, `## Accepted recommendation`, …) and
  none opens with background; of the last 80, one carries `## Background` — the hand-rewritten PR #2402.
- Session links: 91 of the last 200 merged PRs carry the footer or the URL; 1105 of 4813 commits
  carry `Claude-Session:` (2630 trailer lines — squash merges repeat them), the first on 2026-06-20. The trailer and the footer come from the agent
  harness's default instructions; `git grep -n "claude.ai/code\|Claude-Session\|Generated with" -- .agents .claude/hooks commitlint.config.js scripts/harness`
  finds one hit, a completed record's note (`PROC-012-….md:100`) — no rule, no refusal.
- The surfaces that already judge these artifacts: `commitlint.config.js` carries a plugin rule
  (`reference-kind`) reached by `.husky/commit-msg` and by the required `commitlint` check, with the
  wiring test `scripts/harness/__tests__/reference-kind-commitlint.test.mjs`; `review-gate.yml` is a
  required check on `protect-develop`, subscribes to `opened/synchronize/reopened/edited`, and reads
  the PR before any checkout (the finding-depth disposition step, PROC-007) — its own comment states
  why a hook cannot be the primary floor for a PR-level property ("a hook cannot see an auto-merge
  that GitHub fires on its own; only this job can"). `merge-gate.sh` reads labels, merge state, OIDs
  and comments — never the body.

**Reproduction condition.** Any PR opened, or commit written, by an agent whose harness defaults
append a session link, against a body contract that names fields but not order — and any human PR
written from the template, which follows a different order than the agent rule.

## Prior Art Research

Waived: the content of the rule is the owner's stated preference, and the floors reuse mechanisms
this repository already owns — `reference-kind`'s commitlint plugin shape, and `review-gate.yml`'s
read-the-PR-before-checkout step (PROC-007), whose comment already states the layering this document
follows. GitHub's own guidance that a pull request description explain "why" before "what" says
nothing the owner did not.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable**. Rule documents, a PR template, a commit-message lint
rule, a required-check step with its script, and a memory record change; no product surface changes.
Both floors are already wired (`.husky/commit-msg` and the required `commitlint` check; the
`review-gate` workflow trigger and the `protect-develop` ruleset), so no seam awaits a surface. The verification surface is the
fixture tests, each with its refusing path exercised, and the mutation.

## Depth verdict and re-plan

`finding-depth-triager` (2026-08-28) returned **FOUNDATIONAL**: the PR body has no single owner
document, and fixing at the reported site — an order appended to the rule and a heading regex in the
merge gate — would leave the template contradicting the rule, make the gate refuse the template's own
shape, and put the conduct clause at odds with the exemplar it is supposed to describe. The owner chose
**re-plan** on 2026-08-28: this item becomes the root — one contract for the PR body — rather than a
containment under one. The owner also decided the `Claude-Session:` trailer is prohibited in commits
as well as in PR bodies: attribution is the work-item ID and issue number the commit body already
names (issue #2135 / PROC-012 used the trailer once to find an orphaned branch; a shared record should not
depend on a private link for that).

## Architecture Review

### Affected Scope

- `.agents/rules/backlog-execution.md` § PR Unit Rule — becomes the PR body's single owner: the
  ordered sections, the prohibition, `Enforced by:`
- `.agents/rules/git-branch.md` § Git Operations — the commit-message half (no session trailer/URL),
  beside the conventional-commit bullet, `Enforced by:`
- `.agents/rules/agent-conduct.md` — the formatting clause stops naming PR descriptions as prose and
  the structured-artifact boundary names the PR body's owner
- `.github/PULL_REQUEST_TEMPLATE.md` — rewritten to the contract's order; `.github/pull_request_template.md`
  (byte-identical duplicate) deleted
- `scripts/harness/check-pr-body.mjs` — the body judgement (first heading, session link, footer),
  exported and testable; `scripts/harness/__tests__/check-pr-body.test.mjs`
- `.github/workflows/review-gate.yml` — a step in the `review-gate` job directly after its
  `ref: base.sha` checkout and before the first classify-gated step, feeding
  `github.event.pull_request.body` to the script through `env:`; pinned by a workflow case in
  `check-pr-body.test.mjs`
- `commitlint.config.js` — `no-session-link` rule in the existing plugin entry;
  `scripts/harness/__tests__/no-session-link-commitlint.test.mjs`
- `.agents/memory/pr-body-background-first-no-session-link.md` + `MEMORY.md` — the owner's words and a
  pointer to the owner document (memory-mirroring.md §3–4: point, do not restate)
- `.agents/specs/harness-composition-inventory.md` BE-13 — wording updated to the ordered contract
- No package, app or product surface

### Alternatives Considered

**A1 — Rule text only.**

- Pro: one paragraph.
- Con: the defect came from a harness default that reasserts itself every session, on top of a
  contract nobody had read as a shape; prose alone is what produced PR #2396. `enforcement-architecture.md`:
  prose does not enforce.

**A2 — Rule text plus floors in `commitlint` and `merge-gate.sh` (this document's first draft).**

- Pro: two refusals added to mechanisms with existing tests and override forms.
- Con: three defects, found in review. The merge gate is reached only by a `gh pr merge` typed inside
  Claude Code — auto-merge and the web UI never meet it — while `review-gate.yml`'s own comment names
  that hole. A "`## Background` exists somewhere" check measures presence, not "opens with": append the
  heading under `### Accepted recommendation` and it passes. And the check would refuse the
  repository's own template, because the template was left as a second contract.

**A3 — A `gh pr create` / `gh pr edit` command hook.**

- Pro: earliest feedback.
- Con: the body reaches `gh` as `--body-file <path>` or a `--body "$(cat <<'EOF' …)"` heredoc, and
  extracting an argument's VALUE from a shell string is what no hook here does — `hook_verb_scan`
  masks quoted regions as data by design. (The first draft cited HARNESS-061's truncation; that item
  is `done` since 2026-07-30 and is not the obstacle.) A required check on `opened`/`edited` fires
  within a minute of the same commands, without parsing any shell.

**A4 — The `.github` template as the floor.**

- Pro: GitHub pre-fills the headings for human authors.
- Con: `gh pr create --body-file` replaces the template entirely, so it reaches no agent-opened PR. It
  stays as the human author's copy of the contract — aligned, not a floor.

**A5 — One contract, three documents aligned, floors at the surfaces that already judge the artifact
(chosen).** § PR Unit Rule owns the ordered body; the template is rewritten to it and its duplicate
deleted; the conduct clause points at it. `review-gate` judges the body through a node script loaded
from the BASE revision — the step sits directly after the job's `ref: base.sha` checkout, before any
PR code is resolved, with no `if:` so docs-only PRs and label re-evaluations are judged too: the
first heading line is `## Background`, and the body matches neither `claude\.ai/code/session` nor
the Claude Code footer; an empty or unreadable body is a refusal, never a pass. The body reaches the
step through `env:` (it is attacker-controlled on a fork PR), and the refusal is written to the step
summary and as `::error::` lines before `exit 1` — no PR comment, because the job's supersession
logic keys on its `Review gate: BLOCKED` header and only posts a PASS supersession when code changed,
so a docs-only PR fixed by `gh pr edit` would keep a stale BLOCKED comment forever. `commitlint` refuses `^Claude-Session:` and the session URL. `merge-gate.sh` is not
mirrored: it already refuses when `mergeStateStatus` is not `CLEAN`, which a red required check
guarantees, and mirroring would cost a body read plus stub rewrites in two test suites for a path the
required check already closes.

- Pro: one fact, one owner; the floor is positional (opens with), required on every merge path, and
  fires on `gh pr edit` as well as `gh pr create`; the judgement is a script with its own tests rather
  than a regex in YAML; the template can no longer contradict the floor because a test feeds the
  template's own first heading to the script.
- Con: the floor judges only the first heading and the links — the rest of the order is prose-owned
  and the `Enforced by:` line says so. Promotion PRs (`develop → main`) are judged too — `review-gate`
  runs on both branches and a red run disarms auto-merge on `main` — so one contract means a
  promotion body opens with `## Background` and ends with the `Closes` block `promotion-closes`
  requires; `promote.mjs`'s printed `gh pr create` hint gains one line saying so. Delivery is two
  sequenced PRs (see § Delivery) because the step loads the judge from the base revision. One
  interaction recorded: issue #2250 is OPEN — a `gh pr edit`
  right after a push cancels the in-flight `claude-code-review` run and nothing replaces it — so a body
  fixed by edit after a push costs a re-run; that defect is issue #2250's, not folded in.

### Decision

**A5.** A1 restates the failure mode; A2 places the floor where auto-merge cannot see it and measures
presence for position; A3 needs shell-argument extraction no hook does; A4 reaches no agent PR. The
trade accepted: two more documents change (template, conduct clause) so that the contract has one
owner and the floor cannot contradict any of them.

**Delivery — two sequenced PRs, and why.** The `review-gate` job checks out the BASE revision
(`review-gate.yml:168-172`: the judge must never be PR-controlled code), so the PR that adds both the
script and the step would fail its own required check with the script absent at base — and
fail-closed forbids tolerating "the judge could not run" as a pass. **PR 1** lands the judge
(`check-pr-body.mjs` + its tests + the template binding), the template rewrite and duplicate
deletion, the commitlint rule + its test, and the git-branch.md commit bullet whose floor that rule
is — so the commit half is whole in one PR. **PR 2**, cut after PR 1 is on `develop`, lands the
workflow step + its pin test, § PR Unit Rule and the conduct clause (their `Enforced by:` names the
step), the `promote.mjs` hint line, the memory record, the inventory row,
`required-status-checks.json`'s `verifies` and the mirror-map entry. The PR Unit Rule's "rule +
enforcement + wiring in one PR" preference yields to the trust design that forces the split.

**Why this is one recommendation gate, not two.** § PR Unit Rule's "split into explicitly named work
units, each with its own recommendation gate" bullet is triggered by size; this split is forced by
sequencing, which the rule's "Sequence by relatedness" bullet covers as "one ordered unit, or
sequential PRs on the same seam". There is one cause and one verification plan; PR 1 alone is not an
independently verifiable outcome (a judge nothing invokes). Every file in both PRs is enumerated
here, so each PR's content is checkable against this one gate. The spec stays `active` across both
PRs; GATE-VERIFY and GATE-COMPLETE run on PR 2, and PR 1's body names the TCs it already proves
(TC-02, TC-03, the judge half of TC-04, and their TC-05 arms).

### Architecture Review Checklist

- [x] Affected package/layer list complete — three rule documents, one template (one deleted), one
      workflow step, one script, one commitlint rule, three tests, one memory record, one inventory
      row, the required-checks `verifies`, the mirror-map entry, the promotion hint
- [x] Sibling scan complete — `N/A for new-surface placement`: no package, app, presentation or
      interface surface. Siblings examined: `reference-kind` (the commitlint plugin shape reused);
      the PROC-007 disposition step in `review-gate.yml` (the read-the-PR-in-the-required-check shape
      reused; its own classifier pin is unfalsifiable — issue #2407, filed, not copied);
      `promotion-closes` (reads PR bodies at promotion for `Closes #N` — a different moment and
      field, left as is); `merge-gate.sh` (not mirrored, reason stated in A5).
- [x] At least 2 alternatives reviewed — A1–A5
- [x] Decision rationale documented — one owner for the fact; the floor at the required check the
      repository's own comment names as the only surface that sees every merge

## Fallback & Degradation Declaration

None. Two refusals are added; an unreadable PR body fails the check rather than passing it.

## Solution

1. **Owner rule.** § PR Unit Rule's fields bullet becomes: a PR description MUST open with
   `## Background` (what is broken, who is affected, why it matters), then `## Purpose`,
   `## What changes`, `## Why this way` (the accepted recommendation, alternatives, `REVIEW VERDICT`,
   depth verdict), `## How it was verified` (tests run; user-execution gate result or not-applicable
   reason), `## Not in this PR` (residual risks, filed items), then `Closes #N`. A PR body MUST NOT
   carry an agent-session link (`claude.ai/code/session…`) or a "Generated with …" footer.
   `Enforced by: \`review-gate\` (pr-body step: judges the first heading and the links, not the order
   of the later sections)`. Wording constraints from `scan-new-rule-declares-enforcement.mjs`: the
MUST/MUST NOT keyword must appear before the first period of the bullet's first line (no bold
lead-in ending in a period), the two prohibitions are one bullet so one `Enforced by:`covers
them, and the`Enforced by:` line is contiguous with the bullet.
2. **Commit half.** git-branch.md § Git Operations, beside the conventional-commit bullet: a commit
   message MUST NOT carry a `Claude-Session:` trailer or an agent-session URL; `Co-Authored-By` stays.
   `Enforced by: \`no-session-link\` (commitlint)`.
3. **Conduct clause.** agent-conduct.md's formatting bullet drops "PR descriptions" from its prose
   list; the structured-artifact boundary names the PR body as owned by § PR Unit Rule.
4. **Template.** `.github/PULL_REQUEST_TEMPLATE.md` rewritten to the seven sections with one-line
   prompts (the checklist folded under `## How it was verified`); `pull_request_template.md` deleted.
   The template's prompts must not spell the forbidden strings (a comment saying "do not paste the
   Generated with … footer" would make the binding test refuse the template).
5. **Script + step.** `scripts/harness/check-pr-body.mjs` exports `judgePrBody(body) → { ok, problems[] }`
   (first heading line must be `## Background`; refuse `claude\.ai/code/session`; refuse
   `/Generated with .*Claude Code|🤖 Generated with/`; an empty or non-string body is a problem) and,
   run as a script, reads `process.env.PR_BODY`, writes each problem to `$GITHUB_STEP_SUMMARY` and as
   `::error::`, and exits 1 on any. In `review-gate.yml`'s `review-gate` job the step sits directly
   after the `ref: ${{ github.event.pull_request.base.sha }}` checkout and before the first step
   gated on `needs.classify.outputs.code`, carries no `if:`, passes the body via
   `env: PR_BODY: ${{ github.event.pull_request.body }}`, and posts no comment. Local equivalent:
   `gh pr view <n> --json body -q .body | PR_BODY="$(cat)" node scripts/harness/check-pr-body.mjs`.
   `.github/required-status-checks.json`'s `verifies` for `review-gate` and
   `scripts/harness/ci-mirror-map.mjs`'s `reason`/`relevantWhen`/`manualCommand` for it are updated to
   say the check also judges every PR's body and name that local equivalent (the CodeQL half stays
   un-mirrorable). `relevance` is a KEY the local runner evaluates (`ci-mirror-map.mjs:197`;
   `verify-like-ci.mjs:745` reads `'code'` as `productChanged`), so the entry's `relevance: 'code'`
   would print `review-gate` as not relevant on a docs-only branch that the required check will
   block: a new key `'every-pull-request'` is added to `RELEVANCE_KEYS` with an evaluator branch
   returning `true` and assigned to the `review-gate` entry (`ci-mirror-map.test.mjs` already
   enforces the key set). The step carries no `if:` for every PR, which is safe here because every PR
   author is the owner (no bot PRs: the 200 most recent are all `woojubb`; no dependabot/renovate
   config).
6. **Commitlint.** `no-session-link` added to the existing plugin's `rules` (one plugin entry).
7. **Tests.** `check-pr-body.test.mjs`: refuse (no heading first / heading later / session URL /
   footer / empty), accept (compliant body), and the template binding — the template file's first
   heading satisfies the judge. A workflow-pinning case sliced from the
   `ref: base.sha` checkout (`review-gate-workflow-order.test.mjs` already pins it): the pr-body step
   follows that checkout, precedes the first step carrying `if: needs.classify.outputs.code == 'true'`,
   contains no `if:` line, and invokes `check-pr-body.mjs`. `no-session-link-commitlint.test.mjs`: trailer refused, URL-in-body refused, clean
   message with `Co-Authored-By` accepted.
8. **Promotion hint.** `scripts/harness/promote.mjs`'s printed `gh pr create` hint gains one line
   saying the promotion body opens with `## Background` and ends with the `Closes` block
   `promotion-closes` requires (the scan checks presence of the keywords, not their position — the
   position is this contract's).
9. **Memory.** `.agents/memory/pr-body-background-first-no-session-link.md`: the owner's words, the
   date, issue #2403, and a pointer to § PR Unit Rule; one line in `MEMORY.md`.

## Affected Files

| File                                                            | Change                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| `.agents/rules/backlog-execution.md`                            | § PR Unit Rule: ordered body, prohibition, Enforced by              |
| `.agents/rules/git-branch.md`                                   | § Git Operations: commit trailer prohibition, Enforced by           |
| `.agents/rules/agent-conduct.md`                                | formatting clause + structured-artifact boundary                    |
| `.github/PULL_REQUEST_TEMPLATE.md`                              | rewritten to the contract                                           |
| `.github/pull_request_template.md`                              | deleted (duplicate)                                                 |
| `scripts/harness/check-pr-body.mjs`                             | new judge                                                           |
| `scripts/harness/__tests__/check-pr-body.test.mjs`              | new                                                                 |
| `.github/workflows/review-gate.yml`                             | pr-body step after the base-sha checkout                            |
| `commitlint.config.js`                                          | `no-session-link` rule                                              |
| `scripts/harness/__tests__/no-session-link-commitlint.test.mjs` | new                                                                 |
| `.agents/memory/pr-body-background-first-no-session-link.md`    | new pointer record                                                  |
| `.agents/memory/MEMORY.md`                                      | index line                                                          |
| `.agents/specs/harness-composition-inventory.md`                | BE-13 wording                                                       |
| `.github/required-status-checks.json`                           | `review-gate` `verifies` wording                                    |
| `scripts/harness/ci-mirror-map.mjs`                             | `review-gate` relevance key + reason / relevantWhen / manualCommand |
| `scripts/harness/promote.mjs`                                   | one line in the printed `gh pr create` hint                         |

## Completion Criteria

- [ ] **TC-01** § PR Unit Rule states the seven ordered sections and the no-link prohibition with
      MUST/MUST NOT phrasing and an `Enforced by:` line naming `review-gate` and its limit; git-branch.md
      § Git Operations states the commit prohibition with `Enforced by: no-session-link`;
      agent-conduct.md no longer lists PR descriptions under prose and its boundary names the owner;
      `new-rule-declares-enforcement` examines ≥ 1 added rule bullet and passes.
- [x] **TC-02** (PR 1) `.github/PULL_REQUEST_TEMPLATE.md` opens with `## Background` and carries the seven
      sections in the contract's order; `.github/pull_request_template.md` no longer exists; a test
      feeds the template's first heading to `judgePrBody` and it passes.
- [x] **TC-03** (PR 1) `printf 'fix(x): probe\n\nClaude-Session: https://claude.ai/code/session_x\n' | npx commitlint`
      exits non-zero naming `no-session-link`; a message with the URL in its body exits non-zero; the
      same subject with only `Co-Authored-By: …` exits 0.
- [ ] **TC-04** `judgePrBody` refuses: a body whose first heading is not `## Background`; a body with
      `## Background` after another heading; a body containing `claude.ai/code/session…`; a body
      ending in `🤖 Generated with Claude Code`; an empty body — each naming the problem; and accepts a
      compliant body. In `review-gate.yml`'s `review-gate` job the pr-body step follows the
      `ref: ${{ github.event.pull_request.base.sha }}` checkout, precedes the first step gated on
      `needs.classify.outputs.code`, carries no `if:`, passes the body through `env:`, and invokes
      `check-pr-body.mjs` — pinned by test.
- [ ] **TC-05** Applied-check mutation: disabling the commitlint rule makes TC-03's refusing cases
      pass (test red); making `judgePrBody` return `ok: true` unconditionally makes TC-04's refusing
      cases pass (test red); adding `if: needs.classify.outputs.code == 'true'` to the pr-body step,
      or moving it above the checkout, makes TC-04's workflow pin red. Restored byte-identical.
- [ ] **TC-06** `pnpm harness:scan` exits 0 (`workflow-permissions`, `action-references`,
      `memory-mirror`, `new-rule-declares-enforcement` read); `required-status-checks.json` and
      `ci-mirror-map.mjs` describe the body half of `review-gate` and its local command, and the
      mirror-map entry's relevance is `every-pull-request`; `node scripts/harness/promote.mjs`'s
      printed hint contains `## Background`;
      `.agents/memory/pr-body-background-first-no-session-link.md` exists and points at § PR Unit Rule.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                                     | Notes                                     |
| ----- | ----------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| TC-01 | Integration | `rg` on the three rule texts; `node scripts/harness/scan-new-rule-declares-enforcement.mjs`         |                                           |
| TC-02 | Integration | vitest `check-pr-body.test.mjs` template-binding case; `test ! -e .github/pull_request_template.md` |                                           |
| TC-03 | Integration | vitest `no-session-link-commitlint.test.mjs` (spawns `npx commitlint`)                              | same shape as `reference-kind-commitlint` |
| TC-04 | Integration | vitest `check-pr-body.test.mjs` refuse/accept cases + workflow-pinning case                         |                                           |
| TC-05 | Mutation    | edit each floor, run its test, restore, record counts in the GATE-VERIFY entry                      | `git diff --stat` empty after restore     |
| TC-06 | Integration | `pnpm harness:scan`, exit code recorded; memory file read                                           |                                           |

## Tasks

- [ ] `.agents/tasks/RULE-016-pr-body-opens-with-background-and-carries-no-session-link.md` — 생성됨 (GATE-IMPLEMENT에서 바인딩)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → review-ready

- Ordering: entry gate, no prior gate required; `status: draft` and file under `.agents/spec-docs/draft/` match the expected input state. Worktree at `63ee7f22d` (= `origin/develop`); the only untracked paths are this spec and `.agents/tasks/RULE-016-…md` (a `status: todo` problem record bound to issue #2403, created 2026-08-27T16:23Z, no implementation path touched).
- Frontmatter: file begins with `---`; `status: draft`; `type: RULE` (in the 11-prefix list); `tags: [harness, cli]`.
- Problem / concrete symptom: verified. PR #2402 (created 2026-08-27T16:17:38Z = 2026-08-28 KST) original body per GraphQL `userContentEdits`: first substantive section `### Accepted recommendation` / `**REVIEW VERDICT:** …`, preceded by an H2 title, `Closes issue #2383`, and a records line (the doc's "began" is loose by three lines); ended with `🤖 Generated with [Claude Code]…` and `https://claude.ai/code/session_…`; owner edited it at 16:20:49Z to open with `## Background`. All 7 commits on PR #2402 and all 7 on PR #2396 carry `Claude-Session:` (`gh api pulls/<n>/commits`). § PR Unit Rule last bullet (`backlog-execution.md` lines 351–353) is a fields list with no order/background/purpose — exact text matches the doc. `commitlint.config.js` `reference-kind` rule (lines 95–125) and its test `scripts/harness/__tests__/reference-kind-commitlint.test.mjs` exist; `commitlint` is a required status check on `develop` (rulesets API). `.claude/hooks/merge-gate.sh` reads labels, `mergeStateStatus`, `baseRefOid/headRefOid`, `comments,reviews` via `gh pr view` and never `--json body` — confirmed. `scripts/harness/__tests__/merge-gate-decision.test.mjs` and `.claude/hooks/lib/command-scan.sh` exist.
- Problem / measurement discrepancy (recorded, not disqualifying): the quoted `git grep -n "claude.ai/code\|Claude-Session\|Generated with" -- .agents .claude/hooks commitlint.config.js scripts/harness` returns ONE hit on `63ee7f22d`, not "nothing": `.agents/tasks/completed/PROC-012-…md:100` (a completed task's note that some branches lack the trailer, landed in `ce5266b71` 2026-08-23). It is neither a rule nor a refusal, so the conclusion "nothing states the owner's override or would refuse them" stands; the stated output does not.
- Problem / reproduction condition: explicit **Reproduction condition** paragraph (any agent-opened PR/commit under harness defaults that append a session link, against a fields-only contract).
- Problem / no TBD, TODO, or vague single sentence: `grep -i "TBD\|TODO"` → no match; section is multi-paragraph with measurements.
- Prior Art Research: `## Prior Art Research` present with `Waived: <reason>` line (owner-preference content; reuses `reference-kind` and `merge-gate.sh` shapes; GitHub's why-before-what guidance adds nothing). `node scripts/harness/scan-spec-research.mjs` → "spec-research scan passed", exit 0. The waiver's named shapes are what A2 and the Decision build on — findings feed the decision.
- Architecture Review Checklist: all 4 items `[x]`. Sibling scan `[x]` with `N/A for new-surface placement` and evidence (siblings `reference-kind`, `promotion-closes`, existing `merge-gate.sh` refusals). Alternatives A1–A4, each with Pro and Con. Decision names the trade (body floor fires at merge; a wrong body costs one `gh pr edit`, deferred A3 until HARNESS-061 — which exists at `.agents/tasks/completed/HARNESS-061-…md`; issue #2250 is OPEN with the matching title). New-surface placement: N/A — Affected Scope introduces no package, app, or presentation/interface surface.
- Completion Criteria: TC-01…TC-05, every item prefixed; one per sub-item (rule text, commitlint rule, merge-gate refusal, mutation control, scans + memory mirror); all in command/observable form (`printf … | npx commitlint` exit codes, `pnpm harness:scan` exit 0, decision-test outcomes, byte-identical restore). `grep -i "works correctly\|no errors\|implemented\|displays correctly"` → no match.
- Test Plan: present; 5 rows for 5 TC-N (count matches: CC=5, TP=5); each row has Test Type and Tool/Approach; no "TBD"; no "manual" rows, so the Notes requirement is N/A.
- Structure: `## Tasks` present with the placeholder path line; `## Evidence Log` present and empty before this entry; no `## Status` or `## Classification` heading in the body (`grep "^## Status\|^## Classification"` → no match).

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → review-ready (re-run after re-plan; the 2026-08-28 PASS above already made the `draft → review-ready` transition, and this entry records no new one)

- Ordering: entry gate, no prior gate required. The document's recorded state (`status: review-ready`, `.agents/spec-docs/backlog/`) is the output of this gate's own earlier PASS entry and agrees with the spec-workflow folder table (`scan-doc-folder-status-agreement` → PASS, violations=0); no gate was skipped. Worktree at `63ee7f22d` (= `origin/develop`, branch `feat/rule-016-pr-body-background-first-no-session-link`); the only untracked paths are this spec and `.agents/tasks/RULE-016-…md` (`status: todo`, issue #2403); no implementation path exists — `.agents/memory/pr-body-background-first-no-session-link.md` and `scripts/harness/check-pr-body.mjs` are absent, `.github/pull_request_template.md` still present, `commitlint.config.js` carries only `reference-kind`.
- Frontmatter: file begins with `---`; `type: RULE` (11-prefix list); `tags: [harness]` present. `status: draft` is NOT present — `status: review-ready` is the state this gate's earlier PASS assigned, and the catalogue's own "(first GATE-WRITE run)" carve-out marks this gate as re-runnable; judged N/A on a re-run for the same reason, with the earlier transition standing. Recorded so the next gate sees the reasoning rather than a silent skip.
- Problem / concrete symptom — re-verified against live state: PR #2402 `createdAt` 2026-08-27T16:17:38Z; `userContentEdits` shows the owner's edit at 16:20:49Z (three minutes later, as stated). `cmp .github/PULL_REQUEST_TEMPLATE.md .github/pull_request_template.md` → byte-identical; added `9a1e547f6` 2026-05-10 and `efdc24997` 2026-07-23; heading order `## Summary → ## Related issue → ## Type of change → ## How was this tested? → ## Checklist` — exact. § PR Unit Rule last bullet (`backlog-execution.md:350-352`) text matches verbatim; `git log -S` places it in `5cf55a16a` 2026-05-09. `agent-conduct.md:65-67` reads "For reports, PR descriptions, commit bodies … write prose without bullets, numbered lists, or excessive bolding" — exact. `git grep -n "claude.ai/code\|Claude-Session\|Generated with" -- .agents .claude/hooks commitlint.config.js scripts/harness` → exactly one hit, `.agents/tasks/completed/PROC-012-…md:100` — matches. First `Claude-Session:` commit `cc15c870e` 2026-06-20; `git rev-list --count HEAD` = 4813 — both match. Merged PRs (`gh pr list --state merged --limit 200`): 91 of 200 carry the footer or URL — matches; of the last 80 only PR #2402 opens with `## Background` — matches; of the 59 before PR #2402: `## What` 14, `Closes #N` 17, `## Summary` 2, `## Accepted` 1, 22 distinct opening shapes, none opening with background — matches "at least eight … none". `review-gate.yml`: `on.pull_request.types` = `[opened, synchronize, reopened, edited, labeled, unlabeled]` (superset of the four named); the PROC-007 step "Has this change been withdrawn?" is the first step of job `review-gate` (line 133), before `actions/checkout@v4` (line 170), and its comment contains verbatim "a hook cannot see an auto-merge that GitHub fires on its own; only this job can" — matches; `review-gate` and `commitlint` are both required status checks on ruleset `protect-develop` (18715844). `merge-gate.sh` `gh pr view --json` reads `number`, `labels`, `mergeStateStatus`, `baseRefOid,headRefOid`, `comments,reviews` — never `body` — matches. `.husky/commit-msg` → `npx --no-install commitlint --edit`; `reference-kind` plugin rule at `commitlint.config.js:95-99`; `reference-kind-commitlint.test.mjs`, `merge-gate-disposition.test.mjs` (workflow cases assert `actions/checkout@v4` ordering at line 306), `command-scan.sh` `hook_verb_scan` (line 1241) all exist. HARNESS-061 `status: done`, `completed: 2026-07-30` — matches; issue #2250 OPEN "Editing a PR body cancels the in-flight review…" — matches; issue #2403 OPEN with the item's title; issue #2135 CLOSED (branch-deletion item, PROC-012's subject) — matches. BE-13 row exists at `harness-composition-inventory.md:554`.
- Problem / measurement discrepancies (recorded, not disqualifying — each conclusion stands, the stated figure does not): (1) "opened on 2026-08-28 (00:17 KST)" — 16:17:38Z is **01:17 KST**, one hour off. (2) "2630 of 4813 commits carry `Claude-Session:`" — 2630 is the count of trailer LINES in `git log --format=%B` (squash merges repeat every constituent commit's trailer); the count of COMMITS is **1105** (`git log --grep='Claude-Session:' | wc -l`). (3) `## User Execution Test Scenarios` says review-gate is wired by "`.claude/settings.json` and `protect-develop`" — `.claude/settings.json` contains no `review-gate`; the wiring is the workflow's `on: pull_request` trigger plus the ruleset's required check. Not a GATE-WRITE criterion section.
- Problem / reproduction condition: explicit **Reproduction condition** paragraph (agent harness defaults that append a session link, against a fields-only contract; human PRs from a template in a different order).
- Problem / no TBD, TODO, vague single sentence: `grep -i "TBD\|TODO"` over `## Problem` → no match; multi-paragraph, measured.
- Prior Art Research: `## Prior Art Research` present with `Waived: <reason>` (owner preference; reuses `reference-kind` plugin shape and the PROC-007 pre-checkout read whose comment states the layering). `node scripts/harness/scan-spec-research.mjs` → "spec-research scan passed", exit 0. The two named mechanisms are exactly what A5 and the Decision build on — findings feed the decision.
- Architecture Review Checklist: all 4 items `[x]`. Sibling scan `[x]` with `N/A for new-surface placement` and named siblings (`reference-kind`, PROC-007 step, `promotion-closes` — `scripts/harness/scan-promotion-closes.mjs` exists — `merge-gate.sh`). Alternatives A1–A5, each with a Pro and a Con line. Decision names the trade (two more documents change so the contract has one owner and the floor cannot contradict any of them) and rejects A1–A4 by their Cons. New-surface placement: N/A — a harness script, a workflow step and a commitlint rule are additions to existing harness surfaces; no package, app, presentation or interface surface, no layer reclassification.
- Completion Criteria: TC-01…TC-06, every item prefixed. Coverage against the Solution's eight items: 1–3 → TC-01, 4 → TC-02, 5 → TC-04, 6 → TC-03, 7 → TC-03/04/05, 8 → TC-06 — at least one per sub-item. Observation: Affected Scope/Files list `harness-composition-inventory.md` BE-13 wording, which no TC names and no scan reads (`grep -l harness-composition-inventory scripts/harness/*.mjs` → none); it mirrors the rule text TC-01 binds, so not judged a distinct sub-item, but GATE-COMPLETE will have no TC to verify it against. Forms: command (`printf … | npx commitlint` exit codes, `pnpm harness:scan` exit 0) or observable (first-heading judgement, file absence, test red under mutation, byte-identical restore). `grep -i "works correctly\|no errors\|implemented\|displays correctly"` over the body → no match.
- Test Plan: present; rows TC-01…TC-06 = 6, Completion Criteria TC-01…TC-06 = 6 — count matches. Each row has Test Type and Tool/Approach; no "TBD"; no "manual" rows, so the Notes requirement is N/A.
- Structure: `## Tasks` present with the placeholder path line. `## Evidence Log` present and non-empty — N/A by the catalogue's own "(first GATE-WRITE run)" wording; this is a re-run and the first entry is kept. No `## Status` / `## Classification` heading in the body (`grep "^## Status\|^## Classification"` → no match).

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → review-ready (third run, after `proposal-reviewer` round-2 REVISE; the first PASS above made the `draft → review-ready` transition and this entry records no new one)

- Ordering: entry gate, no prior gate required. `status: review-ready` under `.agents/spec-docs/backlog/` agrees with the folder table (`node scripts/harness/scan-doc-folder-status-agreement.mjs` → violations=0, PASS). Worktree on `feat/rule-016-pr-body-background-first-no-session-link` at `63ee7f22d` = `origin/develop`; `git status --porcelain` shows exactly two untracked paths — this spec and `.agents/tasks/RULE-016-…md`. No implementation path exists: `scripts/harness/check-pr-body.mjs`, `scripts/harness/__tests__/check-pr-body.test.mjs`, `scripts/harness/__tests__/no-session-link-commitlint.test.mjs`, `.agents/memory/pr-body-background-first-no-session-link.md` all absent; `.github/pull_request_template.md` still present; `commitlint.config.js` has no `no-session-link`.
- Frontmatter: file begins with `---`; `type: RULE` (11-prefix list); `tags: [harness]` present. `status: draft` NOT present — `status: review-ready` is what this gate's first PASS assigned; judged N/A on a re-run as in the second entry, reasoning carried rather than skipped.
- Problem / concrete symptom: the three corrections the second run recorded have landed — line 11 now reads "01:17 KST" (PR #2402 `createdAt` 2026-08-27T16:17:38Z re-read via `gh pr view`); line 42 now reads "1105 of 4813 commits carry `Claude-Session:` (2630 trailer lines — squash merges repeat them)" (`git log --grep='Claude-Session:' --format=%H | wc -l` → 1105; `git rev-list --count HEAD` → 4813, both re-measured); `## User Execution Test Scenarios` no longer names `.claude/settings.json` and now says "the `review-gate` workflow trigger and the `protect-develop` ruleset" (`grep -n settings.json` over the body → only the second Evidence Log entry). The `git grep` sentence now states its actual result ("finds one hit, a completed record's note (`PROC-012-….md:100`)"). Facts verified in the second entry (template order, § PR Unit Rule bullet and its `5cf55a16a` origin, `agent-conduct.md:65-67`, the 91/200 and 59-PR shape counts, PROC-007 step comment, `merge-gate.sh` never reading `body`) are unchanged in the text and were not re-measured.
- Problem / reproduction condition: explicit **Reproduction condition** paragraph (agent harness defaults appending a session link against a fields-only contract; human PRs from a template in a different order).
- Problem / no TBD, TODO, vague single sentence: `grep -i "TBD\|TODO"` over the body up to `## Evidence Log` → no match; multi-paragraph, measured.
- Prior Art Research: `## Prior Art Research` present with `Waived: <reason>` (owner preference; reuses `reference-kind`'s plugin shape and PROC-007's pre-checkout read). `node scripts/harness/scan-spec-research.mjs` → "spec-research scan passed", exit 0. The two named mechanisms are what A5 and the Decision build on — findings feed the decision.
- Architecture Review Checklist: all 4 items `[x]`. Sibling scan `[x]` with `N/A for new-surface placement` and four named siblings (`reference-kind`; PROC-007 step; `promotion-closes` — `scripts/harness/scan-promotion-closes.mjs` exists; `merge-gate.sh`). Alternatives A1–A5, each with a Pro and a Con line. A5's revised claims verified on `63ee7f22d`: `review-gate.yml:168-172` is the "Defense in depth" comment plus `actions/checkout@v4` with `ref: ${{ github.event.pull_request.base.sha }}`; the first step after it gated on `needs.classify.outputs.code == 'true'` is "Resolve the current PR merge commit" (line 175); the supersession logic at line 439 is `if [ "${CODE_CHANGED}" = "true" ] && … grep -q '^\*\*Review gate: BLOCKED'` — exactly the "only posts a PASS supersession when code changed, keyed on the BLOCKED header" the text describes; `on.pull_request.branches: [main, develop]` (line 40) and the auto-merge disarm comment at line 522 support the promotion-PR paragraph; `scripts/harness/promote.mjs:325` prints the `gh pr create --base main` hint; `scripts/harness/__tests__/review-gate-workflow-order.test.mjs` exists and asserts `github.event.pull_request.base.sha` (lines 43/55/68); `$GITHUB_STEP_SUMMARY` is already written by `review-gate.yml`; issue #2250 OPEN "Editing a PR body cancels the in-flight review…". Decision names the trade (two more documents change so the contract has one owner and the floor cannot contradict any of them) and rejects A1–A4 by their Cons; the new "Delivery — two sequenced PRs" paragraph gives the reason (judge loaded from base revision → PR 1 must land the script first) and assigns every artifact to PR 1 or PR 2. New-surface placement: N/A — a harness script, a workflow step and a commitlint rule added to existing harness surfaces; no package, app, presentation/interface surface, no layer reclassification.
- Completion Criteria: TC-01…TC-06, every item prefixed (6 `- [ ]` items, 6 with `**TC-`). Coverage against the eight Solution steps: 1–3 → TC-01, 4 → TC-02, 5 → TC-04 (judge + step placement/`env:`/no `if:`) and TC-06 (`required-status-checks.json`, `ci-mirror-map.mjs`), 6 → TC-03, 7 → TC-03/04/05, 8 → TC-06 — at least one per sub-item. Forms: command (`printf … | npx commitlint` exit codes, `pnpm harness:scan` exit 0, `test ! -e`) or observable (first-heading judgement naming the problem, step position pinned by test, test red under mutation, byte-identical restore). `grep -i "works correctly\|no errors\|implemented\|displays correctly"` over the body → no match. The four scans TC-06 names (`scan-workflow-permissions.mjs`, `scan-action-references.mjs`, `scan-memory-mirror.mjs`, `scan-new-rule-declares-enforcement.mjs`) exist; the wording constraints Solution step 1 attributes to the last one match its regex at line 85 (keyword before the first period within the bullet's first line) and its `DECLARED` pattern at line 49.
- Observations (recorded for the next gate, not GATE-WRITE criteria): (1) Affected Scope line 103 ("a pre-checkout step … pinned by a test in the shape of `merge-gate-disposition.test.mjs`'s workflow cases") and the Affected Files row for `review-gate.yml` ("pr-body step before checkout") were not revised with A5/Solution 5/TC-04, which place the step directly AFTER the `base.sha` checkout and pin it from `check-pr-body.test.mjs`; the binding text (TC-04) is the revised one. (2) `scripts/harness/promote.mjs` (one hint line) and `harness-composition-inventory.md` BE-13 appear in Affected Files but in no TC — `promote.mjs` also in no Solution step; both are wording mirrors of the contract TC-01/TC-04 bind, so not judged distinct sub-items, but GATE-COMPLETE will have no TC to verify either against. (3) `ci-mirror-map.mjs`'s `relevance: 'code'` field for `review-gate` is not named by Solution step 5 alongside `relevantWhen`; the body step makes the check relevant on every PR.
- Test Plan: present; rows TC-01…TC-06 = 6, Completion Criteria TC-01…TC-06 = 6 — count matches. Each row has a Test Type and a Tool/Approach; no "TBD"; no "manual" rows, so the Notes requirement is N/A.
- Structure: `## Tasks` present with the placeholder path line. `## Evidence Log` present and non-empty — N/A by the catalogue's "(first GATE-WRITE run)" wording; this is the third run and both earlier entries are kept. No `## Status` / `## Classification` heading in the body (`grep "^## Status\|^## Classification"` → no match).

### [GATE-APPROVAL] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 (권장)"
**Given:** 2026-08-28, this conversation

- Ordering: prior gate GATE-WRITE shows `✅ PASS` three times (entries dated 2026-08-28 at lines 349, 364, 379; the first made `draft → review-ready`, the two re-runs recorded no new transition). `status: review-ready` under `.agents/spec-docs/backlog/` is the state this gate takes as input (spec-workflow.md folder table line 168; `node scripts/harness/scan-doc-folder-status-agreement.mjs` → violations=0, PASS). Context, not a criterion: the third GATE-WRITE run counted eight Solution steps and recorded three observations (stale Affected Scope line, `promote.mjs` in no Solution step, `ci-mirror-map.mjs` relevance); the current text has nine Solution steps and addresses all three — the `proposal-reviewer` round-3 textual corrections landed after that run, and no GATE-WRITE re-run followed. The catalogue does not require one for this gate; recorded so the next gate reads the document, not the count.
- Route DIRECT / explicit approval in the current conversation: the dispatching orchestrator reports that on 2026-08-28, in this conversation, the owner was asked a structured question titled "RULE-016(#2403) spec을 승인할까요?" with options "승인 (권장)", "승인하되 PR 1개로", "보류", and selected "승인 (권장)". "승인" is on the catalogue's explicit list. In the same question set, asked whether one recommendation gate covers the two sequenced PRs § Delivery forces, the owner selected "확인 — spec 하나, 게이트 하나 (권장)". Provenance stated plainly: this guard did not observe the selection itself; it is the quote the `backlog-pipeline` dispatch carries into the subagent for this gate ("User must explicitly approve. Quote required."), from this document's own conversation — not from another session, agent run, or document.
- Route DIRECT / directed at this spec document: the question title names RULE-016 and issue #2403 (`gh issue view 2403` → OPEN, title "PR bodies open with gate vocabulary and carry the agent's session link; …" — the paired Task's `issue:`), and its summary of A5 matches § Decision point for point on the current text: one contract owned by § PR Unit Rule; template rewritten and duplicate deleted; conduct clause points at the owner; floor = a `review-gate` step directly after the `ref: base.sha` checkout judging the first heading `## Background`, the session URL, the Claude Code footer, and an empty body; commitlint `no-session-link`; the root item after the FOUNDATIONAL re-plan, not a containment. No other spec document was under discussion. Route CLASS unavailable and not claimed: the registry in backlog-execution.md § Delegated Approval Classes holds one placeholder row (`parseRegistry` → size 0).
- No Architecture Review or frontmatter type/tags modified after approval: the spec is untracked (no git history); its mtime is 2026-08-27T17:02:44Z and the paired Task's is 17:03:02Z — the Task's § Recommendation gate, written 18 s later, already records the round-3 corrections as "applied", so the spec's last write is those corrections, which precede the approval question the Task paragraph feeds; this gate runs at 17:13Z. Frontmatter reads `type: RULE`, `tags: [harness]` — identical to what the second and third GATE-WRITE entries recorded. The § Decision text the owner was shown is the § Decision text on disk (previous line).
- Independent architecture validation (conditional): N/A — the condition is not met. Affected Scope introduces no package, app, or presentation/interface surface and reclassifies no layer: three rule documents, a template rewrite plus a duplicate deletion, `scripts/harness/check-pr-body.mjs` beside 209 existing `scripts/harness/*.mjs` siblings (`scan-promotion-closes.mjs`, `promote.mjs` present), a step inside the existing `review-gate` job (10 named steps today), a rule added to the existing commitlint plugin entry (`commitlint.config.js:95` carries `reference-kind`), three tests, a memory record, an inventory row. Recorded for the record: the `proposal-reviewer` rounds (REVISE → re-plan → REVISE → REVISE, corrections applied; A5 uncontested in every round) reached the orchestrator's revision bound and were handed to the owner, whose selection above is the decision — no ENDORSE exists, and this conditional criterion is the only GATE-APPROVAL criterion that would require one.
- Evidence form: route, verbatim instruction, and date carried in the backlog-execution.md § Delegated Approval Classes DIRECT shape; parsed by `classifyApproval` from `scan-standing-delegation-evidence.mjs` on this entry → `{"route":"DIRECT"}`; `node scripts/harness/scan-standing-delegation-evidence.mjs` → "224 approved spec document(s); 6 DIRECT, 0 CLASS, 218 frozen …; 0 registered class(es)", exit 0, this document among the 6.
- NON-COMPLIANCE trigger (implementation before this gate): none. `git status --porcelain` → exactly the two untracked planning files; HEAD `63ee7f22d` = `origin/develop`; `scripts/harness/check-pr-body.mjs`, both new test files and `.agents/memory/pr-body-background-first-no-session-link.md` absent; `.github/pull_request_template.md` still present; `commitlint.config.js` has no `no-session-link`; `review-gate.yml` has no `check-pr-body` step.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-28

**Status upgrade:** approved → in-progress

- Paired spec document: `.agents/spec-docs/active/RULE-016-pr-body-opens-with-background-and-carries-no-session-link.md` (this file; `todo/` at judgement time, moved by the checkpoint). Paired Task: `.agents/tasks/RULE-016-pr-body-opens-with-background-and-carries-no-session-link.md`.

- Ordering: prior gate GATE-APPROVAL shows `✅ PASS | 2026-08-28` (entry at line 397, route DIRECT, "승인 (권장)"). Frontmatter `status: approved`; file under `.agents/spec-docs/todo/` — the folder spec-workflow.md line 169 maps to `approved`; `node scripts/harness/scan-doc-folder-status-agreement.mjs` → violations=0, PASS. Branch `feat/rule-016-pr-body-background-first-no-session-link`, HEAD `d03307003` (one commit, "docs(spec): RULE-016 reaches approved on the direct route", 2026-08-28T02:15:59+09:00) on `origin/develop` `63ee7f22d`.
- `.agents/tasks/<ID>.md` created: `.agents/tasks/RULE-016-pr-body-opens-with-background-and-carries-no-session-link.md` exists, committed in `d03307003` (`git diff --name-status origin/develop..HEAD` → `A` for the Task and `A` for this spec, nothing else); frontmatter `status: todo`, `issue: …/issues/2403`, sections `## Problem`, `## Evidence`, `## Depth verdict and re-plan`, `## Why it is worth fixing…`, `## Recommendation gate`, `## Test Plan`, `## User Execution Test Scenarios`, `## Bound spec document`.
- Tasks file path recorded in `## Tasks`: this document's `## Tasks` holds exactly one line naming `.agents/tasks/RULE-016-pr-body-opens-with-background-and-carries-no-session-link.md`; the Task's `## Bound spec document` names this spec's `todo/` path back — the pair is bound in both directions.
- Tasks correspond to the Completion Criteria (≥ 1 per TC-N): the Task's `## Test Plan` carries six bullets, mapped: "Rule texts" (§ PR Unit Rule sections + prohibition, git-branch.md commit half, agent-conduct.md clause, `new-rule-declares-enforcement`) → TC-01; "Template" (rewrite, duplicate deleted, first-heading test) → TC-02; "Judge + required check" (`check-pr-body.mjs` refuse/accept cases, `review-gate.yml` step after base-sha checkout, no `if:`, body via `env:`, pinned by test; two sequenced PRs) → TC-04; "Commitlint" (`no-session-link` beside `reference-kind`, wiring test refuse/accept) → TC-03; "Memory" (pointer record in `.agents/memory/`) → TC-06; "Applied-check mutation" (disabling each floor makes its test red) → TC-05. Six TCs, six tasks — one per TC-N. Observation (not disqualifying under "at minimum"): the TC-06 task names only the memory record; TC-06's `pnpm harness:scan` exit 0, `required-status-checks.json`/`ci-mirror-map.mjs` and `promote.mjs` hint halves are bound only by this spec's TC-06 and Test Plan row.
- `## Test Plan` ≥ 50 chars [AF-24]: the Task's `## Test Plan` section body is 1425 characters; `node scripts/harness/scan-test-plan.mjs` → "harness test-plan scan passed (42 document(s) checked …)", exit 0.
- Exact PLAN outcome, subject-bound: the committed Task (`git show HEAD:…RULE-016-….md` line 85) records `**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\``with the concrete reason ("changes a rule document, a commit-message lint rule, a required-check step and a memory record — repository governance and machinery; no product surface changes. The verification surface is the three fixture tests and the mutation"). Ledger`.agents/loop-runs/user-execution-scenario.jsonl` carries exactly one added record (`git diff --numstat origin/develop`→`1 0`): `runId r20260827163313`, opened 2026-08-27T16:33:13.943Z, closed 16:33:14.000Z, `roundFindings [0]`, `terminal "converged"`, `ref ".agents/tasks/RULE-016-pr-body-opens-with-background-and-carries-no-session-link.md"`— the exact Task path; it is the only RULE-016 record in the ledger and none exists on`origin/develop`. Not-applicable route → no DONE-GATE-STAGE-1 PASS is required (catalogue: "an applicable outcome includes … a DONE-GATE-STAGE-1 PASS"). `node scripts/harness/scan-user-execution-plan-order.mjs`→ "::examined:: 1 topic commit(s)", exit 0. Timing recorded plainly: the record's own`opened` (01:33 KST) precedes GATE-APPROVAL (17:13Z = 02:13 KST) and the checkpoint commit (02:15:59 KST); the ledger file's mtime is 02:16:10 KST, ten seconds after the commit — consistent with the uncommitted record being re-appended after a tree operation, and not with evidence added after implementation, of which none exists (next line).
- Whole worktree path inventory: `git status --short --untracked-files=all` →
  ```
   M .agents/loop-runs/user-execution-scenario.jsonl
  ```
  — one unstaged modification, the subject-bound PLAN ledger record; no staged, untracked, renamed or deleted path. `git diff origin/develop --stat` → `.agents/loop-runs/user-execution-scenario.jsonl | 1 +`, this spec `| 410 +`, the Task `| 93 +`, "3 files changed, 504 insertions(+)". The same diff restricted to paths outside `.agents/spec-docs`, `.agents/tasks`, `.agents/loop-runs` → empty.
- NON-COMPLIANCE trigger (implementation before this gate): none. `scripts/harness/check-pr-body.mjs`, `scripts/harness/__tests__/check-pr-body.test.mjs`, `scripts/harness/__tests__/no-session-link-commitlint.test.mjs`, `.agents/memory/pr-body-background-first-no-session-link.md` all absent; `.github/pull_request_template.md` still present; `grep -c no-session-link commitlint.config.js` → 0; `grep -c check-pr-body .github/workflows/review-gate.yml` → 0; `grep -c Background .github/PULL_REQUEST_TEMPLATE.md` → 0. § Delivery (two sequenced PRs under this one spec, owner-confirmed at GATE-APPROVAL) is context for Phase 3: this checkpoint precedes PR 1; the spec stays `in-progress` across both PRs and GATE-VERIFY runs on PR 2.
