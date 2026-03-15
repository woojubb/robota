---
title: 오케스트레이션 CLI 도구
status: backlog
created: 2026-03-15
---

## 요약

오케스트레이션 API를 CLI로 제어할 수 있는 커맨드라인 도구.

## 기능

- `robota dag list` — DAG 목록 조회
- `robota dag create` — DAG 생성
- `robota dag run <dagId>` — DAG 실행
- `robota dag status <runId>` — 실행 상태 확인
- `robota dag publish <dagId>` — DAG 발행
- `robota nodes list` — 노드 카탈로그 조회
- `robota cost estimate <dagId>` — 비용 추정

## 패키지 구조

- `@robota-sdk/cli` 또는 apps/cli
- 오케스트레이션 API 클라이언트 재사용 (dag-designer의 designer-api-client 참고)
