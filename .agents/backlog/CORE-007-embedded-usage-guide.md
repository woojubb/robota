---
title: 'CORE-007: 임베디드 사용 가이드 문서 — agent-framework 통합 레시피'
status: todo
created: 2026-05-25
priority: high
urgency: soon
area: content/guides/, packages/agent-framework/docs/
depends_on: [CORE-002, CORE-003, CORE-004]
---

## Background

`agent-framework`를 CLI 외의 환경(서버, 봇, 서버리스)에 임베딩하는 방법이
문서화되어 있지 않다. 개발자들이 다음 질문에 답을 찾지 못한다:

- "서버에 임베딩할 때 `bare: true`가 필요한가?"
- "세션을 어떻게 재사용하나? 요청마다 새로 만드나?"
- "세션 정리를 어떻게 하나? 메모리 누수는 없나?"
- "서버리스에서도 동작하나?"
- "커스텀 도구를 어떻게 추가하나?"

## 목표

`content/guides/embedding-agent-framework.md` 작성:

### 문서 구조

1. **개요** — CLI 모드 vs 임베디드 모드 차이
2. **세션 수명 주기** — 언제 생성/재사용/폐기하나
3. **패턴별 레시피**
   - HTTP SSE (Next.js, Express)
   - WebSocket 서버
   - Slack/Discord 봇 (세션 재사용, 재개)
   - CI/CD 스크립트 (stateless)
   - 배치 처리 (병렬)
4. **상태없는 모드** — `createStatelessRuntime` 사용법
5. **커스텀 도구 추가** (CORE-002 완료 후)
6. **세션 재개** (CORE-003 완료 후)
7. **에러 처리** — rate limit, context overflow, 네트워크 오류
8. **자원 정리** — `session.shutdown()` 호출 시점

### API 레퍼런스 정리

- `createAgentRuntime` vs `createStatelessRuntime` vs `createQuery` vs `Robota`
- 각 API의 적합한 사용 시나리오 비교 표

## Test Plan

- 가이드의 코드 예제가 실제 동작하는지 확인
- `examples/` 디렉터리 예제들과 일관성 확인

## User Execution Test Scenarios

N/A — 문서 작업. 완료 기준은 가이드 파일 생성 + 코드 예제 동작 확인.
