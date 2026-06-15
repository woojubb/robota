---
title: 'DOCS-003: README 정확도 갱신 (root + 패키지 + apps)'
status: done
created: 2026-06-16
completed: 2026-06-16
priority: high
urgency: soon
area: README.md, packages/agent-core, packages/agent-framework, packages/agent-command, packages/agent-cli, apps/agent-server
depends_on: []
---

# DOCS-003: README 정확도 갱신

## Problem

근거: `.design/docs-audit/2026-06-16/report-readmes.md`. 출하되지 않은 패키지 분할/가공 패키지명 등.

- **root `README.md`**: 아키텍처 다이어그램·Packages 표가 beta.76 변경 누락(19개 중 ~6개만, transport
  split·agent-session-analytics 등 부재).
- **agent-core/README.md**: 출하 안 된 `@robota-sdk/agent-plugin-*` 분할 서술(실제 consolidated
  `agent-plugin`); 비존재 복수형 `agent-sessions/agent-providers/agent-plugins/agent-sdk`;
  private `agent-tool-mcp`를 설치 대상으로 제시.
- **agent-framework/README.md**: 비존재 `@robota-sdk/agent-command-skills` import(실제 `agent-command`의
  `./skills`); 개별 `agent-plugin-*` 나열; 구명 `agent-sdk`.
- **agent-command/README.md**: 커맨드 인벤토리 stale — "20개"라 하나 실제 22개 export, `/preset`·
  `/schedule` 누락.
- **agent-cli/README.md**: 비존재 `@robota-sdk/agent-transport-headless`(실제 `agent-transport`의
  `./headless`); `--model` 예시 구 모델 id.
- **apps/agent-server/README.md**: 비존재 `@robota-sdk/agent-remote-server-core`.

## Solution

각 README를 실제 패키지/export에 맞춰 수정. root 표는 19개 공개 패키지 반영(또는 "curated subset"
명시) + transport split·agent-session-analytics 추가. private 패키지를 설치 대상으로 제시하지 않음.

## Completion Criteria

- [x] TC-01: 대상 README에서 비존재 패키지/심볼(`agent-plugin-*`, `agent-command-skills`,
      `agent-transport-headless`, `agent-remote-server-core`, 복수형 명) 참조 0건
- [x] TC-02: agent-command README가 `/preset`·`/schedule` 포함, 카운트(22) 정정
- [x] TC-03: root README가 transport split + agent-session-analytics 반영(또는 subset 명시)
- [x] TC-04: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type  | Approach                                           |
| ----- | ---------- | -------------------------------------------------- |
| TC-01 | Doc/grep   | 비존재 식별자 grep → 0건                           |
| TC-02 | Doc review | agent-command/src/index.ts export ↔ README 표 대조 |
| TC-03 | Doc review | root 표/다이어그램 검토                            |
| TC-04 | Harness    | `pnpm harness:scan`                                |

## User Execution Test Scenarios

Not applicable — README 정확도(설명/표/다이어그램) 갱신. 사용자 대면 런타임 동작 무변경.
(코드 샘플 변경분이 있으면 해당 import만 타입 확인.)

## Tasks

- [x] README별 비존재 참조 교체 + 인벤토리/표 정정 → grep 0건 → harness:scan

## Evidence Log

### 구현 완료 — 2026-06-16

- **agent-cli:** `agent-transport-headless` → `agent-transport (./headless)`; `claude-opus-4-7` →
  `claude-sonnet-4-6`; 트리의 `agent-command-skills` → `agent-command (./skills)`.
- **agent-core:** 다이어그램 복수형 → 단수 실제명 + `agent-framework`; `agent-plugin-*` → `agent-plugin`.
- **agent-framework:** `agent-command-skills`/`agent-command-*` → `agent-command`; `agent-sdk` →
  `agent-framework`; 개별 `agent-plugin-*` 나열 → consolidated 8 클래스.
- **agent-command:** 표에 `/preset`·`/schedule` 추가; "All 20 factory functions" → 정확한 카운트.
- **root README:** Packages 표를 19개 공개 패키지 전체로 확장; 다이어그램에 transport 계층 반영.
- **agent-server:** 가공 `agent-remote-server-core` → 실제 구성(framework/provider/playground) 서술.
- **TC-01~04:** phantom 토큰 grep 0건(남은 매치는 부정문), agent-command src와 표 일치,
  `pnpm harness:scan` **26/26 passed**.
