---
title: 'DOCS-005: changelog 최신화 + agent-session-analytics 문서화'
status: todo
created: 2026-06-16
priority: medium
urgency: later
area: content/changelog, content/README.md, content/guide, content/development
depends_on: []
---

# DOCS-005: changelog 최신화 + 신규 패키지 문서화

## Problem

근거: `.design/docs-audit/2026-06-16/report-content-core-guides.md`.

- `content/changelog/README.md`: 최신 항목이 Beta 67(2026-05-23). ground truth는 beta.76. 누락:
  transport split, `agent-session-analytics` 신규 패키지, 그 사이 릴리즈.
- 신규 공개 패키지 `@robota-sdk/agent-session-analytics`가 `content/README.md`,
  `content/guide/architecture.md`, `content/development/README.md`의 패키지 목록/다이어그램에 미문서화.

## Solution

changelog에 beta.68~76 핵심 변경(transport split, agent-session-analytics 신설, DQ-AUDIT 리팩터 등)
요약 추가. 패키지 목록/아키텍처 다이어그램에 agent-session-analytics(세션 로그 분석) 등재.
(transport split 자체의 본문 갱신은 DOCS-001과 중복되지 않게 changelog/목록 차원만.)

## Completion Criteria

- [ ] TC-01: changelog가 beta.76까지 반영(beta.68~76 항목 존재)
- [ ] TC-02: agent-session-analytics가 README/architecture/development 패키지 목록에 등재
- [ ] TC-03: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type  | Approach                                         |
| ----- | ---------- | ------------------------------------------------ |
| TC-01 | Doc review | changelog 최신 버전 = beta.76 확인               |
| TC-02 | Doc/grep   | `rg "agent-session-analytics" content` 등재 확인 |
| TC-03 | Harness    | `pnpm harness:scan`                              |

## User Execution Test Scenarios

Not applicable — changelog/패키지 목록(설명) 갱신. 사용자 대면 런타임 동작 무변경.

## Tasks

- [ ] changelog beta.68~76 추가 → agent-session-analytics 등재 → harness:scan

## Evidence Log

(구현 후 작성)
