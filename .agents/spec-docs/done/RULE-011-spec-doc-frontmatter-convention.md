---
status: done
type: RULE
tags: [infra]
---

# RULE-011: Spec-doc frontmatter & ID convention + gate

## Problem

The artifact taxonomy (`RULE-007`) marks **Backlog spec-doc** as `partial`, citing an "ID↔type
inconsistency". Investigation of all ~140 existing spec-docs shows the real situation is the opposite of
what `.agents/spec-docs/README.md` documents:

- **README claims** "The prefix comes from the `type` frontmatter field" (filename prefix == one of the
  11 type values).
- **Practice (140+ specs)** uses the filename prefix as an **initiative / domain namespace**
  (`CLI`, `PM`, `PRESET`, `HARNESS`, `SITE`, `DOCAUDIT`, `WORKFLOW`, …) and the `type` frontmatter as an
  **orthogonal SDLC classification** ∈ 11. Examples: `CLI-035` type `SECURITY`, `CLI-042` type `PERF`,
  `PM-025` type `DATA`, `WORKFLOW-001` type `INFRA`. The two axes are deliberately independent.

So the documented rule is wrong (it contradicts the overwhelming, sensible practice), and the real
convention is **ungated**: nothing validates that `type` is one of the 11, that `status` is legal, or
that `tags` is present. (`RULE-007`'s index inherited the README's false framing by calling
`INFRA-DOC-GUARD-001` a defect — under the real convention `INFRA-DOC-GUARD` is just its namespace and
`type: BEHAVIOR` is its SDLC class; not a defect.)

Per `learning-loop.md` "Contract Before Automation", the Backlog spec-doc type's contract is otherwise
complete — only an honest convention statement + a frontmatter gate are missing. This spec adds both,
correcting the README and the `RULE-007` note, and flips the row to `defined`.

Reproduction: `rg "prefix comes from the .type." .agents/spec-docs/README.md` returns the false rule;
no scan rejects a spec-doc with `type: NONSENSE` or a missing `tags`.

## Architecture Review

### Affected Scope

- **Corrected:** `.agents/spec-docs/README.md` — replace the false "prefix == type" rule with the real
  convention (namespace ID + orthogonal `type` ∈ 11). `.agents/specs/document-standards/index.md` —
  correct the Backlog spec-doc + naming-follow-on notes; flip the row to `defined`.
- **New (gate):** `scripts/harness/check-spec-doc-frontmatter.mjs` — over `.agents/spec-docs/**/*.md`
  (excluding `README.md`), assert frontmatter `status` ∈ legal set, `type` ∈ 11, `tags` present
  (blocking); warn on duplicate `<namespace>-<NNN>` IDs. Registered in `run-all-scans.mjs` + `package.json`.
- **Reuses:** `backlog-writer` owns the spec schema (linked, not duplicated); this gate enforces only
  the frontmatter-validity slice the gate pipeline does not already check at GATE-WRITE.

### The contract — meta-form elements for the Backlog spec-doc type (delta from RULE-007)

The Backlog spec-doc type already has location (`.agents/spec-docs/**`), template (`spec-template.md`),
skill (`backlog-writer`), and lifecycle (the gate pipeline). This spec fixes two meta-form elements:

- **Identity & Altitude (clarified):** a work item. Its filename ID is an **initiative/domain
  namespace** + number + slug; its `type` frontmatter is an **orthogonal SDLC classification** ∈ 11
  (`SCREEN`/`API`/`FLOW`/`BEHAVIOR`/`DATA`/`RULE`/`AGREEMENT`/`INFRA`/`PERF`/`SECURITY`/`OBSERVABILITY`).
  The two are independent — the namespace says _which initiative_, the type says _which SDLC category_.
- **Completeness Criteria (gated):** frontmatter has `status` ∈ {draft, review-ready, approved,
  in-progress, verifying, done, rejected}, `type` ∈ 11, `tags` present. IDs SHOULD be unique
  (`<namespace>-<NNN>`) — duplicates are a warning (historical dupes: `HARNESS-011`, `OBS-001`).

### Alternatives Considered

1. **Enforce the README's literal rule (filename prefix == type).** Pro: matches the current README.
   Con: would reject 100+ valid specs (`CLI-035`/`SECURITY`, `WORKFLOW-001`/`INFRA`, …) and force mass
   renames of good, established IDs — the README rule is the artifact that is wrong, not the specs.
   Rejected.
2. **Correct the README to the real convention + gate frontmatter validity (chosen).** Pro: documents
   reality, adds the missing mechanical check, no churn. Con: revises a documented rule (correct per
   `feedback_legacy_disposable_no_shortcuts` — fix the wrong doc, do not preserve it). Accepted.

### Decision

