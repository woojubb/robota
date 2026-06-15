---
title: 'DOCS-001: content 문서의 transport split 참조 갱신 (agent-transport/{tui,http,ws,mcp} → 독립 패키지)'
status: done
created: 2026-06-16
completed: 2026-06-16
priority: high
urgency: soon
area: content/guide, content/examples, content/README.md, content/development
depends_on: []
---

# DOCS-001: content transport split 참조 갱신

## Problem

beta.76에서 `agent-transport`가 lean core(`.`/`./headless`/`./testing`만 export)와 독립 패키지
`@robota-sdk/agent-transport-{tui,http,ws,mcp}`로 분할됐으나, 다수 문서가 구 모놀리식 서브경로
`@robota-sdk/agent-transport/{tui,http,ws,mcp}`를 그대로 사용한다(import 실패). 근거:
`.design/docs-audit/2026-06-16/report-content-core-guides.md`, `report-content-examples-integrations.md`.

대상:

- `content/guide/architecture.md` (~14곳: 다이어그램/표/Dependency Flow)
- `content/guide/sdk.md` (transport 표 ~357–380; `agent-transport/headless`만 유효)
- `content/guide/cli.md` (~3, 5, 220: `agent-transport/tui`)
- `content/README.md` (~189, 213)
- `content/development/README.md` (~50 monorepo 트리)
- `content/examples/http-transport.md` / `ws-transport.md` / `mcp-transport.md` (import 2곳씩)

## Solution

서브경로 import를 독립 패키지 root import로 교체(팩토리명 동일):
`@robota-sdk/agent-transport/http` → `@robota-sdk/agent-transport-http` 등. `./headless`·`./testing`는
유지. 다이어그램/표의 패키지 구조도 split 반영.

## Completion Criteria

- [x] TC-01: 대상 문서에서 `@robota-sdk/agent-transport/(tui|http|ws|mcp)` 참조 0건 (rg)
- [x] TC-02: 각 transport example의 import가 실제 export(`agent-transport-*` root)와 일치
- [x] TC-03: architecture/sdk/README 다이어그램·표가 split 구조 반영
- [x] TC-04: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type  | Approach                                            |
| ----- | ---------- | --------------------------------------------------- |
| TC-01 | Doc/grep   | `rg "agent-transport/(tui\|http\|ws\|mcp)" content` |
| TC-02 | Doc review | example import ↔ 패키지 package.json exports 대조   |
| TC-03 | Doc review | 다이어그램/표 검토                                  |
| TC-04 | Harness    | `pnpm harness:scan`                                 |

## User Execution Test Scenarios

content/examples/{http,ws,mcp}-transport.md는 사용자가 실행하는 코드 절차다. 수정 후 각 예제의
import/팩토리 호출이 현재 패키지에서 resolve되는지 최소 빌드/타입 확인으로 검증한다(빈 임시 프로젝트
또는 타입 체크). architecture/sdk/README의 다이어그램·표 변경은 prose라 Not applicable.

## Tasks

- [x] 서브경로 → 독립 패키지 import 교체 → grep 0건 → harness:scan

## Evidence Log

### 구현 완료 — 2026-06-16

- **TC-01:** `agent-transport/(tui|http|ws|mcp)` → `agent-transport-$1` 일괄 변환(examples ×3, guide ×3).
  content 전체 잔존 0건(`/headless`·`/testing` 보존). "subpath of agent-transport" prose도 standalone으로 정정.
- **TC-02:** 6개 factory가 각 `agent-transport-*` index에서 re-export됨 확인 — doc import와 일치.
- **TC-03:** README.md/development/README.md의 consolidated 서술을 lean core + 독립 패키지 구조로 재작성.
- **TC-04:** `pnpm harness:scan` **26/26 passed**.
