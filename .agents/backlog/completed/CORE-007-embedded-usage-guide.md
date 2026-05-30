---
title: 'CORE-007: 임베디드 사용 가이드 — agent-framework 통합 패턴 문서'
status: done
created: 2026-05-25
completed: 2026-05-31
priority: high
urgency: soon
area: content/guide/
depends_on: [CORE-002, CORE-003, CORE-004]
---

## Background

`agent-framework`를 CLI 외부(서버, 봇, 서버리스)에 임베딩하는 방법이 문서화되지 않아
개발자들이 다음 질문에 막힌다:

- "`createAgentRuntime` vs `createStatelessRuntime` vs `createQuery` vs `Robota` — 언제 뭘?
- `bare: true`가 필요한가? 언제?
- 세션을 요청마다 새로 만드나, 재사용하나?
- Slack처럼 이전 대화를 이어야 하면?
- 파일시스템이 없는 환경(Lambda, Edge)에서 동작하나?

## 목표

`content/guides/embedding-agent-framework.md` 작성.

### 문서 구조

#### 1. API 선택 가이드 (한 눈에 비교)

| 상황                          | 권장 API                                                | 이유             |
| ----------------------------- | ------------------------------------------------------- | ---------------- |
| 단발성 쿼리 (CI 스크립트)     | `createQuery`                                           | 가장 단순        |
| 커스텀 도구 + 단발            | `Robota.run()`                                          | 도구 지원        |
| 스트리밍 서버 (SSE/WebSocket) | `createAgentRuntime.createSession()`                    | 이벤트 시스템    |
| 커스텀 도구 + 스트리밍        | `createAgentRuntime.createSession({ additionalTools })` | CORE-002 완료 후 |
| 서버리스/파일시스템 없음      | `createStatelessRuntime()`                              | CORE-004 완료 후 |
| 봇 대화 재개                  | `createSession({ resumeSessionId })`                    | CORE-003 완료 후 |

#### 2. 세션 수명 주기

- 언제 생성: 연결 시작, 봇 대화 시작
- 언제 재사용: 같은 사용자의 연속 메시지
- 언제 폐기: 연결 종료, 타임아웃, `session.shutdown()` 호출
- 메모리: 장기 서버에서 세션 객체 크기 고려 (히스토리 무제한 축적 방지)

#### 3. 레이어별 책임 (임베더를 위한 요약)

```
createFunctionTool()         → @robota-sdk/agent-tools
Robota()                     → @robota-sdk/agent-core (낮은 수준, 도구 가능, 이벤트 없음)
createAgentRuntime/Session   → @robota-sdk/agent-framework (이벤트, 세션, 권한)
createQuery()                → @robota-sdk/agent-framework (편의 래퍼, 단발 쿼리)
```

#### 4. 패턴별 레시피

- HTTP SSE (Next.js App Router)
- WebSocket 서버
- Slack/Discord 봇 (`resumeSessionId` 패턴)
- CI/CD 스크립트 (`createQuery`)
- 배치 처리 (`Promise.all` + `createQuery`)
- 서버리스 (`createStatelessRuntime`)

#### 5. 에러 처리

- Rate limit (429): provider retry 설정
- Context overflow: auto-compact 동작 확인
- 세션 폐기 후 submit: 에러 동작 정의

#### 6. 자원 정리

- `session.shutdown()`: 언제 반드시 호출해야 하는가
- GC 의존 vs 명시적 정리

## Test Plan

문서 내 코드 예제가 실제 동작하는지 확인.
CORE-002, CORE-003, CORE-004 완료 후 작성.
