---
title: 'DOCFIX-001: SPEC.md/README의 transport 서브경로 참조 갱신 (split 반영)'
status: done
created: 2026-06-16
completed: 2026-06-16
priority: medium
urgency: soon
area: packages/agent-interface-transport, packages/agent-web-ui, packages/agent-cli, packages/agent-interface-tui
depends_on: []
---

# DOCFIX-001: SPEC.md transport 서브경로 참조 갱신

## Problem

DOCS-001~006(README+content) 실행 중 발견. beta.76 transport split이 **SPEC.md/일부 README**에는
반영되지 않아 구 모놀리식 서브경로 `agent-transport/{tui,ws,http,mcp}`를 그대로 서술한다. DOCS 감사
범위(README+content)에서 제외됐던 SPEC 레이어. 코드(=split된 현재 상태)가 진실이므로 SPEC prose를 맞춘다.

대상(`/headless`는 실제 lean-core 서브경로라 보존):

- `packages/agent-interface-transport/docs/SPEC.md` (42, 161, 162)
- `packages/agent-web-ui/docs/SPEC.md` (21, 25, 40, 58, 73, 132–136) + `README.md` (79)
- `packages/agent-cli/docs/SPEC.md` (38, 277, 281, 349, 913)
- `packages/agent-interface-tui/docs/SPEC.md` (9, 27) + `README.md` (22)

(CHANGELOG.md의 옛 이름은 역사적 정확이라 대상 외.)

## Solution

`agent-transport/(tui|ws|http|mcp)` → `agent-transport-$1`로 교체(prose/다이어그램/표). `/headless`는 유지.
코드 식별자·계약 변경 없음(문서 서술만).

## Completion Criteria

- [x] TC-01: 대상 SPEC.md/README에서 `agent-transport/(tui|ws|http|mcp)` 참조 0건 (rg, `/headless` 제외)
- [x] TC-02: `/headless` 참조는 보존
- [x] TC-03: `pnpm harness:scan` 통과 (spec-paths/conformance 포함)

## Test Plan

| TC-ID | Test Type | Approach                                                   |
| ----- | --------- | ---------------------------------------------------------- |
| TC-01 | Doc/grep  | `rg "agent-transport/(tui\|ws\|http\|mcp)" packages` → 0건 |
| TC-02 | Doc/grep  | `/headless` 잔존 확인                                      |
| TC-03 | Harness   | `pnpm harness:scan`                                        |

## User Execution Test Scenarios

Not applicable — SPEC.md/README 서술 갱신(코드·계약 무변경).

## Tasks

- [x] 서브경로 → 독립 패키지 prose 교체 → grep/harness:scan

## Evidence Log

### 구현 완료 — 2026-06-16

- **TC-01:** `agent-transport/(tui|ws|http|mcp)` → `agent-transport-$1` 일괄 변환 — 6개 파일
  (agent-interface-transport/SPEC, agent-web-ui/SPEC+README, agent-cli/SPEC, agent-interface-tui/SPEC+README).
  CHANGELOG·v2.0.0 제외 잔존 0건.
- **TC-02:** `/headless` 참조 보존 확인(예: agent-cli/SPEC.md 2건 유지).
- **TC-03:** `pnpm harness:scan` **26/26 passed**(spec-paths/conformance 포함). 코드 식별자·계약 무변경.
