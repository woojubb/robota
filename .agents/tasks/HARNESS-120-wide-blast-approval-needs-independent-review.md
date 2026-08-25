---
title: 'HARNESS-120: recommendation endorsement is required but unenforced'
issue: https://github.com/woojubb/robota/issues/2326
status: todo
created: 2026-08-25
priority: high
urgency: soon
area: .agents/rules, .claude/agents, scripts/harness
depends_on: []
---

# HARNESS-120: recommendation endorsement is required but unenforced

## Objective

Make the universal Recommendation Gate's independent `proposal-reviewer ENDORSE` executable. The owning
rule already requires that verdict for every recommendation, but GATE-APPROVAL checks independent evidence
only for new-surface placement and no scan reads the universal verdict. HARNESS-119 therefore changed the
universal post-merge verifier, recorded independent validation as N/A, and merged without the ENDORSE that
the Recommendation Gate already required.

The original issue described this as a wide-blast classification gap. Independent depth review found that
to be a symptom: a wide-blast-only condition would duplicate policy while leaving ordinary recommendations
able to bypass the same universal rule. This Task is re-scoped to enforce the existing universal contract;
new-surface placement remains an additive, stricter review concern.

## Plan

- [ ] Define one subject- and revision-bound Recommendation Gate evidence contract in the owning rule.
- [ ] Require GATE-APPROVAL to verify a current independent `ENDORSE` with zero unresolved findings for
      every recommendation, while retaining new-surface placement checks as additive evidence.
- [ ] Add a mechanical scan and deliberate-red fixtures for missing, wrong-subject, stale-revision,
      non-ENDORSE, and unresolved-finding records.
- [ ] Adopt the enforcement prospectively through an exact frozen baseline that never invents historical
      review evidence and re-governs nonterminal work at its next transition or material revision.
- [ ] Wire the reviewer, orchestrator, gate catalogue, scan registry, and orchestration map to the same
      evidence owner and prove the full harness remains green.

## Test Plan

- Add focused guardian/scan fixtures for a valid current endorsement and missing, wrong-subject,
  stale-revision, non-ENDORSE, unresolved-finding, and prospective-baseline cases.
- Run the focused contract tests, the complete harness contract tier, and `pnpm harness:scan`.

## Recommendation Gate

- **Depth review:** the original wide-blast-only framing was `FOUNDATIONAL` because the universal
  Recommendation Gate itself lacked enforcement. After re-scoping to that owner/enforcer mismatch, the
  independent triager returned `DEPTH: LOCAL` with `0 FOUNDATIONAL of 1` on 2026-08-26.
- **User standing authorization:** `의미있는 개선사항이 없을때까지 의미있는 개선사항을 처리해서 완료할때까지 반복해. 모든 계획은 타당한 이유가 있다면 사전 승인한다`
- **Independent proposal review:** pending against the committed draft revision.

## User Execution Test Scenarios

Not applicable. This changes internal approval governance and its mechanical tests, not a runnable
Robota CLI, TUI, browser, or public SDK surface.
