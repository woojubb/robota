---
title: 'PM-010: Changelog 공개 페이지 (robota.io/changelog)'
status: done
created: 2026-05-23
priority: medium
urgency: later
area: apps/docs
depends_on: []
---

## Background

v3.0.0-beta.67이지만 변경 이력이 공개적으로 보이지 않는다. "살아있는 프로젝트인가"를 판단하는 가장 빠른 신호가 없어 신뢰 신호가 부재하다.

## 작업 항목

- `robota.io/changelog` 페이지 생성
- GitHub Releases와 연동하여 자동 생성
- 기술 용어 대신 사용자 관점 변경사항 중심으로 작성
  - 기존: "refactor PlaygroundExecutor executionToken pattern"
  - 개선: "채팅 초기화 후 DAG가 즉시 리셋되도록 수정"
- 주요 변경사항에 스크린샷/GIF 포함
- RSS 피드 제공

## Test Plan

- 페이지 접근 (robota.io/changelog) 확인
- GitHub Release 연동 확인

## User Execution Test Scenarios

Not applicable — documentation page.
