---
title: 'ARCH-MAP-002: agent-provider-* individual refs + bare SDK abbreviation cleanup'
status: todo
created: 2026-05-18
priority: medium
urgency: later
area: .agents/specs/architecture-map
depends_on: []
---

## Problem

통합 전 개별 provider 패키지명과 구 "SDK" 약어가 architecture map 2개 파일에 잔존.

### Category 2 — agent-provider-\* individual package names

`agent-cli/composition-tree.md` lines 26–31에 통합 전 6개 개별 패키지명이 노드로 남아 있음:

- `agent-provider-anthropic`, `agent-provider-openai`, `agent-provider-gemini`
- `agent-provider-gemma`, `agent-provider-qwen`, `agent-provider-deepseek`

모두 `agent-provider` (consolidated)로 교체.

### Category 3 — bare "SDK" abbreviation

`agent-sdk` → `agent-framework` 변경 후 bare "SDK" 표현 잔존:

| File                                      | Lines  | Current → Correct                                                             |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| `agent-cli-composition.md`                | 15, 51 | `sessions` (복수) → `agent-session`                                           |
| `agent-cli-composition.md`                | 15, 51 | `command packages` (복수) → `agent-command`                                   |
| `agent-cli-composition.md`                | 51     | `provider packages` (복수) → `agent-provider`                                 |
| `agent-cli/commands-and-provider-flow.md` | 55     | `SDK provider common APIs` → `agent-framework provider common APIs`           |
| `agent-cli/commands-and-provider-flow.md` | 83     | `SDK model command common APIs` → `agent-framework model command common APIs` |

## Test Plan

- [ ] `grep -r "agent-provider-anthropic\|agent-provider-openai\|agent-provider-gemini" .agents/specs/architecture-map/` 결과 없음
- [ ] `grep -r " SDK " .agents/specs/architecture-map/` 결과 없음 (대문자 SDK만 검사)
- [ ] Mermaid 다이어그램 문법 오류 없음

## Source

`.design/arch-map-audit/COMPREHENSIVE-REPORT.md` Category 2 (MEDIUM) + Category 3 (LOW)
