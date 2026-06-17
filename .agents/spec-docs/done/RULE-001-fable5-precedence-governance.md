---
status: done
type: RULE
tags: [typescript]
---

# RULE-001: Adopt reference profile as the agent-conduct authority (unlimited precedence)

## Problem

The user has decided to adopt the **Claude reference profile system prompt**
(`.design/conduct-adoption/2026-06-18/_SOURCE-reference.md`) as the governing authority for agent
conduct in this repo. The explicit directive is **unlimited reference profile precedence: wherever any
reference profile principle conflicts with an existing harness rule, reference profile wins — across all areas.**

This supersedes the earlier conservative scoping (a prior version of RULE-001 proposed keeping
harness rules on conflict; that stance is withdrawn). This document is the **governance / meta
rule** that establishes the precedence and indexes the per-area adoption backlogs.

> Note for implementers: a recorded user decision overrides the agent's prior recommendation.
> The agent flagged risks (below) and the user chose unlimited precedence; honor it. Risks are
> documented per-area as Implementation Risks so adoption happens with eyes open, not silently.

## Precedence Rule (the addition)

Add to `AGENTS.md` (top-level authority section) and `.agents/rules/index.md`:

> **Agent-conduct authority.** For how the agent communicates, reasons, decides, and behaves,
> the Claude reference profile conduct principles (see `.agents/rules/agent-conduct.md`) are authoritative.
> Where a reference profile conduct principle conflicts with any other harness rule or skill, **reference profile
> takes precedence.** (Repo engineering invariants that reference profile does not address — build/test
> green, machine-parsed file structure — are not in conflict and remain in force; see each
> area's Implementation Risk.)

This sits in the existing precedence chain as: **user instructions > reference profile conduct > other
harness rules > default behavior.**

## Per-area adoption backlogs (this set)

| ID       | Area                                                     | Source report                                            |
| -------- | -------------------------------------------------------- | -------------------------------------------------------- |
| RULE-002 | Communication & formatting                               | `.design/conduct-adoption/2026-06-18/01-communication.md` |
| RULE-003 | Accountability, honesty, anti-sycophancy, evenhandedness | `02-conduct-honesty.md`                                  |
| RULE-004 | Epistemics & verification                                | `03-epistemics-verification.md`                          |
| RULE-005 | Safety posture (authority pointer)                       | `04-safety-wellbeing.md`                                 |
| RULE-006 | Operational / tool-use behavior                          | `05-operational-tooluse.md`                              |

## Architecture Review

### Affected Scope

- `AGENTS.md` — add the precedence rule + an "Agent Conduct" row to the Mandatory Rules table.
- `.agents/rules/index.md` — link the new rule group.
- `.agents/rules/agent-conduct.md` (new) — single owner doc consolidating RULE-002/003/004 (and
  the RULE-005 safety pointer). RULE-006 operational items may instead land in
  `.agents/rules/operational.md` (decide at GATE-APPROVAL — see RULE-006).

### Decision needed at GATE-APPROVAL

1. **Consolidation:** merge RULE-002/003/004(/005) into one `agent-conduct.md` (recommended) vs
   keep separate docs. The area agents independently recommended a single owner doc.
2. **RULE-006 placement:** `agent-conduct.md` vs `operational.md`.
3. **The one hard conflict (from RULE-002):** reference profile's "technical docs in prose, no
   bullets/numbered lists" vs the harness's machine-parsed structured artifacts (SPEC.md
   sections, backlog frontmatter, tables consumed by `harness:scan`). Unlimited precedence is
   recorded; the proposed resolution is scope-separation (prose for human-read conversational +
   narrative output; structure preserved for machine-parsed contracts). Confirm or override.

### Alternatives Considered

- **Import the whole reference profile doc verbatim** — rejected: ~46% is claude.ai tool schemas, ~40%
  product/runtime/base-model-safety; copying violates the domain-free / no-duplication principle
  and would not even be portable. Adopt principles, not mechanisms.
- **Scoped precedence (conduct layer only, harness wins on engineering)** — rejected by the user
  in favor of unlimited precedence; retained only as the natural carve-out for non-conflicting
  engineering invariants.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 (AGENTS.md + .agents/rules/)
- [x] Sibling scan 완료 — 5 area reports + existing rule docs gap-analyzed
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료 (user directive: unlimited precedence)

## Solution

1. At GATE-APPROVAL, decide consolidation + RULE-006 placement + the structured-artifact carve-out.
2. Create `.agents/rules/agent-conduct.md` consolidating the approved RULE-002..005 additions.
3. Add the precedence rule + Mandatory Rules row to `AGENTS.md`; link in `rules/index.md`.
4. Apply RULE-006 operational items to the chosen owner.
5. Run `pnpm harness:scan` (document-authority, consistency, doc-structure) — must pass.

## Affected Files

- `AGENTS.md`, `.agents/rules/index.md`, `.agents/rules/agent-conduct.md` (new),
  optionally `.agents/rules/operational.md` (RULE-006).

## Completion Criteria

- [ ] Precedence rule live in AGENTS.md; "Agent Conduct" in the Mandatory Rules table.
- [ ] RULE-002..006 additions consolidated into the agreed owner doc(s); principles only (no
      claude.ai mechanisms/schemas copied).
- [ ] Each area's Implementation Risk acknowledged in the final rule text.
- [ ] `pnpm harness:scan` passes.

## Test Plan

| TC-ID | Test Type | Tool / Approach                        | Notes                                                    |
| ----- | --------- | -------------------------------------- | -------------------------------------------------------- |
| TC-01 | automated | `pnpm harness:scan:document-authority` | one owner per fact; no duplication                       |
| TC-02 | automated | `pnpm harness:scan:consistency`        | AGENTS.md ↔ index ↔ rule doc consistent                  |
| TC-03 | automated | `pnpm harness:scan`                    | full gate green                                          |
| TC-04 | manual    | review                                 | principles imported, mechanisms excluded; risks recorded |

## Tasks

- [ ] `.agents/tasks/RULE-001.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- 2026-06-18 — User escalated to unlimited reference profile precedence across all areas. Prior conservative
  RULE-001 withdrawn; repurposed as governance/meta. 5-area parallel analysis produced
  RULE-002..006 drafts + reports under `.design/conduct-adoption/2026-06-18/`.

- 2026-06-18 — IMPLEMENTED: consolidated into `.agents/rules/agent-conduct.md` (communication, accountability/honesty, epistemics, safety pointer) + operational items in `.agents/rules/operational.md`; precedence statement + Mandatory Rules row added to AGENTS.md + rules/index.md. `pnpm harness:scan` = all 26 passed.
