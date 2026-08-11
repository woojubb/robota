---
title: 'CLI-020: 공식 플러그인 README 작성 + 마켓플레이스 문서화'
status: done
created: 2026-05-23
priority: high
urgency: soon
area: packages/plugin-*
depends_on: [PM-012]
---

## Background

PM-005에서 5개 공식 플러그인 패키지(`plugin-github`, `plugin-slack`, `plugin-jira`, `plugin-linear`, `plugin-notion`)가 monorepo에 생성되었다. 그러나 현재 각 패키지의 README가 없거나 비어있다. CLI에서 `/plugin install @robota-sdk/plugin-github`를 실행하려 해도 사용 방법을 알 수 없다.

또한 `/plugin install <name>@<marketplace>` 커맨드가 구현되어 있지만 사용 가능한 마켓플레이스 이름과 URL이 문서 어디에도 없다.

## 작업 항목

- 5개 공식 플러그인 각각에 README.md 작성:
  - 플러그인 기능 1줄 설명
  - 설치 방법 (`/plugin install @robota-sdk/plugin-<name>` 또는 `npm install`)
  - 필요한 환경 변수 (토큰, API 키 등)
  - 사용 예시 (최소 1개 실제 사용 시나리오)
- `content/guide/cli.md` 또는 플러그인 가이드 페이지에 마켓플레이스 섹션 추가:
  - 공식 마켓플레이스 URL 또는 "아직 운영 전" 명시
  - `/plugin marketplace add <url>` 커맨드 사용법 예시
- 마켓플레이스 인프라가 아직 없다면 `/plugin install <name>` (npm 기반)로 안내하는 방식으로 문서 작성

## Test Plan

- 각 공식 플러그인 README에서 설치 → 환경 변수 설정 → 사용 시나리오 end-to-end 확인
- docs 사이트에서 플러그인 설치 방법 탐색 가능 여부 확인

## User Execution Test Scenarios

### Scenario 1: 공식 플러그인 설치 및 사용

```bash
/plugin install @robota-sdk/plugin-github
```

Expected: 설치 완료 후 GitHub 관련 커맨드 또는 툴 사용 가능, README에 있는 예시 동작 확인
