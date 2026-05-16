---
title: 'INFRA-BL-009-F: 전체 마이그레이션 설계 — 단계별 계획 문서 및 패키지 분류'
status: todo
created: 2026-05-15
priority: low
urgency: later
area: .design/build-tool-migration-design.md, all packages
depends_on:
  - INFRA-BL-009-D
  - INFRA-BL-009-E
blocked-by: INFRA-BL-009-D 또는 INFRA-BL-009-E 중 하나 PoC 성공 전
---

## 배경

INFRA-BL-009-D/E PoC에서 도구가 선정된 후, 57개 패키지 전체 마이그레이션을 위한 설계 문서를 작성한다. `spec-workflow.md` §Document Authority에 따라 계약 결정은 `.design/` 문서로 승격해야 한다.

## 결과물

### 1. `.design/build-tool-migration-design.md` 작성

포함 내용:

- 선정 도구 및 Decision Matrix 기반 근거
- 패키지 유형 분류 (아래 참조)
- 단계별 마이그레이션 계획 (5단계)
- 각 단계의 검증 게이트
- 롤백 절차
- 마이그레이션 후 갱신할 문서 목록

### 2. 패키지 유형 분류

전체 패키지를 아래 4가지 유형으로 분류한다:

| 유형                | 특징                     | 대표 패키지                      | 마이그레이션 복잡도 |
| ------------------- | ------------------------ | -------------------------------- | ------------------- |
| A: node-only simple | ESM+CJS, 단일 entry      | auth, credits, agent-sessions    | 낮음                |
| B: browser dual     | node + browser 분리 빌드 | agent-core, agent-web            | 높음                |
| C: bin entry        | CLI 실행 파일 포함       | agent-cli                        | 높음                |
| D: react/jsx        | JSX transform 필요       | agent-playground, apps/agent-web | 중간                |

### 3. 5단계 마이그레이션 계획

```
Phase 0 (현재): blocked → 도구 선정 완료 (INFRA-BL-009-D/E 후)
Phase 1: 유형 A 전체 (node-only simple 패키지)
Phase 2: 유형 B 전체 (browser dual 패키지)
Phase 3: 유형 C 전체 (bin entry 패키지)
Phase 4: 유형 D 전체 (react/jsx 패키지)
Phase 5: apps/ 패키지 (빌드 구조 다름)
```

각 Phase는 독립 PR이며, 이전 Phase의 `pnpm harness:scan` 통과가 선행 조건이다.

### 4. 롤백 절차

```bash
# 단계별 롤백 (tsup.config.ts.bak → tsup.config.ts 복원)
# 롤백 스크립트: scripts/rollback-build-tool.mjs
```

### 5. 마이그레이션 후 갱신 문서 목록

- `.agents/tasks/INFRA-BL-009-build-tool-migration.md`: status done으로 종결
- `.agents/project-structure.md`: 빌드 도구 관련 언급 갱신 (해당 시)
- 각 패키지 `tsup.config.ts`: 신규 config 파일로 교체
- `scripts/build-types-ordered.mjs`: 신규 도구의 DTS-only 커맨드로 업데이트

## Test Plan

- [ ] `.design/build-tool-migration-design.md` 작성 완료
- [ ] 패키지 유형 분류표 작성 (전체 57개 패키지 분류)
- [ ] 단계별 체크리스트 작성
- [ ] `pnpm harness:scan` 통과 (문서 형식 준수)

## User Execution Test Scenarios

Not applicable — 설계 문서 작성이며 runnable user-facing behavior를 변경하지 않는다.
