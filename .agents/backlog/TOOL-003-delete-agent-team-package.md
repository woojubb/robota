---
title: 'TOOL-003: @robota-sdk/agent-team 패키지 완전 삭제'
status: todo
created: 2026-05-25
priority: high
urgency: soon
area: packages/agent-team, packages/*, apps/*, pnpm-lock.yaml, .agents/
depends_on: [TOOL-002]
---

## Background

`@robota-sdk/agent-team` 패키지는 현재 내보내는 심볼이 없는 placeholder 상태다.
`assignTask` relay tool이 제거(PLG-019, TOOL-002)된 이후 실질적인 기능이 없으며,
미배포 프로젝트이므로 외부 소비자도 없다.

패키지를 유지하면 빌드·typecheck·publish 대상에 포함돼 유지 비용이 발생하고,
monorepo 구조를 오염시킨다.

## 삭제 대상

### 패키지 디렉터리 전체

- `packages/agent-team/` — 디렉터리 전체 삭제

### 의존 관계 제거

현재 `@robota-sdk/agent-team`을 의존하는 패키지 확인 후 제거:

```bash
grep -r "agent-team" packages/ apps/ --include="package.json" | grep -v "agent-team/package.json" | grep -v node_modules
```

### 문서·아키텍처 맵 정리

| 경로                                                 | 조치                                                    |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `.agents/project-structure.md`                       | `agent-team/` 항목 제거                                 |
| `.agents/specs/architecture-map/agent-team.md`       | 파일 삭제                                               |
| `.agents/specs/architecture-map/agent-system.md`     | agent-team 관련 항목 정리                               |
| `.agents/specs/architecture-map/ARCHITECTURE-MAP.md` | agent-team 링크 제거                                    |
| `content/api-reference/agent-team/`                  | 디렉터리 삭제                                           |
| `content/` 내 agent-team 참조                        | 관련 내용 제거 (v2.0.0/ 제외)                           |
| `.agents/backlog/TOOL-002-*.md`                      | agent-team 관련 내용이 포함되므로 이 백로그로 통합 처리 |
| `.agents/reports/arch-review-planner.md`             | assignTask/agent-team 참조 제거                         |

### pnpm-lock.yaml

- `pnpm install` 후 lockfile 업데이트

## Non-Goals

- `content/v2.0.0/` 내용 수정 — 영구 보존 대상
- CHANGELOG.md 히스토리 항목 삭제
- 새 multi-agent 기능 구현 — 별도 백로그에서 신규 패키지로 설계

## Test Plan

1. `pnpm build` 전체 빌드 통과
2. `pnpm typecheck` 오류 없음
3. `pnpm test` 전체 테스트 통과
4. `grep -r "agent-team" packages/ apps/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v dist` 결과 없음
5. `grep -r "agent-team" packages/ apps/ --include="package.json" | grep -v node_modules` 결과 없음

## User Execution Test Scenarios

### Scenario 1: agent-team 패키지가 빌드 대상에서 제외됨

**Steps:**

```bash
pnpm build 2>&1 | grep -i "agent-team"
```

**Expected:** 출력 없음 (agent-team이 빌드 대상에 없음)

### Scenario 2: 전체 빌드·typecheck·테스트 통과

**Steps:**

```bash
pnpm build && pnpm typecheck && pnpm test
```

**Expected:** 모두 통과, agent-team 관련 오류 없음
