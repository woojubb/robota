---
status: done
type: INFRA
tags: [harness, scan, capability, agent-run, reachability, done-gate, floor]
completed: 2026-07-20
---

# HARNESS-030: mechanical floor for the capability-reachability / agent-run done-gate

## Problem

[backlog-execution.md](../rules/backlog-execution.md) → "Capability Reachability — no library-seam N/A dodge"
forbids marking the user-execution gate "N/A" for a user-facing capability that ships as a library seam no
surface enables, and requires an AGENT-RUN e2e verification. Today this is **prose + GATE-COMPLETE reviewer
judgment only** — no mechanical check — so the exact defect (SELFHOST-008 P2/P3/P4 shipping OFF in the real
agent, unverified) could recur silently.

## Prior Art Research

Waived: internal-consistency mechanical floor over the repo's OWN capability/agent-run convention — no external
product prior-art applies (this fences a Robota-specific done-gate rule, not a user-facing behavior). The design
mirrors the sibling mechanical floors already in the repo — `scan-*-neutrality.mjs`, `scan-no-fallback.mjs`,
`scan-hook-catalog.mjs` (opt-in/declared-then-enforced, pure `findX` + live walk + red/green fixtures) — which
are the established precedent for a harness floor here.

## Why not fully mechanized (the semantic core stays with the reviewer)

"Is this spec a user-facing capability?" and "does some surface actually enable the seam?" are SEMANTIC
judgments a scan cannot make reliably (intent + cross-package call-graph reasoning). A naive keyword scan is
high-FP/FN. So the reviewer (GATE-COMPLETE guardian) still owns "is this a capability" and "is it truly
reachable." This floor makes the OTHER half mechanical: once a spec DECLARES itself a capability, it MUST carry
an agent-run verification — no silent N/A.

## Architecture Review

### Decision (opt-in declaration → mechanical enforcement)

Add three OPTIONAL frontmatter keys (registered in RULE-011 `check-spec-doc-frontmatter.mjs` +
backlog-execution.md):

- `capability: true` — the author declares this spec ships a user-facing capability (the semantic call the
  reviewer confirms at GATE-COMPLETE).
