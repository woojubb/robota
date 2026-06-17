---
status: done
type: RULE
tags: [typescript]
---

# RULE-004: Epistemic discipline & verification — verify changeable facts before asserting

## Problem

Distilled from the Claude Fable-5 system prompt
(`.design/fable5-adoption/2026-06-18/_SOURCE-fable5.md`: `### knowledge_cutoff` L156–165,
`### core_search_behaviors` / `### search_usage_guidelines` L436–491, `## citation_instructions`
L1533–1553), scoped to **epistemic discipline & verification** for a coding agent in this repo.

Fable-5's consumer-chat "search the web before asserting changeable facts" maps onto a coding agent
as: **verify current library/API/SDK/CLI behavior against docs or code rather than relying on
memorized (possibly outdated) knowledge before asserting or writing code; report verification
outcomes faithfully; cite a source of truth for substantive external claims.**

The harness already enforces the _self-change runtime evidence_ side strongly
(`verification.md` behavioral/headless gates, common-mistakes #35 "markup is not execution",
#57 "no success envelope over failure", #54 "existing patterns may be wrong") and the
_research-before-implementation_ side (`research.md`: docs as primary evidence, cite sources,
third-party source code is not evidence). What is **not** codified is the _pre-assertion epistemic_
layer: don't trust stale memory about external APIs, don't guess at unrecognized entities, use the
actual current date when querying, and don't make overconfident claims about findings or their
absence. RULE-001 lists this only as a "thin C" item — this draft is its dedicated owner.

## Gap Analysis (Fable-5 → coding agent vs current harness)

| Fable-5 principle (coding mapping)                                                                                                     | Already covered?                                                                                                                                             | Verdict                                   |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Verify current API/library/SDK/CLI behavior against docs/code before asserting or coding; don't rely on memorized (stale) knowledge    | `research.md` forces docs-first research **before implementation**; no rule for pre-assertion verification of external behavior. RULE-001(C) is "thin" only. | **NEW (A)**                               |
| Don't guess at unrecognized entities (package names, flags, symbols, error strings); identify them via repo grep/read or official docs | No rule. no-fallback is about runtime fallback, not "don't guess what you don't know".                                                                       | **NEW (B)**                               |
| Use the actual current date/version in external queries; stale years return stale results                                              | Absent from harness.                                                                                                                                         | **NEW (C)**                               |
| Report verification outcomes faithfully; no overconfident "works"/"passes"/"doesn't exist" without evidence; don't assert an absence   | `verification.md` + common-mistakes #35/#57 cover _runtime execution evidence_; overconfidence about _external facts / non-existence_ is uncovered.          | **NEW (D, partial)** / covered (runtime)  |
| Cite a source of truth for substantive external claims; note conflicting sources; prefer original docs over aggregators                | `research.md` covers this **for research deliverables**; everyday assertions (chat/PR/report) have no citation discipline.                                   | **NEW (E, partial)** / covered (research) |
| Scale effort to complexity                                                                                                             | `research.md` "proportional research" covers it.                                                                                                             | **COVERED**                               |

No direct conflicts with the harness — every harness verification rule reinforces this in the same
direction (Fable-5 wins on conflict if one arises; "mention cutoff only when relevant" per L460).

## Proposed additions (the only content to import)

**A. Verify-don't-assume on external behavior**

- Before asserting or coding against any library/API/SDK/CLI, verify its current behavior
  (signature, options, defaults, version-gated changes) against official docs or actual code.
- Do not rely on memorized, possibly-outdated knowledge for major-version, new, or unfamiliar APIs.
  Use context7 / official docs / repo grep before writing the call.

**B. No guessing at unrecognized entities**

- Unrecognized package names, flags, symbols, or error strings are identified via repo `grep`/read
  or official documentation before being used or explained — never confabulated.

**C. Current-date queries**

- When querying external docs/release notes/versions, use the actual current date and current
  version. Do not pin a past year or old version that yields stale results.

**D. Faithful verification reporting**

- Report outcomes as they are: do not claim "works", "passes", or "does not exist" without
  evidence. Do not assert an absence (e.g. "there is no such API") without checking.
- Present findings evenhandedly and state residual uncertainty. (Runtime-execution evidence remains
  governed by `verification.md` and common-mistakes #35/#57 — this item extends it to external facts.)

**E. Source-of-truth discipline for substantive claims**

- Substantive external claims (an API does X, Y is the default, behavior changed in version Z) carry
  a source: doc URL, file path, or code line. Note conflicting sources; prefer original docs over
  aggregators. Third-party source code points to a doc to read; it is not itself the evidence
  (consistent with `research.md`).

## Architecture Review

### Affected Scope (placement — decide at GATE-APPROVAL)

**Alt A (recommended): add an "Epistemic Discipline & Verification" section to the new
`.agents/rules/agent-conduct.md`** (the same file RULE-001 proposes)

- Pro: conduct-class constraints co-locate in one owner doc; RULE-001's thin C/D items delegate here
  (removes duplication); `verification.md` stays focused on self-change runtime evidence so the
  boundary is sharp. One row in the `AGENTS.md` Mandatory Rules table + `.agents/rules/index.md`.
- Con: a new rule group to maintain; must be coordinated with RULE-001 (shared file).

**Alt B: add a section under `.agents/rules/verification.md` (process group)**

- Pro: no new file; sits with existing verification gates.
- Con: `verification.md` is about verifying _your own changes' runtime behavior_; mixing in
  _external-fact epistemics_ blurs the boundary and risks looking like duplication of #35/#57.

### Alternatives Considered (scope)

- **Import the whole search_instructions block** — rejected: copyright/citation tag mechanics,
  web_search tool specifics, location, and copyright limits are claude.ai-runtime, not harness rules.
- **Import nothing** — rejected: A/B/C and the external-fact half of D/E are genuine gaps that
  directly affect code correctness (coding against a remembered, wrong API signature).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 (`.agents/rules/` + `AGENTS.md` + `rules/index.md`)
- [x] Sibling scan 완료 — gap-analyzed against `research.md`, `verification.md`, `operational.md`, `common-mistakes.md` (#35/#54/#57), and sibling draft RULE-001
- [x] 대안 최소 2개 검토 완료 (placement A/B + scope import-all/import-none)
- [ ] 결정 근거 문서화 완료 — pending GATE-APPROVAL: (1) placement A vs B, (2) RULE-001(C) delegation to this rule

## Solution

After GATE-APPROVAL picks placement (recommend Alt A) and confirms RULE-001(C/D) delegation:

1. Add sections A–E above to `.agents/rules/agent-conduct.md` (concise, domain-free, English).
2. Update RULE-001 so its "C. Epistemic discipline" / "D. Untrusted-content hygiene" reference this
   section instead of restating it (single owner, no duplication).
3. Add an "Agent Conduct" row to the `AGENTS.md` Mandatory Rules table and a link in
   `.agents/rules/index.md` (only if Alt A and not already added by RULE-001).
4. Run `pnpm harness:scan` (document-authority + consistency) to confirm no conflict/duplication.

## Affected Files

- `.agents/rules/agent-conduct.md` (new/extended) — or `verification.md` (Alt B)
- `.agents/spec-docs/draft/RULE-001-agent-communication-conduct.md` — delegate C/D here
- `AGENTS.md` (rules table) — Alt A only, if not already added by RULE-001
- `.agents/rules/index.md` — Alt A only, if not already added by RULE-001

## Completion Criteria

- [ ] Only items A–E are added; no claude.ai web_search/copyright/citation-tag runtime content imported.
- [ ] No duplication with `verification.md` (self-change runtime evidence) or `research.md` (research deliverables); boundary documented.
- [ ] RULE-001(C/D) delegates to this section — single owner.
- [ ] `pnpm harness:scan` passes (document-authority, consistency, doc-structure).

## Test Plan

| TC-ID | Test Type | Tool / Approach                        | Notes                                                              |
| ----- | --------- | -------------------------------------- | ------------------------------------------------------------------ |
| TC-01 | automated | `pnpm harness:scan:document-authority` | no ownership/duplication conflict for the new section              |
| TC-02 | automated | `pnpm harness:scan:consistency`        | rules table ↔ index ↔ doc consistent                               |
| TC-03 | manual    | review diff                            | confirm only A–E imported; boundary vs verification.md/research.md |

## Tasks

- [ ] `.agents/tasks/RULE-004.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- 2026-06-18 — Source assessed: Fable-5 `knowledge_cutoff` (L156–165), `core_search_behaviors` /
  `search_usage_guidelines` (L436–491), `citation_instructions` (L1533–1553). Mapped 8 principles
  (F1–F8) to coding-agent verification. Harness cross-checked: `research.md` covers
  research-deliverable docs+citation; `verification.md` + common-mistakes #35/#54/#57 cover
  self-change runtime evidence. Gaps A/B/C plus external-fact halves of D/E identified; F8 covered.
  No direct conflict. Overlap with sibling RULE-001(C/D) flagged — this rule is the dedicated owner;
  delegation proposed. Placement Alt A (`agent-conduct.md`) recommended; pending GATE-APPROVAL.

- 2026-06-18 — IMPLEMENTED: consolidated into `.agents/rules/agent-conduct.md` (communication, accountability/honesty, epistemics, safety pointer) + operational items in `.agents/rules/operational.md`; precedence statement + Mandatory Rules row added to AGENTS.md + rules/index.md. `pnpm harness:scan` = all 26 passed.
