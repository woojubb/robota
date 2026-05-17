# Architecture Map Audit — Comprehensive Report

Generated: 2026-05-18  
Scope: `.agents/specs/architecture-map/` (16 files)  
Method: 16 parallel agents, one per file

---

## Executive Summary

16개 파일 중 **12개에서 이슈 발견**, 4개는 클린.  
총 **32개 stale 참조** + **11개 누락 패키지** 확인.

가장 큰 단일 문제는 `agent-web` → `agent-web-ui` 패키지명 변경이 6개 파일에 걸쳐 반영되지 않은 것.  
두 번째는 `agent-interface-transport`, `agent-interface-tui`, `agent-team` 신규 패키지가 아키텍처 맵 어디에도 등재되지 않은 것.

---

## Clean Files (수정 불필요)

| File                               | Verdict                                |
| ---------------------------------- | -------------------------------------- |
| `README.md`                        | ✅ 클린 — 패키지명 직접 참조 없음      |
| `architecture-lessons.md`          | ✅ 클린 — PR/커밋 해시만 참조          |
| `agent-cli/README.md`              | ✅ 클린 — 라우터 인덱스, 패키지명 없음 |
| `agent-cli/target-architecture.md` | ✅ 클린 — 모든 패키지명 최신           |

---

## Issues by Category

### Category 1 — `agent-web` → `agent-web-ui` rename (HIGH)

패키지명 `agent-web`이 `agent-web-ui`로 변경됐으나 6개 파일에서 구 이름 사용 중.  
`apps/agent-web`(앱 디렉토리)과 구분 필요.

| File                           | Lines        | Current                             | Correct                    |
| ------------------------------ | ------------ | ----------------------------------- | -------------------------- |
| `agent-system.md`              | 85, 105      | `agent-web` (diagram node, table)   | `agent-web-ui`             |
| `agent-system.md`              | 90           | `agent-provider-openai / anthropic` | `agent-provider`           |
| `apps-and-deployment.md`       | 44           | `@robota-sdk/agent-web`             | `@robota-sdk/agent-web-ui` |
| `apps-and-deployment.md`       | 48, 51, 54   | `agent-web` (prose, ambiguous)      | `apps/agent-web`           |
| `apps-and-deployment.md`       | 31           | `agent-server` (no prefix)          | `apps/agent-server`        |
| `apps-and-deployment.md`       | 39–40        | unclosed backticks in table         | fix Markdown formatting    |
| `capability-placement.md`      | 18, 53, 64   | `agent-web`                         | `agent-web-ui`             |
| `dependency-direction.md`      | 11 (diagram) | `agent-web`                         | `agent-web-ui`             |
| `dependency-direction.md`      | 71 (prose)   | `` `agent-web` ``                   | `` `agent-web-ui` ``       |
| `repository-overview.md`       | 59 (table)   | `agent-web`                         | `agent-web-ui`             |
| `agent-cli/execution-modes.md` | 70           | `agent-web (browser)`               | `agent-web-ui (browser)`   |

**총 11개 참조, 6개 파일**

---

### Category 2 — agent-provider-\* 개별 패키지명 잔존 (MEDIUM)

통합 전 개별 provider 패키지명이 아직 남아 있는 파일.

| File                            | Lines | Current                                                                                                                                                | Correct                         |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `agent-cli/composition-tree.md` | 26–31 | `agent-provider-anthropic`, `agent-provider-openai`, `agent-provider-gemini`, `agent-provider-gemma`, `agent-provider-qwen`, `agent-provider-deepseek` | `agent-provider` (consolidated) |

**총 6개 참조, 1개 파일**

---

### Category 3 — 구 "SDK" 약어 잔존 (LOW)

`agent-sdk` → `agent-framework` 변경 후 bare "SDK" 표현이 일부 남아 있음.

| File                                      | Lines  | Current                         | Correct                                     |
| ----------------------------------------- | ------ | ------------------------------- | ------------------------------------------- |
| `agent-cli-composition.md`                | 15, 51 | `sessions` (복수)               | `agent-session`                             |
| `agent-cli-composition.md`                | 15, 51 | `command packages` (복수)       | `agent-command`                             |
| `agent-cli-composition.md`                | 51     | `provider packages` (복수)      | `agent-provider`                            |
| `agent-cli/commands-and-provider-flow.md` | 55     | `SDK provider common APIs`      | `agent-framework provider common APIs`      |
| `agent-cli/commands-and-provider-flow.md` | 83     | `SDK model command common APIs` | `agent-framework model command common APIs` |

