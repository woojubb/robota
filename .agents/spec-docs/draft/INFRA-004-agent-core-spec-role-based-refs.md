---
status: draft
type: INFRA
tags: [typescript]
---

# INFRA-004: agent-core SPEC role-based consumer references

> Source: INFRA-002 audit finding **AF-01** (P0, VIOLATION). See
> `.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

## Problem

`packages/agent-core/docs/SPEC.md` is the SSOT contract for the zero-dependency foundation package, yet
it names specific consumer packages — `agent-session`, `agent-tools`, `agent-team`, `agent-plugin-*` —
in its "Consumed By" section (§842-845) and Layer diagram (§49-53). This violates the SSOT-no-external-refs
rule: foundation packages must describe consumers by role, never by name (a foundation package must not
encode knowledge of who depends on it). It also propagates the phantom `agent-team` and `agent-plugin-*`
names (which do not exist as packages — see AF-04/AF-06).

**Reproduction condition:** `rg '@robota-sdk/agent-(session|tools|team|plugin)' packages/agent-core/docs/SPEC.md`
returns consumer-name references inside the zero-dep foundation SPEC.

## Architecture Review

### Affected Scope

- `packages/agent-core/docs/SPEC.md` (doc correction only — no code change).

### Alternatives Considered

1. **Leave as-is / minor wording tweak.** Pro: least effort. Con: keeps the rule violation and phantom
   names; foundation SPEC keeps encoding consumer identities. Rejected.
2. **Rewrite consumer references in role-based language** ("session-layer consumers", "tool-layer
   consumers", "plugin extensions"), removing all specific `@robota-sdk/agent-*` consumer names. Pro:
   resolves the rule violation and the phantom names in one pass. Con: requires careful rewrite of the
   Layer diagram. Chosen.

### Decision

Alternative 2 — rewrite to role-based descriptions. This is also the canonical fix the proposed
workspace-package-name guard (INFRA-003 / AF-06) will enforce going forward.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — single file: `packages/agent-core/docs/SPEC.md`
- [x] Sibling scan 완료 — N/A: single-doc correction, not a command family
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records the SSOT-no-external-refs rationale

## Solution

Replace every specific consumer-package name in `agent-core/docs/SPEC.md` "Consumed By" and Layer
diagram with role-based descriptions; remove the phantom `agent-team` / `agent-plugin-*` names.

## Affected Files

- `packages/agent-core/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: `rg -n '@robota-sdk/agent-' packages/agent-core/docs/SPEC.md` returns no consumer-package
      reference (only self-references to `@robota-sdk/agent-core`, if any, remain).
- [ ] TC-02: The "Consumed By" section and Layer diagram describe consumers by role, and `pnpm harness:scan`
      still exits 0.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                    | Notes                            |
| ----- | ---------------------- | -------------------------------------------------- | -------------------------------- |
| TC-01 | CI pipeline smoke test | `rg` grep assertion over `agent-core/docs/SPEC.md` | Command-form: zero consumer refs |
| TC-02 | CI pipeline smoke test | `pnpm harness:scan` exit 0                         | doc-only change                  |

## Tasks

- [ ] `.agents/tasks/INFRA-004.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
