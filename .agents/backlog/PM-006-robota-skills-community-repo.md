---
title: 'PM-006: robota-skills 공개 커뮤니티 레포 — 스킬 컬렉션 20개 초기 공개'
status: todo
created: 2026-05-23
priority: high
urgency: later
area: GitHub (신규 레포)
depends_on: []
---

## Background

스킬 시스템은 마크다운 파일로 구성되어 비개발자도 기여할 수 있는 가장 낮은 진입 장벽의 오픈소스 참여 경로다. 공식 스킬 컬렉션이 없어 커뮤니티 기여가 시작되지 않는다.

## 작업 항목

- `github.com/robota-sdk/skills` 공개 레포 생성
- 카테고리별 초기 스킬 20개 작성:
  - 코드 리뷰: `code-review`, `security-review`, `performance-review`
  - 문서 작성: `jsdoc-generator`, `readme-writer`, `api-docs`
  - 테스트: `unit-test-generator`, `e2e-test-writer`
  - 리팩터링: `dead-code-remover`, `type-safety-audit`
  - Git: `commit-message`, `pr-description`, `changelog-entry`
  - 기타: `explain-code`, `translate-comments`, `add-error-handling`
- 기여 가이드 (CONTRIBUTING.md) + PR 템플릿
- robota.io에 스킬 디렉토리 페이지 연결

## Test Plan

- 레포 접근 및 스킬 설치 확인
- `/skills install <name>` 동작 확인

## User Execution Test Scenarios

### Scenario 1: 커뮤니티 스킬 설치

```
/skills install code-review
/code-review
```

Expected: PR 코드 리뷰 스킬 동작
