---
title: 오케스트레이션 API MCP 서버
status: backlog
urgency: later
created: 2026-03-15
---

## 요약

오케스트레이션 API를 MCP(Model Context Protocol) 서버로 노출하여 AI 에이전트가 DAG를 제어할 수 있게 함.

## 기능

- DAG CRUD (생성, 조회, 수정, 삭제)
- 노드 추가/제거/연결
- DAG 실행 및 결과 조회
- 비용 추정
- 노드 카탈로그 조회 (object_info)

## 패키지 구조

- `@robota-sdk/dag-mcp-server` 또는 apps/dag-mcp-server
- 오케스트레이션 API를 MCP tool로 래핑
