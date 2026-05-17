---
title: 'ARCH-MAP-005: class-interface-inventory ownership gaps + stale file path fix'
status: todo
created: 2026-05-18
priority: low
urgency: backlog
area: .agents/specs/architecture-map
depends_on: [ARCH-MAP-004]
---

## Problem

두 가지 독립적인 LOW 이슈.

### Issue A — class-interface-inventory.md 소유권 공백

`agent-cli/class-interface-inventory.md`에서 신규 패키지 인터페이스가 소유자 행 없이 outbound dep으로만 참조됨:

| 공백                                       | 상세                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `agent-interface-transport` 소유권 행 없음 | `IConfigurableTransport`가 outbound dep으로만 참조                             |
| `agent-interface-tui` 소유권 행 없음       | `ITuiCommandInteraction`, `ITuiCliAdapter`, `ITerminalOutput` 소유자 없이 참조 |
| `agent-provider-*` 통합 정보 누락          | 이름 맵에 `agent-provider-* → agent-provider` 통합 미기재                      |
| `/http`, `/mcp` subpath 누락               | transport subpath 목록에서 `/http`, `/mcp` 누락                                |

### Issue B — agent-cli/layering-audit.md 파일 경로 오류

Line 63:

- Current: `agent-cli/src/background/managed-shell-process-runner.ts`
- Correct: `agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts`

파일이 `arch-fix-024` 리팩터링으로 `agent-executor`로 이동됐으나 문서가 미반영.

## Required Changes

### class-interface-inventory.md

1. `agent-interface-transport` 소유권 행 추가 (owned interfaces: `ITransportAdapter`, `IConfigurableTransport`)
2. `agent-interface-tui` 소유권 행 추가 (owned interfaces: `ITuiCommandInteraction`, `ITuiCliAdapter`, `ITerminalOutput`)
3. provider 통합 이름 맵 섹션에 `agent-provider-* → agent-provider` 항목 추가
4. transport subpath 목록에 `/http`, `/mcp` 추가

### layering-audit.md

- Line 63 파일 경로를 `agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts`로 수정

## Test Plan

- [ ] 수정 후 `grep "agent-cli/src/background" .agents/specs/architecture-map/agent-cli/layering-audit.md` 결과 없음
- [ ] `agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts` 실제 존재 확인
- [ ] class-interface-inventory.md의 모든 outbound dep 인터페이스에 owner 행이 있음

## Source

`.design/arch-map-audit/COMPREHENSIVE-REPORT.md` Category 6 (LOW) + Category 7 (MEDIUM)
