---
title: 'PLG-F-004: 커맨드 인터페이스 — 슬래시 커맨드 지원'
status: done
created: 2026-05-19
priority: medium
urgency: soon
area: packages/agent-playground
depends_on: [PLG-F-002, PLG-F-003]
---

## Background

`InteractiveSession`은 `/skills`, `/summarize`, `/compact` 같은 슬래시 커맨드를 지원한다.
현재 Playground 채팅창은 일반 메시지만 전송하며 커맨드를 인식하지 않는다.

agent-framework 기반 playground가 되려면 채팅 입력창이 슬래시 커맨드를 지원해야 한다.
예: `/skills` → 등록된 스킬 목록 반환, `/code-reviewer` → Code Reviewer 스킬 활성화.

## Goals

1. 채팅 입력창 커맨드 감지:
   - 입력이 `/`로 시작하면 커맨드로 인식
   - `session.executeCommand()` 또는 `session.submit()` 라우팅 결정
   - `/skills` → `session.executeCommand('skills', '')` 호출
   - `/skills code-reviewer` → skill 활성화
   - 일반 텍스트 → `session.submit(message)` (기존 동일)

2. 커맨드 자동완성 드롭다운:
   - `/` 입력 시 사용 가능한 커맨드 목록 드롭다운 표시
   - 서버에서 `GET /api/playground/sessions/:id/commands` 로 사용 가능한 커맨드 조회
   - 드롭다운에서 선택 시 입력창에 자동완성

3. 커맨드 응답 렌더링:
   - 커맨드 실행 결과는 채팅 말풍선과 구분되는 UI로 표시
   - `/skills` 결과: 스킬 목록 카드 형태 렌더링
   - 일반 커맨드 결과: 고정폭 텍스트 블록

4. 서버 커맨드 실행 엔드포인트:
   - `POST /api/playground/sessions/:id/command`
   - `{ name: string, args: string }` 요청
   - JSON 응답 (SSE 불필요, 동기)

## Non-Goals

- 커스텀 커맨드 등록 UI
- 커맨드 히스토리 (화살표 키 탐색)

## Architecture

```
packages/agent-playground/src/components/playground/chat-interface/
├── chat-input.tsx         ← 커맨드 감지 + 자동완성 드롭다운
└── command-result-bubble.tsx ← NEW: 커맨드 결과 전용 UI

packages/agent-playground/src/lib/playground/
└── robota-executor.ts     ← executeCommand() 메서드 추가

apps/agent-server/src/routes/handlers/
└── session-command.ts     ← NEW: POST /sessions/:id/command
```

## Test Plan

- 단위 테스트:
  - 입력이 `/`로 시작하면 커맨드로 감지하는 로직
  - `executeCommand` 라우팅 (커맨드명/args 파싱)
- `pnpm typecheck && pnpm test`

## User Execution Test Scenarios

### Scenario 1: /skills 커맨드 실행

**Prerequisites**: PLG-F-002, PLG-F-003 완료. Code Reviewer skill 등록된 에이전트

**Steps**:

1. 채팅 입력창에 `/skills` 입력 후 전송

**Expected observable result**:

- 커맨드 응답으로 "Registered skills: - code-reviewer: ..." 형태의 목록 표시
- 일반 메시지 말풍선과 시각적으로 구분됨

**Evidence**: `<스크린샷 — 구현 후 기입>`

### Scenario 2: 슬래시 커맨드 자동완성

**Steps**:

1. 채팅 입력창에 `/` 입력

**Expected observable result**:

- 드롭다운에 사용 가능한 커맨드 목록(`skills`, `compact` 등) 표시
- 커맨드 선택 시 입력창에 자동완성

**Evidence**: 브라우저 검증 완료 (2026-05-19)

- `/` 입력 시 `/code-reviewer` 드롭다운 표시 확인
- Tab으로 자동완성 → 입력창에 `/code-reviewer` 채워짐 확인
- `/code-reviewer function add(a,b){return a+b}` 전송 → InteractiveSession 스킬 라우터 경유 → Code Reviewer 스킬 프롬프트 활성화 → 코드 리뷰 응답 수신 확인
- 구현: `chat-input-area.tsx` 드롭다운, `playground-session-submit.ts` rawInput 전달, `PlaygroundApp.tsx` availableCommands 전달
