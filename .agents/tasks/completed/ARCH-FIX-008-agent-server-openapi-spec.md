---
title: 'ARCH-FIX-008: agent-server 외부 HTTP API OpenAPI 스펙 파일 추가'
status: done
created: 2026-05-10
priority: high
urgency: soon
area: api
related: [V-CON-002, SRV-001]
---

## Problem

`agent-server`는 외부 클라이언트가 소비하는 HTTP API를 노출하지만 `api-boundary.md` 규칙이 요구하는 OpenAPI 스펙 파일이 없다.

`api-boundary.md` 규칙: "External-facing HTTP APIs must have a machine-readable API spec (OpenAPI 3.x) committed alongside the server source."

스펙 파일 없이는 API 계약이 코드에만 존재하고, 클라이언트(예: `agent-remote-client`)가 타입 안전하게 소비할 수 없다.

## Solution

1. `agent-server`의 현재 HTTP 엔드포인트 전체 목록을 조사한다.
2. `apps/agent-server/openapi.yaml` (또는 `.json`)에 OpenAPI 3.x 스펙을 작성한다.
3. 스펙을 `agent-server/docs/SPEC.md`에 링크한다.
4. `cross-cutting-contracts.md`의 HTTP API 계약 행을 스펙 파일 경로로 업데이트한다.
5. 선택적으로 스펙에서 타입을 자동 생성하는 스크립트를 추가한다.

## Test Plan

- `apps/agent-server/openapi.yaml` (또는 `.json`) 파일 존재 확인
- OpenAPI 유효성 검사 통과 (예: `npx @redocly/cli lint openapi.yaml`)
- 스펙에 정의된 모든 엔드포인트가 실제 라우터에 존재하는지 수동 대조
- `agent-server/docs/SPEC.md`에 스펙 파일 링크 존재 확인

## User Execution Test Scenarios

Not applicable — API specification file is a documentation artifact. No runnable user-facing CLI behavior change.

## Verification Evidence

(완료 후 openapi.yaml 경로 및 유효성 검사 결과 기록)