Alternative 2. Correct `spec-docs/README.md` and the `RULE-007` index note to the real
namespace-ID + orthogonal-`type` convention, add `check-spec-doc-frontmatter.mjs` (validity blocking,
duplicate-ID warning), and flip the Backlog spec-doc taxonomy row to `defined`. No spec is renamed; the
earlier "`INFRA-DOC-GUARD-001` defect" framing is retracted as based on the false README rule.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — spec-docs/README.md, document-standards/index.md, new gate, package.json, run-all-scans.mjs.
- [x] Sibling scan 완료 — surveyed all ~140 spec-docs: every one has status/type/tags and a valid `type` ∈ 11 (0 frontmatter issues); namespace prefixes are orthogonal to `type`; duplicate IDs `HARNESS-011`/`OBS-001` found (warned, not blocked).
- [x] 대안 최소 2개 검토 완료 — 2개 (enforce-literal-README / correct-README+gate).
- [x] 결정 근거 문서화 완료 — README is the wrong artifact; gate validity not identity; retract the false defect framing.

## Solution

- Rewrite the `spec-docs/README.md` "File Naming" + "Type Prefix" wording to the real convention
  (namespace ID; `type` is the orthogonal SDLC class ∈ 11).
- Build `check-spec-doc-frontmatter.mjs` (validity blocking; duplicate-ID warning). Self-test fixture
  (bad `type` / missing `tags` → exit 1). Register in `run-all-scans.mjs` + `package.json`.
- Correct the `document-standards/index.md` Backlog spec-doc note + naming follow-on; flip row to `defined`.

## Affected Files

- New: `scripts/harness/check-spec-doc-frontmatter.mjs` (+ fixture).
- Edited: `.agents/spec-docs/README.md`, `.agents/specs/document-standards/index.md`, `package.json`,
  `scripts/harness/run-all-scans.mjs`.

## Completion Criteria

- [x] TC-01: `.agents/spec-docs/README.md` states the real convention (namespace ID + orthogonal `type` ∈ 11) and no longer claims "prefix comes from the type" — `rg` confirmed new wording present, old wording absent.
- [x] TC-02: `check-spec-doc-frontmatter.mjs` exits 1 on the `spec-doc-bad-frontmatter.md` fixture (`type: NONSENSE` + missing `tags`); exits 0 over `.agents/spec-docs/**`. The gate caught a real latent defect — `INFRA-DOC-GUARD-001` had illegal `status: backlog`; corrected to `review-ready` (C4). Verified 2026-06-30.
- [x] TC-03: the gate warns (non-blocking) on duplicate IDs — `HARNESS-011` / `OBS-001` reported as warnings; exit stays 0 on the real tree.
- [x] TC-04: the `document-standards/index.md` Backlog spec-doc row reads `defined`, the false "INFRA-DOC-GUARD-001 defect" note is retracted/corrected, and `check-document-standards-index.mjs` exits 0. All 5 taxonomy rows are now `defined`.
- [x] TC-05: `pnpm harness:scan` exits 0. **verified 2026-06-30** — WORKFLOW-001 complete; `pnpm harness:scan` exits 0 (38/38 scans green) with the document-standards scans registered.

## Test Plan

Strategy (RULE + infra): mechanical presence/absence + scan exit-code checks. No manual rows.

| TC-ID | Test Type | Tool / Approach                                                                    | Notes               |
| ----- | --------- | ---------------------------------------------------------------------------------- | ------------------- |
| TC-01 | RULE      | `rg` new convention wording present / old absent in README                         | doc corrected       |
| TC-02 | INFRA     | `check-spec-doc-frontmatter.mjs` exit 1 (fixture) / 0 (real)                       | validity gate works |
| TC-03 | INFRA     | duplicate-ID warning, exit 0 on real tree                                          | warn not block      |
| TC-04 | INFRA     | index row `defined` + corrected note + `check-document-standards-index.mjs` exit 0 | taxonomy flipped    |
| TC-05 | INFRA     | `pnpm harness:scan` exit 0                                                         | scan registered     |

## Tasks

- [x] `.agents/tasks/RULE-011.md` — 작성 완료.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-30

draft → review-ready. Frontmatter (RULE/[infra]); Problem (README false rule vs 140-spec practice,
reproduction); Architecture Review (Affected Scope, contract delta, 4/4 checklist, full-survey Sibling
scan, 2 Alternatives Pro/Con, Decision); 5 TC = 5 Test Plan rows; Tasks placeholder; empty Evidence Log;
no forbidden sections. Mechanical: `rg` confirmed 8/8 headings, 4/4 checklist, TC 5=5.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-30

review-ready → approved. Standing decision-delegation (`feedback_autonomous_completion`); internal
harness governance. Decision recorded: README is the wrong artifact (correct it per
`feedback_legacy_disposable_no_shortcuts`), gate validity not identity, retract the false
INFRA-DOC-GUARD-001 defect framing, duplicate-ID = warning. No drift.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-30

approved → in-progress. `.agents/tasks/RULE-011.md` created; spec `## Tasks` updated; spec pointer in
tasks file; tasks cover TC-01..TC-05; Test Plan in tasks file.
