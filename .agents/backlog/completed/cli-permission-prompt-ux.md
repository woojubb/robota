# CLI Permission Prompt UX 근본 개선

## 현재 상태

agent-cli의 permission 시스템 구조는 완성됨:

- `permission-gate.ts`: 3단계 평가 로직 (deny → allow → mode policy) — 40개 테스트 통과
- `permission-mode.ts`: 4개 모드 × 6개 tool 정책 매트릭스
- `permission-prompt.ts`: 사용자 승인 프롬프트
- `session.ts`: `wrapToolWithPermission()`으로 tool 실행 전 권한 체크

## 미해결 문제

### 1. Permission prompt와 REPL readline 충돌

- REPL의 `readline.createInterface`가 stdin을 점유
- Permission prompt에서 별도 readline을 생성해도 stdin 경합 발생
- 방향키 입력 시 REPL history가 탐색되거나 escape sequence가 깨짐
- raw mode 방식: ANSI escape 커서 제어가 readline과 충돌하여 화면 깨짐
- 임시 readline 방식: pause/resume이 불안정하여 입력이 씹히거나 중복 처리

### 2. Tool 실행 결과 누락 (400 에러)

- Anthropic API: "tool_use ids without tool_result blocks"
- 원인 추정: `executeRound()`에서 assistant 메시지(tool_use 포함)가 히스토리에 먼저 추가된 후 tool 실행 중 에러 발생 시 tool_result가 누락
- `wrapToolWithPermission`에 try/catch + `success: true` 반환으로 대응했으나 완전 해결 안 됨
- agent-core의 execution loop 자체에 tool_result 보장 메커니즘이 필요할 수 있음

### 3. 응답 스트림 조기 종료

- 모델이 text + tool_use를 동시에 반환할 때 처리 문제
- `convertFromAnthropicResponse`를 모든 content block 순회하도록 수정했으나 추가 검증 필요
- 모델이 "이제 파일을 읽겠습니다"라고 답한 뒤 실제 tool 호출 없이 종료되는 현상

## 시도한 접근들

| 접근                                                 | 결과                                         |
| ---------------------------------------------------- | -------------------------------------------- |
| REPL readline의 `rl.question()` 사용                 | 방향키가 REPL history 탐색                   |
| 별도 readline (`historySize: 0`) + REPL pause/resume | stdin 경합, 입력 씹힘                        |
| Raw mode + ANSI escape 커서 제어 (multi-line)        | readline과 충돌, 화면 깨짐                   |
| Raw mode + `\r` single-line 덮어쓰기                 | 여전히 readline과 충돌                       |
| Raw mode + 100ms debounce                            | 버퍼된 Enter 문제 부분 해결, 근본 해결 안 됨 |
| 숫자/문자 입력 방식 (raw mode 없이)                  | 동작하나 방향키 UX 불가                      |

## 근본 해결 방향 제안

### 방향 A: REPL 아키텍처 변경

- readline 기반 REPL 대신 raw mode 기반 REPL로 전환
- 모든 입력을 raw mode에서 직접 처리 (readline 사용 안 함)
- 장점: stdin 경합 없음, 자유로운 UI 제어
- 단점: readline의 line editing, history, completion을 직접 구현해야 함

### 방향 B: agent-core에 beforeToolCall 훅 추가

- Robota의 execution loop에 `beforeToolCall` 훅 추가
- tool.execute()를 감싸는 대신, execution service 레벨에서 권한 체크
- tool_result 누락 문제를 execution loop이 보장

### 방향 C: 외부 라이브러리 도입

- `@inquirer/prompts`, `@clack/prompts` 등 검증된 interactive prompt 라이브러리
- readline과의 공존이 이미 해결된 라이브러리 사용
- stdin 관리를 라이브러리에 위임

## 현재 동작하는 것

- Permission mode 평가 로직 (permission-gate) — 완벽 동작
- `/mode` 슬래시 커맨드로 모드 전환
- `--permission-mode` CLI 플래그
- 설정 파일의 allow/deny 패턴 매칭
- 숫자/문자 입력 기반 프롬프트 (방향키 UX 제외)

## 관련 파일

- `packages/agent-cli/src/session.ts` — wrapToolWithPermission
- `packages/agent-cli/src/permissions/` — gate, mode, prompt
- `packages/agent-cli/src/repl/repl-renderer.ts` — select(), prompt()
- `packages/agent-cli/src/repl/repl-session.ts` — REPL loop
- `packages/agent-provider-anthropic/src/provider.ts` — convertFromAnthropicResponse
- `packages/agent-core/src/services/execution-round.ts` — executeAndRecordToolCalls
