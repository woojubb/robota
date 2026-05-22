---
title: 'UX-011: API 오류 메시지 사용자 친화적 변환 (error message humanization)'
status: todo
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-cli, packages/agent-framework
depends_on: []
---

## Background

API 오류 발생 시 `Error: 401 Unauthorized — invalid x-api-key` 같은 기술 용어가 그대로 출력된다. 신규 사용자가 해결 방법을 알 수 없어 이탈한다.

## 작업 항목

- HTTP 상태 코드별 사용자 친화적 메시지 매핑 테이블 작성 (401, 403, 429, 500, 503)
- 각 메시지에 해결 방법과 설정 명령어 포함
- 401: "API 키가 유효하지 않습니다. ~/.robota/settings.json 확인 또는 /provider 로 재설정"
- 429: "요청 한도를 초과했습니다. 잠시 후 다시 시도하세요."
- 503: "AI 공급자 서버가 일시적으로 사용 불가합니다."
- 스택 트레이스는 `--debug` 플래그 없이는 숨김 처리

## Test Plan

- 각 HTTP 오류 코드별 메시지 출력 확인
- 해결 방법 링크/명령어 정확성 확인

## User Execution Test Scenarios

Not applicable — error UX change.
