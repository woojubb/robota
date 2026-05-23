---
title: 'CLI-012: --dry-run 플래그 — plan 모드 기반 작업 계획 미리보기'
status: done
created: 2026-05-23
priority: medium
urgency: later
area: packages/agent-cli
depends_on: []
---

## Background

고위험 작업(대규모 리팩터링 등) 전 에이전트가 무엇을 할지 미리 보고 싶다. 현재 `plan` 권한 모드가 있지만 단일 프롬프트 실행에 적용하는 방법이 직관적이지 않다.

## 작업 항목

- `robota --dry-run "작업 내용"` 플래그 추가
- `plan` 권한 모드를 내부적으로 활성화하여 파일 수정 없이 계획만 출력
- 출력 포맷:

  ```
  계획:
    1. src/ 디렉토리의 .ts 파일 검색 (Glob)
    2. 각 파일에서 console.log 패턴 검색 (Grep)
    3. 12개 파일, 47개 라인 수정 예정 (Edit)

  실행하려면: robota "src/에 있는 모든 console.log를 제거해줘"
  ```

- TUI 세션 내: `/dryrun <프롬프트>` 슬래시 커맨드로도 지원

## Test Plan

- `--dry-run` 플래그로 실행 시 파일 수정 없음 확인
- 계획 출력 포맷 확인

## User Execution Test Scenarios

### Scenario 1: dry-run 계획 미리보기

```bash
robota --dry-run "src/ 폴더의 모든 console.log 제거"
```

Expected: 실행 계획만 출력, 실제 파일 변경 없음
