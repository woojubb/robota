---
title: 'PM-004: robota demo — API 키 없이 즉시 체험 모드'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli
depends_on: [PROD-001]
---

## Background

설치 후 API 키 없이는 아무것도 체험할 수 없다. "설치하면 바로 된다"는 인상이 없으면 바이럴 공유가 불가능하다.

## 작업 항목

- `robota demo` 서브커맨드 추가
- Public Playground 백엔드(PROD-001)에 연결하거나, 없을 경우 mock 스트림 제공
- 제한: 5분 또는 5회 응답으로 세션 제한
- 체험 종료 후 "실제 API 키로 계속하기" 온보딩 안내 출력
- demo 모드에서 수집된 세션은 저장되지 않음 (프라이버시)

## Test Plan

- `robota demo` 실행 후 API 키 없이 응답 수신 확인
- 5회 제한 후 온보딩 안내 출력 확인

## User Execution Test Scenarios

### Scenario 1: 데모 모드 실행

```bash
robota demo
```

Expected: API 키 없이 AI 응답 수신
