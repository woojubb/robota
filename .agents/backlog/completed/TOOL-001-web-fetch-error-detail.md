---
title: 'TOOL-001: WebFetch 도구 오류 메시지 구체화 — LLM이 실패 원인을 정확히 파악하게 개선'
status: done
created: 2026-05-19
completed: 2026-05-19
priority: high
urgency: soon
area: packages/agent-tools
depends_on: []
---

## Background

세션 로그 분석 결과(`session_1779196260763_jja70p6ky.jsonl`), `WebFetch`가
`{"success": false, "output": "", "error": "fetch failed"}` 를 반환하자
모델(gpt-4o-mini)이 **완전히 동일한 URL을 12라운드(24회)** 재시도한 뒤에야 포기했다.

오류 메시지가 `"fetch failed"` 한 마디뿐이라 LLM은 실패 원인을 판단하지 못한다.
네트워크 연결 불가인지, DNS 해석 실패인지, 타임아웃인지, HTTP 오류인지 알 수 없으므로
모델은 "일시적 오류"로 간주하고 동일 URL로 재시도를 반복한다.

현재 코드 위치: `packages/agent-tools/src/builtins/web-fetch-tool.ts`

```typescript
// 현재 — 정보 없음
const result: TToolResult = { success: false, output: '', error: message };
```

## Goals

1. 오류 유형을 LLM이 해석할 수 있는 수준으로 분류해 반환한다.
2. 재시도가 무의미한 오류(네트워크 단절, DNS 실패)는 모델이 즉시 포기할 수 있도록
   명확한 메시지를 전달한다.
3. HTTP 상태 코드와 같이 이미 구조화된 정보는 그대로 노출한다.

## Non-Goals

- WebFetch 내부에 재시도 로직 추가
- maxTurns / maxExecutionRounds 제한 설정 (별도 백로그로 분리)
- CORS 우회 또는 프록시 지원

## Design

### 오류 분류 및 메시지 예시

| 상황                                            | 기존                           | 개선 후                                                                                                                           |
| ----------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 네트워크 연결 불가 (ECONNREFUSED, ENOTFOUND 등) | `fetch failed`                 | `Network error: Unable to reach host. The server may be unreachable or the URL may be incorrect. Do not retry with the same URL.` |
| 타임아웃 (AbortError)                           | `fetch failed`                 | `Request timed out after 30s. The server did not respond in time.`                                                                |
| HTTP 4xx (클라이언트 오류)                      | `HTTP 404 Not Found`           | `HTTP 404 Not Found. The requested resource does not exist at this URL. Do not retry.`                                            |
| HTTP 5xx (서버 오류)                            | `HTTP 503 Service Unavailable` | `HTTP 503 Service Unavailable. The server is temporarily unavailable. Retrying may help.`                                         |
| URL 파싱 실패                                   | `Invalid URL: ...`             | `Invalid URL: "<url>". Fix the URL format before retrying.`                                                                       |
| 응답 크기 초과                                  | `Response too large: ...`      | `Response too large (N bytes, max 5MB). Consider fetching a more specific URL.`                                                   |

### 구현 방향

`runWebFetch` 내부의 각 catch / 오류 분기에서 Node.js 오류 코드(`err.code`)를 확인해
오류 유형을 분류한다.

```typescript
function classifyFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  // AbortError = 타임아웃
  if (err.name === 'AbortError') {
    return `Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s. The server did not respond in time.`;
  }

  // Node.js 네트워크 오류 코드
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `Network error: DNS resolution failed for this host. The URL may be incorrect or the host does not exist. Do not retry with the same URL.`;
  }
  if (code === 'ECONNREFUSED') {
    return `Network error: Connection refused. The server is not accepting connections. Do not retry with the same URL.`;
  }
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT') {
    return `Network error: Connection was reset or timed out. The server may be temporarily unavailable.`;
  }

  // 그 외 fetch 오류
  return `Network error: ${err.message}. Check that the URL is correct and the server is reachable.`;
}
```

HTTP 상태 코드 분기도 재시도 가이드를 포함하도록 개선:

```typescript
if (!response.ok) {
  const retryHint =
    response.status >= 500 ? ' Retrying may help.' : ' Do not retry with the same URL.';
  return JSON.stringify({
    success: false,
    output: '',
    error: `HTTP ${response.status} ${response.statusText}.${retryHint}`,
  });
}
```

## Test Plan

- 단위 테스트 (`packages/agent-tools/src/__tests__/`):
  - `ENOTFOUND` 오류 → "DNS resolution failed" 메시지 포함 확인
  - `AbortError` → "timed out" 메시지 포함 확인
  - HTTP 404 → "Do not retry" 힌트 포함 확인
  - HTTP 503 → "Retrying may help" 힌트 포함 확인
  - 기존 성공 경로 회귀 없음
- `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

### Scenario 1: 도달 불가 URL — 모델이 재시도하지 않음

**Prerequisites**: agent-server 실행 중, Anthropic API 키 설정

**Steps**:

1. Playground(`http://localhost:7071/playground`) 접속
2. 에이전트 생성 (claude-sonnet 계열 모델)
3. 채팅 입력:
   ```
   WebFetch로 http://this-host-does-not-exist.invalid/data 를 가져와줘
   ```
4. 모델 응답 및 Workflow DAG 확인

**Expected observable result**:

- Workflow DAG에 `WebFetch` 노드가 **1개** (재시도 없음)
- 모델 응답에 "도달할 수 없음" 또는 "URL을 확인하세요" 등 구체적 오류 안내 포함
- 동일 URL 재호출 없이 즉시 포기

**Evidence** (2026-05-19):

- Workflow DAG: `New Agent → User Message → WebFetch (1개) → Tool Result → Assistant Response`
- WebFetch 노드 **1개만** 생성됨 (재시도 없음)
- 반환된 오류: `"Network error: DNS resolution failed for this host. The URL may be incorrect or the host does not exist. Do not retry with the same URL."`
- 모델 응답: "요청하신 URL('http://this-host-does-not-exist.invalid/data')에 접근할 수 없습니다. 해당 호스트가 존재하지 않거나 서버에 문제가 있을 수 있습니다. 다른 URL을 제공해 주시면 다시 시도하겠습니다."
- 스크린샷: `.playwright-mcp/page-2026-05-19T13-49-44-024Z.png`
- ✅ PASS — 동일 URL 재호출 없이 즉시 포기

### Scenario 2: HTTP 404 — 모델이 재시도하지 않음

**Prerequisites**: 위와 동일

**Steps**:

1. 채팅 입력:
   ```
   WebFetch로 https://httpbin.org/status/404 를 가져와줘
   ```
2. 모델 응답 확인

**Expected observable result**:

- Workflow DAG에 `WebFetch` 노드 **1개**
- 모델이 "404 Not Found, 해당 리소스가 존재하지 않습니다" 수준의 응답 반환

**Evidence**: `<스크린샷 — 구현 후 기입>`
