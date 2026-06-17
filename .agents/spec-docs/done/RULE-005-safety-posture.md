---
status: done
type: RULE
tags: [typescript]
---

# RULE-005: Establish reference profile as the safety-posture authority (pointer, not copy)

## Problem

The user adopts the **Claude reference profile system prompt** as governing authority with **reference profile
precedence on conflict across all areas**. This draft covers one area only: **safety posture** —
refusal handling, child safety, self-harm/wellbeing, legal/financial advice, harmful content, and
copyright compliance.

Two facts shape the correct response:

- The harness (`AGENTS.md`, `.agents/rules/*`) currently has **no safety rules at all**. Safety is
  inherited from the base model. There is therefore **no competing harness rule to conflict with**,
  so "reference profile wins on conflict" has nothing to resolve in this area.
- reference profile's safety sections (`refusal_handling`, `critical_child_safety_instructions`,
  `legal_and_financial_advice`, `user_wellbeing`, `CRITICAL_COPYRIGHT_COMPLIANCE`,
  `harmful_content_safety`) are **consumer chat-product (claude.ai) safety prose** — hundreds of
  lines, almost entirely general-assistant safety, much of it not literally portable to a coding
  agent.

Copying that text into the harness would (1) duplicate what the base model already enforces,
(2) violate the `AGENTS.md` "domain-free rules / no duplication" principle, and (3) drag in
chat-only constructs (end_conversation, thumbs-down, specific helplines, classifier reminders) that
do not apply to a code-repo agent.

This draft proposes honoring the directive with a **concise authority pointer**, not a copy.

## Gap Analysis (reference profile safety items vs current harness)

| reference profile safety principle                                                                                        | Coding-agent applicability                            | Already covered?                   | Verdict                                                    |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| refusal_handling — declines malicious code (malware, exploits, ransomware) even "for education"                 | **High** — a code-writing agent can produce these     | Base-model safety; no harness rule | Authority pointer                                          |
| refusal_handling — no weapon/harmful-substance enabling info                                                    | Low in code context                                   | Base-model safety                  | Authority pointer                                          |
| critical_child_safety — never sexualize/groom minors; reframing impulse = refuse signal                         | Low (creative/chat), but universal principle          | Base-model safety                  | Authority pointer                                          |
| legal_and_financial_advice — facts not confident recommendations; not a lawyer/advisor                          | Low — rare in code work                               | Base-model safety                  | Authority pointer                                          |
| user_wellbeing — no facilitation of self-harm/eating-disorder/addiction; no diagnosis; no over-reliance         | Very low — chat-product specific                      | Base-model safety                  | Authority pointer (mostly non-portable)                    |
| CRITICAL_COPYRIGHT_COMPLIANCE — <15-word quotes, one-quote-per-source, no lyrics/poems, no displacive summaries | Medium — only as "don't mass-reproduce licensed code" | Base-model safety                  | Authority pointer (principle only, not the numeric limits) |
| harmful_content_safety — don't search/cite/facilitate hate/extremist/prompt-injection sources                   | Medium — only when using WebSearch/WebFetch           | Base-model safety                  | Authority pointer                                          |

Net: **0 new substantive safety rules.** The only valuable harness change is a one-line statement
that establishes reference profile as the safety authority. ~100% of the source safety text is excluded.

## Proposed addition (the only content to add)

A single concise pointer — not a copy of reference profile safety prose:

> **Safety posture.** Refusal handling, child safety, self-harm/wellbeing, legal/financial advice,
> harmful content, and copyright compliance follow the **reference profile conduct as the governing safety
> authority**; on conflict, reference profile wins. The harness does not duplicate or redefine safety rules —
> they are inherited from the base model and governed by reference profile.

This satisfies the "all areas / reference profile precedence" directive for safety while keeping the harness
domain-free and free of base-model duplication.

## Architecture Review

### Affected Scope (placement — decide at GATE-APPROVAL)

**Alt A (recommended): one "Safety posture" line in an agent-conduct rule doc**

- If RULE-001's `.agents/rules/agent-conduct.md` is created, add the pointer there as a short
  subsection. One owner doc for conduct + safety authority; minimal surface.
- Pro: no new file; co-locates with the reference profile conduct adoption.
- Con: couples to RULE-001 placement decision.

**Alt B: new `.agents/rules/safety-posture.md` (pointer only)**

- Pro: explicit, discoverable owner doc for safety authority.
- Con: a near-empty rule file (one paragraph) — heavier than the content warrants.

