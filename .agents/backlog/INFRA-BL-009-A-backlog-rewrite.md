---
title: 'INFRA-BL-009-A: 빌드 도구 마이그레이션 백로그 규칙 준수 구조로 재작성'
status: todo
created: 2026-05-15
priority: high
urgency: soon
area: .agents/tasks/INFRA-BL-009-build-tool-migration.md
depends_on: []
---

## 배경

INFRA-BL-009-synthesis 리뷰 결과, 현재 INFRA-BL-009 태스크 파일이 다음 규칙을 위반한다:

1. `## 검증` 섹션이 빌드/typecheck/lint 통과만 기재 — `backlog-execution.md`가 명시적으로 금지하는 항목을 User Execution Test Scenarios로 오기재
2. `## Prior Art Research` 섹션 없음 — `research.md` §Research-First 위반
3. Recommendation Gate 핵심 항목 누락

이 백로그는 INFRA-BL-009 태스크 파일 자체를 규칙에 맞게 재작성하는 작업이다. INFRA-BL-009가 blocked 상태이므로 실행과 무관하게 즉시 진행 가능하다.

## 변경 범위

파일: `/Users/jungyoun/Documents/dev/robota/.agents/tasks/INFRA-BL-009-build-tool-migration.md`

### 교체/추가할 섹션

1. **`## 검증` → `## Test Plan`으로 교체 및 구체화**
   - 현재 내용은 Test Plan에 속함 (빌드 성공, 유닛 테스트, typecheck)
   - 구체적 검증 커맨드와 범위 추가

2. **`## User Execution Test Scenarios` 신규 추가**
   - 시나리오 1: 단일 패키지 빌드 검증 (agent-executable)
   - 시나리오 2: 전체 빌드 + harness scan (agent-executable)
   - 시나리오 3: npm pack dry-run 계약 검증 (agent-executable)

3. **`## Prior Art Research` 신규 추가**
   - 현재 References 섹션의 tsdown/unbuild 링크를 근거로 정리
   - 조사 완료 항목과 미조사 항목 구분 표기

4. **`## Recommendation Gate` 신규 추가**
   - 7개 필수 항목 기재 (접근법, 의도 일치, 규칙 부합, 영향 패키지, 테스트 계획, UETS, 사용자 결정 항목)

5. **메타데이터 수정**
   - `packages: all (48 packages)` → 실제 패키지 수로 정정
   - blocked 해제 조건 명확화 (택 1 조건 목록)

## Test Plan

- [ ] 재작성 후 `pnpm harness:scan` 통과 확인 (backlog 파일 형식 검증)
- [ ] `## User Execution Test Scenarios` 섹션 존재 확인
- [ ] `## Test Plan` 섹션 존재 확인
- [ ] `## Prior Art Research` 섹션 존재 확인
- [ ] `status: todo` (blocked → todo 유지, 내용만 수정)

## User Execution Test Scenarios

Not applicable — 이 작업은 문서 재작성이며 runnable user-facing behavior를 변경하지 않는다.

검증은 `pnpm harness:scan` (backlog 파일 형식 준수 확인)으로 수행하며, 이는 Test Plan에 해당한다.
