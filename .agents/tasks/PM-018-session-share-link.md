---
title: 'PM-018: 세션 공유 링크 기능 — robota Cloud 첫 번째 킬러 피처'
status: todo
created: 2026-05-23
priority: low
urgency: later
area: packages/agent-cli, apps/agent-server (robota Cloud)
depends_on: []
---

## Background

완료된 세션(코드 리뷰, 리팩터링 작업 등)을 공개 링크로 공유하면 "이 AI가 내 코드를 이렇게 개선했다"는 자연스러운 바이럴이 발생한다. Notion, Vercel의 공유 기능 성공 사례 참조.

## 작업 항목

- `/session share` 커맨드 추가
- 선택적 공개 링크 생성 (URL: robota.io/s/{id})
- 공유 범위 선택: 전체 공개 / 링크 공유 / 비공개
- 공유 링크에서 표시되는 것: 메시지 목록, 코드 변경 내역 (diff)
- 표시되지 않는 것: API 키, 파일 전체 경로 (개인정보)
- 만료 기간: 30일 (무료), 무제한 (Pro)
- robota Cloud 백엔드 필요

## Test Plan

- `/session share` 후 공개 링크 생성 확인
- 링크에서 세션 내용 표시 확인
- 민감 정보 미노출 확인

## User Execution Test Scenarios

Not applicable — Cloud feature.
