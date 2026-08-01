---
title: 'ARCH-MAP-004: Add agent-interface-transport, agent-interface-tui, agent-team to architecture map'
status: done
created: 2026-05-18
completed: 2026-05-18
priority: medium
urgency: later
area: .agents/specs/architecture-map
depends_on: []
---

## Problem

아래 패키지가 실제로 존재하나 architecture map 전반에서 언급되지 않음.

| Package                     | 역할                                                                       | 누락 파일                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `agent-interface-transport` | Transport 어댑터 타입 계약 (`ITransportAdapter`, `IConfigurableTransport`) | agent-system.md, capability-placement.md, dependency-direction.md, repository-overview.md, class-interface-inventory.md |
| `agent-interface-tui`       | TUI 인터랙션 타입 계약 (`ITuiCommandInteraction` 등)                       | agent-system.md, capability-placement.md, dependency-direction.md, repository-overview.md, class-interface-inventory.md |
| `agent-team`                | 멀티에이전트 조율                                                          | agent-system.md, capability-placement.md                                                                                |
| `agent-playground`          | Playground 재사용 동작 패키지                                              | dependency-direction.md                                                                                                 |

## Required Changes

### agent-system.md

- Mermaid 다이어그램에 `agent-interface-transport`, `agent-interface-tui`, `agent-team` 노드 추가
- 패키지 테이블에 각 패키지 행 추가 (역할, 의존성 방향 포함)

### capability-placement.md

- Ownership Layer Map 다이어그램에 interface 패키지 위치 명시
- Owner Selection Table에 `agent-team` 다중 에이전트 조율 행 추가

### dependency-direction.md

- `agent-interface-transport`, `agent-interface-tui` 의존성 방향 다이어그램 반영
- `agent-playground` 노드 추가

### repository-overview.md

- Package Families 표에 interface 패키지 행 추가

### agent-cli/class-interface-inventory.md

- `agent-interface-transport` 소유 인터페이스 행 추가 (`ITransportAdapter`, `IConfigurableTransport`)
- `agent-interface-tui` 소유 인터페이스 행 추가 (`ITuiCommandInteraction`, `ITuiCliAdapter`, `ITerminalOutput`)

## Test Plan

- [ ] `grep -r "agent-interface-transport\|agent-interface-tui\|agent-team" .agents/specs/architecture-map/` 결과가 각 파일에서 최소 1개 이상
- [ ] 추가된 Mermaid 노드 문법 오류 없음
- [ ] 실제 `packages/` 목록과 architecture map 패키지 목록 diff 없음

## Source

`.design/arch-map-audit/COMPREHENSIVE-REPORT.md` Category 5 (MEDIUM)
