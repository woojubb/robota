---
status: draft
type: INFRA
tags: [typescript]
---

# INFRA-006: agent-cli SPEC dependency chain correction

> Source: INFRA-002 audit finding **AF-03** (P0, CONTRADICTION). See
> `.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

## Problem

`packages/agent-cli/docs/SPEC.md` documents the dependency chain `agent-cli → agent-sdk → agent-sessions
→ agent-core` plus an Import Rules table listing `agent-sdk`, `agent-sessions`, `agent-provider-*`
(SPEC.md:296, §49-52). None of `agent-sdk`, `agent-sessions`, `agent-provider-*` exist as packages, and
the SPEC omits the three real dependencies. The actual `package.json` deps are:
`agent-command, agent-core, agent-framework, agent-provider, agent-subagent-runner, agent-transport`.
This is the single most misleading consumer-facing SPEC — it describes a dependency topology that does
not exist.

**Reproduction condition:** diff the SPEC's dependency section against
`node -p "Object.keys({...require('./packages/agent-cli/package.json').dependencies}).filter(k=>k.startsWith('@robota-sdk/'))"`.

## Architecture Review

### Affected Scope

- `packages/agent-cli/docs/SPEC.md` (doc correction only — no code change).

### Alternatives Considered

1. **Patch only the obviously-wrong names.** Pro: minimal. Con: leaves the chain structure wrong and the
   three real deps undocumented. Rejected.
2. **Rewrite the dependency section + Import Rules table to the real 6-edge graph** (from the INFRA-002
   ground-truth edge set), removing all phantom package names. Pro: makes the SPEC accurate. Con: none
   material. Chosen.

### Decision

Alternative 2 — rewrite to the real dependency graph. The proposed workspace-package-name guard
(INFRA-003 / AF-06) will prevent recurrence by failing on any non-existent `@robota-sdk/agent-*` token.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — single file: `packages/agent-cli/docs/SPEC.md`
- [x] Sibling scan 완료 — N/A: single-doc correction, not a command family
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records accuracy-to-ground-truth rationale

## Solution

Replace the SPEC's dependency chain and Import Rules table with the real 6 production dependencies and
remove `agent-sdk` / `agent-sessions` / `agent-provider-*` / `agent-runtime` references.

## Affected Files

- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: `rg -n '@robota-sdk/agent-(sdk|sessions|provider-|runtime)' packages/agent-cli/docs/SPEC.md`
      returns nothing.
- [ ] TC-02: The SPEC's dependency section lists exactly the 6 real deps
      (`agent-command, agent-core, agent-framework, agent-provider, agent-subagent-runner, agent-transport`).

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                      | Notes                            |
| ----- | ---------------------- | ---------------------------------------------------- | -------------------------------- |
| TC-01 | CI pipeline smoke test | `rg` grep assertion over `agent-cli/docs/SPEC.md`    | Command-form: zero phantom names |
| TC-02 | manual                 | Inspect dependency section against package.json deps | 6-edge match                     |

## Tasks

- [ ] `.agents/tasks/INFRA-006.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
