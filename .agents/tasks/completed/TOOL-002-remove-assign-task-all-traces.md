---
title: 'TOOL-002: assignTask 완전 제거 — 코드·문서·테스트 모든 흔적 삭제'
status: done
done_at: 2026-05-31
created: 2026-05-20
priority: high
urgency: soon
area: packages/agent-team, packages/agent-core, packages/agent-playground, content/, .agents/
depends_on: []
---

## Background

`assignTask`는 PLG-019에서 `agent-playground`의 Tools 패널에서 제거됐으나,
`packages/agent-team` 내부에 구현 코드·테스트·예제가 여전히 남아 있으며,
`packages/agent-core`, 문서, 아키텍처 문서에도 참조가 남아 있다.

미배포 프로젝트이므로 하위 호환성 없이 완전 삭제한다.

## 제거 대상 전체 목록

### packages/agent-team (구현 코드)

| 경로                                        | 조치                                    |
| ------------------------------------------- | --------------------------------------- |
| `src/assign-task/relay-assign-task.ts`      | 파일 삭제                               |
| `src/assign-task/relay-assign-task.test.ts` | 파일 삭제                               |
| `src/assign-task/` 디렉터리                 | 디렉터리 삭제                           |
| `src/index.ts`                              | `createAssignTaskRelayTool` export 제거 |
| `examples/assign-task-basic.ts`             | 파일 삭제                               |
| `examples/assign-task-categorized.ts`       | 파일 삭제                               |
| `examples/README.md`                        | assignTask 예제 항목 제거               |
| `examples/package.json`                     | assignTask 관련 항목 제거               |
| `docs/SPEC.md`                              | assignTask 관련 내용 제거               |
| `CHANGELOG.md`                              | 언급 유지 (히스토리 보존)               |

### packages/agent-core (실행 프록시)

| 경로                                    | 조치                                           |
| --------------------------------------- | ---------------------------------------------- |
| `src/utils/execution-proxy.ts` line ~87 | `configureMethod('assignTask', ...)` 블록 제거 |

### packages/agent-playground (이미 PLG-019에서 제거됨 — 확인만)

- `src/tools/catalog.ts` — ASSIGN_TASK_META 없음 ✅
- `src/lib/code-generator/tool-import-registry.ts` — assignTask 없음 ✅
- `src/lib/playground/block-tracking/block-hooks/index.ts` — assignTask 없음 ✅

### 문서 (.agents/, content/)

| 경로                                           | 조치                                               |
| ---------------------------------------------- | -------------------------------------------------- |
| `.agents/project-structure.md`                 | assignTask 관련 참조 제거                          |
| `.agents/specs/architecture-map/agent-team.md` | assignTask 관련 내용 제거                          |
| `.agents/reports/arch-review-planner.md`       | 참조 제거                                          |
| `content/api-reference/agent-team/README.md`   | assignTask API 문서 제거                           |
| `content/v2.0.0/**` 다수                       | v2.0.0 문서는 **보존 대상** — 삭제 금지, 변경 금지 |

### apps/agent-web/public (정적 JSON 데이터)

| 경로                                           | 조치                           |
| ---------------------------------------------- | ------------------------------ |
| `public/perfect-playground-data.json`          | assignTask 노드/엣지 항목 제거 |
| `public/playground-workflow.json`              | assignTask 항목 제거           |
| `public/real-workflow-data.json`               | assignTask 항목 제거           |
| `public/real-workflow-data-backup-*.json`      | assignTask 항목 제거           |
| `public/perfect-playground-data-backup-*.json` | assignTask 항목 제거           |

## Non-Goals

- `content/v2.0.0/` 내용 수정 — 영구 보존 대상, 절대 수정 금지
- `CHANGELOG.md` 히스토리 항목 삭제 — 이력이므로 유지
- `@robota-sdk/agent-team` 패키지 자체 삭제 — 이번 범위 아님

## Test Plan

- `pnpm build` 전체 빌드 통과
- `pnpm typecheck` 오류 없음
- `pnpm test` 전체 테스트 통과
- `grep -r "assignTask\|assign_task\|AssignTask\|assign-task" packages/ apps/ .agents/` 에서
  `CHANGELOG.md`, `content/v2.0.0/` 제외하고 결과 없음

## User Execution Test Scenarios

### Scenario 1: 코드베이스에 assignTask 흔적 없음

**Steps**:

```bash
grep -r "assignTask\|assign_task\|AssignTask\|assign-task" \
  packages/ apps/ .agents/ content/api-reference/ \
  --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" \
  | grep -v "node_modules" | grep -v "dist" | grep -v "CHANGELOG"
```

**Expected**: 출력 없음 (0 matches)

### Scenario 2: 빌드 및 테스트 통과

**Steps**:

```bash
pnpm build && pnpm typecheck && pnpm test
```

**Expected**: 모두 통과
</content>
</invoke>