**총 7개 참조, 2개 파일**

---

### Category 4 — 존재하지 않는 패키지 참조 (MEDIUM)

`auth`, `credits` 패키지가 `packages/` 디렉토리에 존재하지 않으나 architecture map에서 SPEC.md를 링크.

| File                         | Lines           | Issue                                                                     |
| ---------------------------- | --------------- | ------------------------------------------------------------------------- |
| `cross-cutting-contracts.md` | 33–34 (Mermaid) | `auth SPEC`, `credits SPEC` 노드 — 패키지 없음                            |
| `cross-cutting-contracts.md` | 55–56 (table)   | `packages/auth/docs/SPEC.md`, `packages/credits/docs/SPEC.md` — 파일 없음 |

**총 4개 참조, 1개 파일**

---

### Category 5 — 신규 패키지 누락 (MEDIUM)

아래 패키지가 실제로 존재하나 architecture map 전반에서 언급되지 않음.

| Package                     | 역할                                                                       | 누락 파일                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `agent-interface-transport` | Transport 어댑터 타입 계약 (`ITransportAdapter`, `IConfigurableTransport`) | agent-system.md, capability-placement.md, dependency-direction.md, repository-overview.md, class-interface-inventory.md |
| `agent-interface-tui`       | TUI 인터랙션 타입 계약 (`ITuiCommandInteraction` 등)                       | agent-system.md, capability-placement.md, dependency-direction.md, repository-overview.md, class-interface-inventory.md |
| `agent-team`                | 멀티에이전트 조율                                                          | agent-system.md, capability-placement.md                                                                                |
| `agent-playground`          | Playground 재사용 동작 패키지                                              | dependency-direction.md                                                                                                 |

---

### Category 6 — 파일 경로 오류 (LOW)

| File                          | Line | Current                                                    | Correct                                                                       |
| ----------------------------- | ---- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `agent-cli/layering-audit.md` | 63   | `agent-cli/src/background/managed-shell-process-runner.ts` | `agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts` |

**총 1개 참조, 1개 파일**

---

### Category 7 — class-interface-inventory 소유권 공백 (MEDIUM)

| Issue                                      | Detail                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `agent-interface-transport` 소유권 행 없음 | `IConfigurableTransport`가 outbound dep으로만 참조되고 owner 행 없음                            |
| `agent-interface-tui` 소유권 행 없음       | `ITuiCommandInteraction`, `ITuiCliAdapter`, `ITerminalOutput` 등 contracts가 소유자 없이 참조됨 |
| agent-provider-\* 통합 정보 누락           | 이름 맵에 `agent-provider-* → agent-provider` 통합 미기재                                       |
| /http, /mcp subpath 누락                   | transport subpath 목록에서 `/http`, `/mcp` 누락                                                 |

**1개 파일 (agent-cli/class-interface-inventory.md)**

---

## Severity Matrix

| Category                     | 심각도 | 파일 수 | 참조 수 |
| ---------------------------- | ------ | ------- | ------- |
| 1. agent-web 리네임          | HIGH   | 6       | 11      |
| 2. agent-provider-\* 잔존    | MEDIUM | 1       | 6       |
| 3. SDK 약어 잔존             | LOW    | 2       | 7       |
| 4. 존재하지 않는 패키지 참조 | MEDIUM | 1       | 4       |
| 5. 신규 패키지 누락          | MEDIUM | 5       | —       |
| 6. 파일 경로 오류            | LOW    | 1       | 1       |
| 7. 인벤토리 소유권 공백      | MEDIUM | 1       | 4       |

---

## Recommended Backlog Items

| ID           | Title                                                                             | Priority |
| ------------ | --------------------------------------------------------------------------------- | -------- |
| ARCH-MAP-001 | `agent-web` → `agent-web-ui` 6개 파일 일괄 수정                                   | high     |
| ARCH-MAP-002 | `agent-provider-*` 개별 참조 → `agent-provider` 통합 + SDK 약어 정리              | medium   |
| ARCH-MAP-003 | `auth`/`credits` 비존재 패키지 참조 제거                                          | medium   |
| ARCH-MAP-004 | `agent-interface-transport`, `agent-interface-tui`, `agent-team` 아키텍처 맵 등재 | medium   |
| ARCH-MAP-005 | `class-interface-inventory.md` 소유권 공백 + 파일 경로 오류 수정                  | low      |
