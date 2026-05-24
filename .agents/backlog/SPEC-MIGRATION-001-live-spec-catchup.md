---
title: 'SPEC-MIGRATION-001: Live Spec 정책 전환 — 전 패키지 SPEC.md 마이그레이션'
status: todo
created: 2026-05-25
priority: high
urgency: soon
area: packages/*, apps/*
depends_on: [docs/live-spec-policy]
---

## Background

PR #592에서 "Live Spec Policy"를 수립했다. SPEC.md는 최초 작성 후 끝나는 문서가 아니라
모든 변경과 함께 증분 업데이트되는 살아있는 계약서다.

45개 백로그 구현(feat/backlog-spec-docs-migration) 이후 많은 패키지에서 SPEC.md와
실제 코드 사이의 괴리(drift)가 발생했다. 이 백로그는 전 패키지를 대상으로 한 번의
일괄 catch-up을 수행하여 "Live Spec" 기준선을 만든다.

이후 모든 PR은 Live Spec Policy에 따라 관련 패키지 SPEC.md를 함께 업데이트한다.

---

## 작업 범위

### Group A — 기존 SPEC.md drift 회복 (22개)

각 패키지에 대해 `spec-writing-standard` Mode C (Drift Recovery)를 수행한다:
현재 SPEC과 실제 코드를 섹션별로 비교 → gap 목록화 → 증분 업데이트.

| 패키지                                  | SPEC 경로                                         | 우선순위 | 비고                              |
| --------------------------------------- | ------------------------------------------------- | -------- | --------------------------------- |
| `@robota-sdk/agent-core`                | `packages/agent-core/docs/SPEC.md`                | P0       | 모든 타입 SSOT                    |
| `@robota-sdk/agent-framework`           | `packages/agent-framework/docs/SPEC.md`           | P0       | 런타임 중심                       |
| `@robota-sdk/agent-session`             | `packages/agent-session/docs/SPEC.md`             | P0       | 세션 계약                         |
| `@robota-sdk/agent-transport`           | `packages/agent-transport/docs/SPEC.md`           | P0       | TUI 포함                          |
| `@robota-sdk/agent-cli`                 | `packages/agent-cli/docs/SPEC.md`                 | P0       | 최근 변경 많음                    |
| `@robota-sdk/agent-provider`            | `packages/agent-provider/docs/SPEC.md`            | P1       | createAnthropicProvider 수정 반영 |
| `@robota-sdk/agent-tools`               | `packages/agent-tools/docs/SPEC.md`               | P1       | 빌트인 도구 목록                  |
| `@robota-sdk/agent-command`             | `packages/agent-command/docs/SPEC.md`             | P1       | 커맨드 계약                       |
| `@robota-sdk/agent-plugin`              | `packages/agent-plugin/docs/SPEC.md`              | P1       | 플러그인 계약                     |
| `@robota-sdk/agent-interface-transport` | `packages/agent-interface-transport/docs/SPEC.md` | P1       | 인터페이스 계약                   |
| `@robota-sdk/agent-interface-tui`       | `packages/agent-interface-tui/docs/SPEC.md`       | P1       | TUI 인터페이스                    |
| `@robota-sdk/agent-executor`            | `packages/agent-executor/docs/SPEC.md`            | P2       |                                   |
| `@robota-sdk/agent-subagent-runner`     | `packages/agent-subagent-runner/docs/SPEC.md`     | P2       |                                   |
| `@robota-sdk/agent-team`                | `packages/agent-team/docs/SPEC.md`                | P2       |                                   |
| `@robota-sdk/agent-tool-mcp`            | `packages/agent-tool-mcp/docs/SPEC.md`            | P2       |                                   |
| `@robota-sdk/agent-remote-client`       | `packages/agent-remote-client/docs/SPEC.md`       | P2       |                                   |
| `@robota-sdk/agent-playground`          | `packages/agent-playground/docs/SPEC.md`          | P2       |                                   |
| `@robota-sdk/agent-web-ui`              | `packages/agent-web-ui/docs/SPEC.md`              | P2       |                                   |
| `@robota-sdk/agent-server`              | `apps/agent-server/docs/SPEC.md`                  | P2       |                                   |
| `@robota-sdk/agent-web`                 | `apps/agent-web/docs/SPEC.md`                     | P2       |                                   |
| `robota-blog`                           | `apps/blog/docs/SPEC.md`                          | P3       | 정적 사이트                       |
| `robota-docs`                           | `apps/docs/docs/SPEC.md`                          | P3       | VitePress 문서 사이트             |

### Group B — 신규 SPEC.md 작성 (7개)

각 패키지에 대해 `spec-writing-standard` Mode A (Initial Creation)를 수행한다.
9개 필수 섹션 모두 작성.

| 패키지                       | 신규 경로                             | 우선순위 |
| ---------------------------- | ------------------------------------- | -------- |
| `@robota-sdk/plugin-github`  | `packages/plugin-github/docs/SPEC.md` | P1       |
| `@robota-sdk/plugin-slack`   | `packages/plugin-slack/docs/SPEC.md`  | P1       |
| `@robota-sdk/plugin-linear`  | `packages/plugin-linear/docs/SPEC.md` | P2       |
| `@robota-sdk/plugin-jira`    | `packages/plugin-jira/docs/SPEC.md`   | P2       |
| `@robota-sdk/plugin-notion`  | `packages/plugin-notion/docs/SPEC.md` | P2       |
| `@robota-sdk/action`         | `apps/action/docs/SPEC.md`            | P2       |
| `@robota-sdk/starter-nextjs` | `apps/starter-nextjs/docs/SPEC.md`    | P3       |

---

## 수행 방법 (각 패키지 공통)

### Group A (Drift Recovery)

1. `pnpm harness:review -- --scope <pkg>` 실행하여 drift 단서 수집
2. `packages/<name>/docs/SPEC.md`와 실제 소스를 섹션별 비교
3. gap 목록 작성 (spec 주장 vs 코드 현실)
4. `spec-writing-standard` Mode B (Incremental Update)로 해당 섹션만 수정
5. 일관성 검증: 타입명, export 심볼, 에러 클래스가 실제 소스에 존재하는지 확인

### Group B (Initial Creation)

1. 패키지 소스 읽기 (directory structure, key classes, exports)
2. `spec-writing-standard` Mode A에 따라 9개 필수 섹션 모두 작성
3. `docs/README.md`가 SPEC.md를 참조하는지 확인 (없으면 생성)
4. `pnpm harness:scan:specs` 통과 확인

---

## 실행 전략

- 패키지를 한 번에 하나씩 처리하되 P0 → P1 → P2 → P3 순서를 지킨다
- Group A와 Group B를 우선순위별로 섞어서 처리 가능
- 각 패키지는 별도 커밋으로 처리 ("`docs(spec): <pkg> — live spec catch-up`")
- 모든 패키지가 완료되면 단일 PR로 develop에 병합

---

## Test Plan

- `pnpm harness:scan:specs` 전체 통과
- `pnpm typecheck` 전체 통과 (SPEC은 코드를 바꾸지 않지만 참조 무결성 확인)
- 각 패키지 SPEC: 타입명/export/에러 클래스가 실제 소스에 존재

## User Execution Test Scenarios

SPEC.md는 문서 파일이며 런타임 동작을 변경하지 않는다.
이 백로그는 사용자가 실행하는 CLI/TUI/브라우저 동작에 변화를 주지 않는다.

**User Execution Test Scenarios: 해당 없음 (documentation-only 변경)**

Engineering verification:

- `pnpm harness:scan:specs` — SPEC.md 존재 및 docs/README.md 참조 확인
- `pnpm typecheck` — 전체 타입 무결성 확인
