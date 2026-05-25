---
title: 'PM-005: 공식 플러그인 스타터 팩 5종 개발'
status: done
created: 2026-05-23
priority: high
urgency: later
area: packages/ (신규 패키지)
depends_on: [PM-012]
---

## Background

플러그인 시스템이 설계되어 있지만 공식 플러그인이 없어 생태계가 시작되지 않는다. 커뮤니티 플러그인은 공식 플러그인이 선례를 만들어야 나온다.

## 작업 항목

- 다음 5개 공식 플러그인 개발:
  1. `@robota-sdk/plugin-github` — PR/Issue 정보를 컨텍스트로 주입
  2. `@robota-sdk/plugin-notion` — Notion 페이지 읽기/쓰기
  3. `@robota-sdk/plugin-linear` — Linear 이슈 조회/생성
  4. `@robota-sdk/plugin-jira` — Jira 티켓 조회/생성
  5. `@robota-sdk/plugin-slack` — Slack 채널 메시지 전송
- 각 플러그인에 README + 설치 가이드 + 사용 예제
- `@robota-sdk/plugin-template` starter 레포 공개 (PM-012 연동)

## Test Plan

- 각 플러그인 설치 및 기본 동작 확인
- TypeScript 타입 완전성 확인

## User Execution Test Scenarios

### Scenario 1: GitHub 플러그인 설치

```bash
npm install @robota-sdk/plugin-github
```

Expected: robota에서 GitHub PR 정보를 컨텍스트로 활용 가능
