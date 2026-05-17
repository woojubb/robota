---
title: 'ARCH-MAP-001: agent-web → agent-web-ui rename in architecture map (6 files)'
status: done
created: 2026-05-18
completed: 2026-05-18
priority: high
urgency: soon
area: .agents/specs/architecture-map
depends_on: []
---

## Problem

패키지명 `agent-web`이 `agent-web-ui`로 변경됐으나 architecture map 6개 파일에서 구 이름을 그대로 사용 중.
`apps/agent-web`(앱 디렉토리)과 `@robota-sdk/agent-web-ui`(패키지)를 혼동하는 표현도 포함되어 있음.

## Required Changes

| File                           | Lines        | Current → Correct                                      |
| ------------------------------ | ------------ | ------------------------------------------------------ |
| `agent-system.md`              | 85, 105      | `agent-web` (diagram node, table) → `agent-web-ui`     |
| `agent-system.md`              | 90           | `agent-provider-openai / anthropic` → `agent-provider` |
| `apps-and-deployment.md`       | 44           | `@robota-sdk/agent-web` → `@robota-sdk/agent-web-ui`   |
| `apps-and-deployment.md`       | 48, 51, 54   | `agent-web` (ambiguous prose) → `apps/agent-web`       |
| `apps-and-deployment.md`       | 31           | `agent-server` (no prefix) → `apps/agent-server`       |
| `apps-and-deployment.md`       | 39–40        | unclosed backticks in table → fix Markdown formatting  |
| `capability-placement.md`      | 18, 53, 64   | `agent-web` → `agent-web-ui`                           |
| `dependency-direction.md`      | 11 (diagram) | `agent-web` → `agent-web-ui`                           |
| `dependency-direction.md`      | 71 (prose)   | `` `agent-web` `` → `` `agent-web-ui` ``               |
| `repository-overview.md`       | 59 (table)   | `agent-web` → `agent-web-ui`                           |
| `agent-cli/execution-modes.md` | 70           | `agent-web (browser)` → `agent-web-ui (browser)`       |

총 11개 참조, 6개 파일.

## Test Plan

- [ ] 수정 후 `grep -r "agent-web[^-]" .agents/specs/architecture-map/` 결과가 `apps/agent-web` 형태만 남아야 함
- [ ] Mermaid 다이어그램 문법 오류 없음 (`agent-system.md`, `dependency-direction.md`)
- [ ] Markdown 링크 및 백틱 열림/닫힘 균형 확인

## Source

`.design/arch-map-audit/COMPREHENSIVE-REPORT.md` Category 1 (HIGH)
