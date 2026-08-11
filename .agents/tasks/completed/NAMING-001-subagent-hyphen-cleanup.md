---
title: 'NAMING-001: production 코드의 금지 하이픈형 sub-agent → subagent 정리'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: medium
urgency: now
area: packages/agent-core, packages/agent-framework
depends_on: []
---

# NAMING-001: sub-agent 하이픈형 정리

## Problem (하네스 검증에서 발견)

규칙대로 하네스 전체를 검증하던 중 `harness:cleanup`이 production 코드 3곳에서 금지된 하이픈형
`sub-agent`를 탐지(`forbidden-agent-term`). naming-style.md는 `main agent`/`sub-agent`/
`parent-agent`/`child-agent` 등 계층 함의 명명을 금지하며, 프로젝트 표준은 비하이픈 `subagent`다.

대상(전부 **주석/문서 prose/LLM 프롬프트 문자열** — 식별자·타입·API 계약 아님 → 동작 무영향):

- `packages/agent-core/src/hooks/types.ts:52` — 주석
- `packages/agent-framework/src/tools/agent-tool.ts:2,6` — 주석
- `packages/agent-framework/src/hooks/agent-executor.ts:2,21` — 주석
- `packages/agent-framework/src/assembly/subagent-prompts.ts:35` — 프롬프트 문자열 "sub-agents"
  (cleanup 정규식 `\bsub-agent\b`엔 안 잡히나 같은 문자열 안에서 `subagent`와 혼용되어 일관성상 정리)

범위 외(보고만): `apps/blog/src/content/.../*.md` 의 "sub-agent"는 일반 개념 설명 prose로,
우리 에이전트 정체성 명명이 아니므로 본 작업 대상에서 제외.

## Solution

위 코드/프롬프트의 `sub-agent(s)` → `subagent(s)`로 교체(의미 동일, 주석/문자열만). 식별자·export·
타입명 변경 없음.

## Completion Criteria

- [x] TC-01: agent-core·agent-framework src의 `\bsub-agent\b` 0건 (rg 검증)
- [x] TC-02: `harness:cleanup`의 `forbidden-agent-term` 0건 (현 3 → 0)
- [x] TC-03: 영향 패키지 typecheck + build 통과 (식별자 무변경 → 동작 불변)
- [x] TC-04: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type   | Approach                                          |
| ----- | ----------- | ------------------------------------------------- |
| TC-01 | Code review | `rg "\bsub-agent\b" packages/*/src` → 0건         |
| TC-02 | Integration | `pnpm harness:cleanup` → forbidden-agent-term 0건 |
| TC-03 | Build       | agent-core·agent-framework typecheck + build      |
| TC-04 | Harness     | `pnpm harness:scan` 통과                          |

## User Execution Test Scenarios

Not applicable — 주석/문자열 명명 정리. 사용자 대면 런타임 동작 무변경(식별자·계약 불변).

## Tasks

- [x] sub-agent → subagent 교체 → typecheck/build → cleanup/scan 검증

## Evidence Log

### 구현 완료 — 2026-06-15

- **교체(주석/문자열만, 식별자·타입·export 불변):**
  - `agent-core/src/hooks/types.ts:52` 주석 sub-agent → subagent
  - `agent-framework/src/tools/agent-tool.ts:2,6` 주석 sub-agent → subagent
  - `agent-framework/src/hooks/agent-executor.ts:2,21` 주석 sub-agent → subagent
  - `agent-framework/src/assembly/subagent-prompts.ts:35` 프롬프트 "sub-agents" → "subagents"(일관성)
- **TC-01:** `rg "\bsub-agent\b" packages/*/src apps/*/src` → blog .md 제외 **0건**.
- **TC-02:** `pnpm harness:cleanup` `forbidden-agent-term` **3 → 0**.
- **TC-03:** agent-core·agent-framework **typecheck exit 0**, **build exit 0**(식별자 무변경 → 동작 불변).
- **TC-04:** `pnpm harness:scan` **26/26 passed**.
- 범위 외: `apps/blog/src/content/.../how-coding-agent-works.md`의 "sub-agent" 3건은 일반 개념
  설명 prose(우리 에이전트 정체성 명명 아님)라 제외.

User Execution Test Scenario gate: Not applicable — 주석/문자열 명명 정리(런타임·계약 불변).
