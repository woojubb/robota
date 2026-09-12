---
title: 'HARNESS-2710: streamline skill selection and contextual instruction routing'
status: done
created: 2026-09-12
completed: 2026-09-12
priority: high
urgency: now
area: repository harness guidance and skills
depends_on: []
issue: https://github.com/woojubb/robota/issues/2710
documentation_batch_approval: DIRECT
documentation_batch_instruction: '다음 기사 내용을 참고해서 skill이나 AGENTS.md를 검토 및 개선해주세요'
---

# HARNESS-2710: streamline skill selection and contextual instruction routing

## Objective

Reduce instruction-selection noise using the official OpenAI Astra guidance while preserving explicit
repository safety, permission, release, and merge constraints.

## Decision

- Make `AGENTS.md` a contextual routing surface rather than a read-everything preflight.
- Make each skill description state its capability and activation boundary without an internal itinerary.
- Extend `harness-governance` with progressive-disclosure and sibling-distinguishability checks.
- Preserve detailed release, merge, authorization, and other fragile protocols in their owning skill bodies.
- Do not introduce an arbitrary description-length gate as a proxy for routing quality.

## Plan

- [x] Review the official Astra skills and prompts guidance against the repository harness.
- [x] Rewrite the repository skill selection descriptions.
- [x] Update `AGENTS.md` and `harness-governance` with contextual routing rules.
- [x] Verify formatting, registration, consistency, routing-document size, and diff hygiene.
- [x] Re-read the final integration-tree instructions against the article-derived decision.
- [x] Replace misleading pre-router AGENTS anchors with direct owner-document routes.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This documentation-only harness routing change exposes no runnable product behavior or user
interface that an end user can execute as a scenario.

## Test Plan

- `pnpm exec prettier --check AGENTS.md .agents/skills/*/SKILL.md .agents/skills/index.md`
- `node scripts/harness/scan-skill-registration.mjs`
- `pnpm harness:scan:consistency`
- `node scripts/harness/scan-routing-document-size.mjs`
- `git diff --check`

## Verification Evidence

- Skill description characters: 19,756 before, 5,967 after (69.8% reduction).
- Median description: 287.5 characters before, 99.5 after; maximum: 840 before, 126 after.
- Formatting, skill registration, consistency, routing-document size, and diff checks passed.
- The full harness scan passed all change-related checks; three unrelated existing-state findings remain.
- PR #2712 landed as `a822e50a0543731cd09240ed5ef81df7dc0abdb5` on `develop`; its final-head CI passed.
- The integration-tree follow-up compared the guidance with the
  [official OpenAI article](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra),
  routed stale skill anchors to their actual owner documents, and reduced `branch-guard` to an
  operation-specific router into the large branch-policy document.

## Completion Criteria

- [x] Task-relevant owner documents replace broad mandatory preloading in `AGENTS.md`.
- [x] All repository skill descriptions are concise and distinguishable at selection time.
- [x] Safety-sensitive procedural detail remains in the owning skill bodies.
- [x] Applicable local checks pass and unrelated residual failures are recorded.
- [x] Remote PR evidence is recorded after the branch is published.