- `user_execution: agent-run | manual | none` — how the user-execution gate was met.
- `user_execution_scenario: <path>` — the agent-run evidence file, **an EXPLICIT reference** (a spec's evidence
  may live under a differently-named scenario — e.g. SEC-001's agent-run evidence is the GUI-007 scenario).

`scan-capability-reachability.mjs` (registered in `run-all-scans.mjs`) then enforces, over
`.agents/spec-docs/done/`:

1. A spec with `capability: true` MUST NOT record `user_execution: none`/`N/A` (or omit it) — a shipped
   user-facing capability cannot dodge the user-execution gate.
2. A `capability: true` spec with `user_execution: agent-run` MUST name a `user_execution_scenario:` path that
   EXISTS. FAIL if the key is absent or the file is missing.

**Honest scope:** this mechanizes the DECLARED half only. The scan never GUESSES which spec is a capability
(the FP hazard the backlog flags) — "is this a user-facing capability?" and "is the seam truly reachable?"
stay with the GATE-COMPLETE reviewer. So an _undeclared_ dodge (a capability shipped with no flag) is NOT
caught here; the floor fences only the _declared-then-dodge_ case. A **warn-only capability-candidate
surfacer** (heuristic over type/tags, nudging the reviewer to set `capability: true`) is the FP-safe way to
also pressure the undeclared gap — DEFERRED as a follow-up (avoids landing a noisy heuristic in v1).

### Alternatives Considered

- **Auto-detect capabilities by keyword/type (hard-fail)** — REJECTED: high FP/FN (the backlog's stated
  reason); the "is this a capability" call stays with the reviewer.
- **Filename-substring scenario matcher** (name contains the spec base ID) — REJECTED: the SEC-001 case proves
  it wrong (its reviewed agent-run scenario is a differently-named file). Replaced by the EXPLICIT
  `user_execution_scenario:` reference, which also removes case-sensitivity + shared-base-ID coarseness.

## Solution

- `scripts/harness/scan-capability-reachability.mjs`: pure `evaluateSpec(frontmatter, filename, scenarioExists)`
  - live `findCapabilityReachabilityFindings()` walking `done/`; mirrors the sibling scan conventions.
- Backfill the recently-DONE capabilities that have agent-run scenarios — **SELFHOST-008/009/011/012/013/014,
  GUI-007, and SEC-001 (→ the GUI-007 scenario, an explicit cross-reference)** — each with `capability: true` +
  `user_execution: agent-run` + `user_execution_scenario: <path>`. (CLI-076 is NOT backfilled — it has no
  `spec-docs/done/` spec-doc, only a legacy `backlog/completed/` item; out of scan scope.)
- Document the keys in RULE-011 (`check-spec-doc-frontmatter.mjs`) + backlog-execution.md.

## Affected Files

- `scripts/harness/scan-capability-reachability.mjs` (+ test), `scripts/harness/run-all-scans.mjs`
- The backfilled `done/` spec-docs (frontmatter only)
- `.agents/rules/backlog-execution.md` + the spec-writing-standard skill (document the keys)

## Completion Criteria

- TC-01 — a `done/` spec with `capability: true` + `user_execution: none` FAILs; `agent-run` + a matching
  scenario PASSes (unit).
- TC-02 — a `capability: true` + `user_execution: agent-run` spec that names NO `user_execution_scenario` FAILs.
- TC-02b — a `capability: true` + `user_execution: agent-run` spec naming a MISSING/misnamed scenario file FAILs
  (the SEC-001-shaped case); a CROSS-REFERENCED existing file (SEC-001 → GUI-007 scenario) PASSes (unit).
- TC-03 — a spec WITHOUT `capability: true` is not checked (opt-in; no false positive) (unit).
- TC-04 — the live `done/` tree is GREEN after backfilling the capability specs.
- TC-05 — registered in `run-all-scans.mjs`; the keys documented in RULE-011 + backlog-execution.md.

## Test Plan

Red/green fixtures for the pure predicate (declared-but-none, declared-agent-run-with/without-scenario,
undeclared) + a live-tree green assertion.

## Tasks

- [x] scan + test + run-all-scans registration DONE
- [x] backfill (8 specs incl SEC-001 cross-ref) + RULE-011/backlog-execution docs DONE

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-20

- Prior Art Research: Waived (internal-consistency floor; sibling-floor precedent) → scan-spec-research green.
- Frontmatter (status/type INFRA/tags): green.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-20

Independent `proposal-reviewer`: **REVISE → resolved**. Reviewer ENDORSED the opt-in `capability` design + the
`done/`-only scope (verified: unknown frontmatter keys are inert to RULE-011; the SELFHOST-008 defect was in
`done/`). REVISE for 5 items, ALL applied:

1. **Backfill corrected** — dropped CLI-076 (no `spec-docs/done/` entry); SEC-001 kept (its evidence is the
   GUI-007 scenario) — enabled by #2.
2. **Explicit-scenario matcher** — replaced the fragile filename-substring guess with an explicit
   `user_execution_scenario: <path>` reference the scan verifies exists. Resolves the SEC-001→GUI-007
   cross-reference + removes case-sensitivity/shared-base-ID fragility.
3. **Honest scope** — Decision now states the floor mechanizes the DECLARED half only; undeclared-capability
   recognition stays reviewer-owned; a warn-only candidate surfacer is a deferred follow-up.
4. **RULE-011 registration** — the three keys documented in `check-spec-doc-frontmatter.mjs` (frontmatter SSOT).
5. **TC-02b added** — missing/misnamed named scenario FAILs; cross-referenced existing file PASSes.

Owner directive ("모두 끝까지") = standing GATE-APPROVAL sign-off. 8/8 unit tests, live scan + 63/63 scans green.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-20

`scan-capability-reachability.mjs` (pure `evaluateSpec` + live `findCapabilityReachabilityFindings`) registered
in `run-all-scans.mjs`; 8 backfilled `done/` specs carry the three keys; RULE-011 + backlog-execution docs
updated. Shipped in PR #1255 (squash `3a0188a02`).

### [GATE-VERIFY] — ✅ PASS | 2026-07-20

- Required CI on #1255 all green (build / examples-typecheck / scans / tui-e2e / windows-shell / commitlint).
- 9/9 unit tests (TC-01/02/02b/03/04 + parseFrontmatter incl. quote-strip); live scan exit 0; 63/63 run-all-scans.
- Independent `pr-review-reviewer` on the applied diff: 1 SHOULD (rule-doc still described the pre-REVISE
  two-key/name-match design) + 1 CONSIDER (quote-strip) — BOTH applied in follow-up commit `89c51bf59`; verified
  green. All 7 `user_execution_scenario` paths confirmed real files (genuine live-green, not accidental).

### [GATE-COMPLETE] — ✅ PASS | 2026-07-20

Merged to develop (#1255, `3a0188a02`) + review-fix (`89c51bf59`). Spec → `done/`, `status: done`. The
"declared-then-dodge" recurrence (SELFHOST-008 shape) is now mechanically fenced; undeclared-capability
recognition remains reviewer-owned (a warn-only surfacer is the deferred follow-up).
