---
title: 'ARCH-SPEC-001: 누락된 SPEC.md 작성 — agent-interface-transport, agent-interface-tui, agent-remote-client'
status: done
completed: 2026-05-22
created: 2026-05-20
priority: medium
urgency: later
area: packages/agent-interface-transport, packages/agent-interface-tui, packages/agent-remote-client
depends_on: []
---

## Background

아키텍처 감사 결과, 다음 패키지들에 SPEC.md가 없다:

| 패키지                      | 현황                                     |
| --------------------------- | ---------------------------------------- |
| `agent-interface-transport` | cross-cutting-contracts.md에 언급만 있음 |
| `agent-interface-tui`       | cross-cutting-contracts.md에 언급만 있음 |
| `agent-remote-client`       | architecture-map에 2줄 언급              |

이 패키지들은 zero-deps 원칙을 가진 타입 계약 패키지이므로,
SPEC.md 작성이 비교적 간단하다.

## 작업 항목

### packages/agent-interface-transport/docs/SPEC.md

- Scope: 타입 계약만 포함, 구현 없음
- 주요 exports: `ITransportAdapter`, `IConfigurableTransport`, `ITransportConfig` 등
- 의존성 규칙: zero deps
- 사용처: agent-transport, agent-framework

### packages/agent-interface-tui/docs/SPEC.md

- Scope: TUI 상호작용 타입 계약
- 주요 exports: `ITuiPickerItem`, `ITuiCommandInteraction`, 등
- 의존성 규칙: zero deps
- 사용처: agent-transport/tui, agent-cli

### packages/agent-remote-client/docs/SPEC.md

- Scope: 원격 실행 클라이언트 (API 키 서버사이드 보관)
- 사용처: agent-playground
- 의존성: agent-core

## Test Plan

- 각 패키지에 `docs/SPEC.md` 존재 확인
- SPEC.md 내용이 실제 exports와 일치

## User Execution Test Scenarios

### Scenario 1: SPEC.md 존재 확인

```bash
ls packages/agent-interface-transport/docs/SPEC.md
ls packages/agent-interface-tui/docs/SPEC.md
ls packages/agent-remote-client/docs/SPEC.md
```

Expected: 모두 존재
