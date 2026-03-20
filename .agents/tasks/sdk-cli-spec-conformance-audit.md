---
title: SDK/CLI Spec Conformance Audit
status: backlog
priority: high
created: 2026-03-20
packages:
  - agent-sdk
  - agent-cli
  - agent-sessions
---

# SDK/CLI Spec Conformance Audit

## Goal

agent-cli, agent-sdk, agent-sessions are recently created and have gone through multiple refactoring rounds. Review their SPEC.md documents for internal contradictions, cross-package inconsistencies, and spec-code gaps. Improve specs first, then align code to match.

## Scope

| Package        | SPEC.md                                |
| -------------- | -------------------------------------- |
| agent-sessions | `packages/agent-sessions/docs/SPEC.md` |
| agent-sdk      | `packages/agent-sdk/docs/SPEC.md`      |
| agent-cli      | `packages/agent-cli/docs/SPEC.md`      |

## Phases

### Phase 1: Spec Review

- Read all 3 SPEC.md documents
- Identify internal contradictions within each spec (e.g., exported types table vs actual exports)
- Identify cross-package inconsistencies (e.g., agent-sdk spec claims Session owns something that agent-sessions spec says differently)
- Check if recent refactoring (generic Session, assembly architecture, PostCompact timing fix) is reflected in specs
- Produce a gap report

### Phase 2: Spec Improvement

- Fix contradictions and stale content
- Ensure specs accurately describe the current intended architecture (not just current code)
- Follow `spec-writing-standard` skill for required sections and quality gates
- Each spec change goes through `spec-code-conformance` verification

### Phase 3: Code Alignment

- Run conformance loop: compare spec assertions against code
- Fix code to match spec (spec is SSOT)
- Add/update contract tests for each fix
- Regression pass on all affected packages

## Success Criteria

- Zero contradictions within each SPEC.md
- Zero cross-package inconsistencies across the 3 specs
- All spec assertions verified against code (conformance loop passes)
- `pnpm build && pnpm test && pnpm typecheck` green