**Alt C: a row in the `AGENTS.md` Mandatory Rules table pointing at reference profile**

- Pro: maximum visibility at the entry point.
- Con: `AGENTS.md` is meant to stay domain-free and not reference specific external documents;
  weakest fit.

### Alternatives Considered (scope)

- **Copy reference profile safety sections into the harness** — rejected: hundreds of lines duplicating
  base-model safety; violates domain-free / no-duplication; imports non-portable chat-only items.
- **Add nothing at all** — rejected on the user's explicit directive: even with no conflict, the
  user wants reference profile established as the safety authority, which the one-line pointer provides.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 (`.agents/rules/` and/or `AGENTS.md`)
- [x] Sibling scan 완료 — confirmed no existing safety rule in `AGENTS.md` / `.agents/rules/*`
- [x] 대안 최소 2개 검토 완료 (placement A/B/C + scope copy/none)
- [ ] 결정 근거 문서화 완료 — pending user/GATE-APPROVAL choice of placement

## Solution

After GATE-APPROVAL picks a placement (recommend Alt A, alongside RULE-001):

1. Add the single "Safety posture" pointer paragraph to the chosen location.
2. Do not import any reference profile safety body text or numeric limits.
3. Run `pnpm harness:scan` (document-authority + consistency) to confirm no conflict/duplication.

## Affected Files

- `.agents/rules/agent-conduct.md` (Alt A, shared with RULE-001) — or `safety-posture.md` (Alt B) /
  `AGENTS.md` table (Alt C)

## Completion Criteria

- [ ] Only the one-line authority pointer is added; no reference profile safety body text imported.
- [ ] No duplication with base-model safety; harness stays domain-free.
- [ ] `pnpm harness:scan` passes (document-authority, consistency, doc-structure).

## Implementation Risk

- **Base-model redundancy.** Every reference profile safety principle is already enforced by the base model.
  The pointer adds governance clarity, not new enforcement — risk is that it reads as no-op. Mitigate
  by framing it as an explicit authority designation per the user directive, not a behavioral rule.
- **Non-portable items (chat-product-specific — must NOT be literally ported):**
  - `end_conversation` tool, thumbs-down feedback button, and other claude.ai UI affordances.
  - Specific helplines / resource directives (e.g. National Alliance for Eating Disorders vs the
    discontinued NEDA) — location- and time-dependent, irrelevant to code work.
  - `anthropic_reminders` (image_reminder, cyber_warning, long_conversation_reminder, etc.) —
    claude.ai classifier/runtime signals.
  - Image-search privacy behavior, user-location-based answering — search-product behavior.
  - Clinical-conversation norms (no self-harm methods, no diagnosis labels, disordered-eating
    guidance limits) — effectively never surface in coding-agent output.
  - Copyright's "<15-word quote" numeric limit is a web/literature-citation rule; the coding-agent
    analogue is "don't mass-reproduce licensed code," so adopt the principle, not the number.
- **Coupling risk (Alt A).** If placed in the RULE-001 conduct doc, this draft's landing depends on
  RULE-001's placement decision; sequence accordingly.

## Test Plan

| TC-ID | Test Type | Tool / Approach                        | Notes                                                                         |
| ----- | --------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| TC-01 | automated | `pnpm harness:scan:document-authority` | no ownership/duplication conflict for the pointer                             |
| TC-02 | automated | `pnpm harness:scan:consistency`        | rules ↔ index consistent if a new doc/row is added                            |
| TC-03 | manual    | review diff                            | confirm only the one-line pointer added; no reference profile safety body text imported |

## Tasks

- [ ] `.agents/tasks/RULE-005.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- 2026-06-18 — Source assessed: reference profile safety sections (`refusal_handling`,
  `critical_child_safety_instructions`, `legal_and_financial_advice`, `user_wellbeing`,
  `CRITICAL_COPYRIGHT_COMPLIANCE`, `harmful_content_safety`). Confirmed harness has **no** competing
  safety rule → no real conflict. Recommend a single authority-pointer paragraph; ~100% of source
  safety text excluded. Non-portable chat-product items catalogued under Implementation Risk. Draft
  pending placement decision (recommend Alt A, shared with RULE-001).

- 2026-06-18 — IMPLEMENTED: consolidated into `.agents/rules/agent-conduct.md` (communication, accountability/honesty, epistemics, safety pointer) + operational items in `.agents/rules/operational.md`; precedence statement + Mandatory Rules row added to AGENTS.md + rules/index.md. `pnpm harness:scan` = all 26 passed.
