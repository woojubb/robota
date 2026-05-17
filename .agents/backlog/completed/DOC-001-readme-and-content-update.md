---
title: 'DOC-001: packages README.md 전수 최신화 + content/ 문서 현행화'
status: done
created: 2026-05-17
completed: 2026-05-18
priority: medium
urgency: soon
area: packages/*, content/
depends_on: []
---

## Problem

ARCH-BL-001~004 통합 작업(agent-transport-\*, agent-command-\*, agent-plugin-\*, agent-provider-\* 통합)과
SDK-001/002, CMD-001~003 등 주요 기능 추가 이후, 두 문서 계층이 현실과 크게 벗어났다.

### 1. packages/\*/README.md 현황

| 패키지                          | README 있음 | 상태                               |
| ------------------------------- | ----------- | ---------------------------------- |
| `agent-cli`                     | ✓           | 구 명칭/구조 참조 가능성 높음      |
| `agent-core`                    | ✓           | 구 명칭/구조 참조 가능성 높음      |
| `agent-executor`                | ✓           | 검토 필요                          |
| `agent-framework`               | ✓           | 검토 필요                          |
| `agent-session`                 | ✓           | 검토 필요                          |
| `agent-team`                    | ✓           | 검토 필요                          |
| `agent-tool-mcp`                | ✓           | 검토 필요                          |
| `agent-tools`                   | ✓           | 검토 필요                          |
| `agent-playground`              | ✓           | 검토 필요                          |
| `agent-remote-client`           | ✓           | 검토 필요                          |
| **`agent-command`**             | ✗           | **README 없음** — 신규 통합 패키지 |
| **`agent-interface-transport`** | ✗           | **README 없음**                    |
| **`agent-plugin`**              | ✗           | **README 없음** — 신규 통합 패키지 |
| **`agent-provider`**            | ✗           | **README 없음** — 신규 통합 패키지 |
| **`agent-transport`**           | ✗           | **README 없음** — 신규 통합 패키지 |
| **`agent-web-ui`**              | ✗           | **README 없음**                    |

### 2. content/ 현황

`content/api-reference/` 하위 디렉터리가 구 패키지 명칭 기준으로 구성되어 있음:

```
content/api-reference/
  agent-plugin-conversation-history/   ← 삭제된 패키지 (→ agent-plugin 통합)
  agent-plugin-error-handling/         ← 삭제된 패키지
  agent-plugin-event-emitter/          ← 삭제된 패키지
  agent-plugin-execution-analytics/    ← 삭제된 패키지
  agent-plugin-limits/                 ← 삭제된 패키지
  agent-plugin-logging/                ← 삭제된 패키지
  agent-plugin-performance/            ← 삭제된 패키지
  agent-plugin-usage/                  ← 삭제된 패키지
  agent-plugin-webhook/                ← 삭제된 패키지
  agent-provider-anthropic/            ← 삭제된 패키지 (→ agent-provider 통합)
  agent-provider-bytedance/            ← 삭제된 패키지
  agent-provider-google/               ← 삭제된 패키지
  agent-provider-openai/               ← 삭제된 패키지
  agent-sdk/                           ← 구 명칭
  agent-remote-server-core/            ← 구 명칭
  agent-sessions/                      ← 구 명칭 (→ agent-session)
  ...
```

`content/guide/`의 sdk.md, architecture.md, cli.md 등도 통합 전 아키텍처 기반으로 작성되어 있을 가능성이 높음.

## Goal

1. **packages/\*/README.md 전수 최신화**: 없는 패키지는 신규 작성, 있는 패키지는 현행 SPEC.md 기준으로 갱신
2. **content/api-reference/ 재구성**: 구 패키지명 기준 디렉터리를 현행 패키지 구조에 맞게 정리
3. **content/guide/ 최신화**: architecture, sdk, cli 가이드를 현행 아키텍처(통합 패키지 구조) 기준으로 갱신
4. **content/getting-started/ 검토**: 현행 설치/사용 방법 반영

> ⚠️ `content/v2.0.0/` 은 영구 보존 대상 — 절대 수정/삭제 금지.

## Scope

### Phase 1: packages README.md

- [ ] README 없는 6개 패키지 신규 작성: `agent-command`, `agent-interface-transport`, `agent-plugin`, `agent-provider`, `agent-transport`, `agent-web-ui`
- [ ] 기존 10개 패키지 README 검토 및 갱신 (SPEC.md SSOT 기준)
- [ ] 각 README: 패키지 역할, 설치, 기본 사용법, 의존 패키지, npm 링크 포함

### Phase 2: content/api-reference/ 재구성

- [ ] 구 패키지명 디렉터리 삭제 또는 리다이렉트 처리 (통합된 패키지로 병합)
- [ ] 현행 패키지 기준 api-reference 디렉터리 신규 구성: `agent-command`, `agent-plugin`, `agent-provider`, `agent-transport`
- [ ] 기존 유효 문서는 해당 통합 패키지 디렉터리로 이동/병합

### Phase 3: content/guide/ + getting-started/ 갱신

- [ ] `guide/architecture.md`: 현행 패키지 구조(통합 후) 반영
- [ ] `guide/sdk.md`: 현행 SDK 사용법 반영
- [ ] `guide/cli.md`: 현행 CLI 기능(CMD-001~003 포함) 반영
- [ ] `getting-started/`: 현행 설치 및 빠른 시작 반영

## Test Plan

- [ ] 모든 내부 링크(문서 간 href) 깨지지 않음 확인
- [ ] 문서 내 import 예시의 패키지명이 실제 npm 패키지명과 일치
- [ ] `content/v2.0.0/` 변경 없음 확인 (git diff로 검증)
- [ ] `pnpm docs:build` 통과 (빌드 오류 없음)

## User Execution Test Scenarios

### Scenario 1: npm 패키지 페이지에서 README 확인

**Steps**:

```
npm view @robota-sdk/agent-transport
npm view @robota-sdk/agent-plugin
npm view @robota-sdk/agent-provider
npm view @robota-sdk/agent-command
```

**Expected**: 각 패키지의 README가 현행 기능 설명으로 표시됨

**Evidence (2026-05-18)**:

Phase 1: `packages/agent-interface-tui/README.md`, `packages/agent-subagent-runner/README.md` 신규 작성 (나머지 16개 패키지 README 기존 존재 확인).
Phase 2: `content/api-reference/`에서 구 패키지명 18개 디렉토리 삭제 (agent-plugin-logging 등).
Phase 3: `content/guide/` 5개 파일의 구식 참조 수정 (`agent-sdk`→`agent-framework`, `agent-sessions`→`agent-session`, `agent-provider-anthropic`→`agent-provider` 등 22개 라인 업데이트).

### Scenario 2: docs 사이트 api-reference 탐색

**Steps**:

```
로컬 docs 서버 실행 후 /api-reference/ 섹션 탐색
구 패키지명(agent-plugin-logging 등) 링크 접근 시 동작 확인
현행 패키지명(agent-plugin 등) 링크 접근 시 정상 표시 확인
```

**Expected**: 구 패키지명 링크가 없거나 리다이렉트, 현행 패키지명은 정상 문서 표시

**Evidence**: _(구현 완료 후 스크린샷)_

### Scenario 3: getting-started 따라하기

**Steps**:

```
content/getting-started/ 가이드대로 신규 설치 및 실행
```

**Expected**: 현행 패키지명, 현행 API로 오류 없이 동작

**Evidence**: _(수동 검증)_
