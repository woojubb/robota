# Context Compaction Research: Claude Code vs Robota

## Claude Code의 Context 관리 방식

### 1. 토큰 계산: API response의 `usage` 메타데이터 사용

Claude Code는 클라이언트에서 토큰을 추정하지 않음. Anthropic API 응답의 `usage` 객체에서 정확한 토큰 수를 읽음:

```json
{
  "usage": {
    "input_tokens": 14280,
    "output_tokens": 320,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0
  }
}
```

tiktoken이나 chars/N 추정을 사용하지 않음. API가 반환하는 값이 권위적(authoritative) 수치.

### 2. Compaction 트리거 시점: API 호출 전 (after turn이 아님)

- **임계치**: context window의 ~83.5% (200K 기준 ~167K tokens)
- **타이밍**: 다음 API 호출 직전에 체크 (turn 완료 후가 아님)
- **버퍼**: ~33K tokens (16.5%)이 autocompact buffer로 예약
- **환경변수**: `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (1-100)로 커스텀 가능

### 3. Compaction 프로세스

1. 83.5% 초과 시 API 호출 전 일시정지
2. 히스토리 전처리: 이미지, PDF, 빈 블록 제거
3. 요약 프롬프트로 LLM 호출:
   > "Please write a summary of the transcript. The purpose is to provide continuity..."
4. 요약을 **assistant 메시지**로 주입 (system이 아님)
5. 이후 API 요청은 3개만 포함: [summary, last_assistant, current_user]
6. 이전 메시지는 전부 드롭

압축률: 21 messages → 3 messages, 14K tokens → 1.8K tokens (~87% 감소)

### 4. Server-side Compaction API (신규, beta)

claude-opus-4-6, claude-sonnet-4-6에서 사용 가능:

```typescript
context_management: {
  edits: [{
    type: "compact_20260112",
    trigger: { type: "input_tokens", value: 150000 },
    instructions: null // custom summarization instructions
  }]
}
```

서버가 자동으로 요약하고 `compaction` 블록을 응답에 포함. 클라이언트는 그대로 다음 요청에 전달하면 이전 히스토리가 자동 제거됨.

### 5. Tool Result 관리

- 50K chars 이상 → 디스크에 오프로드, 컨텍스트에는 파일 참조만 유지
- 파일 읽기 토큰 제한: `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`
- PDF 10페이지 초과 → 경량 참조로 대체

### 6. 요약 주입 방식

- **assistant 메시지로 주입** (system 메시지가 아님)
- 이후 요청: [summary_assistant, last_assistant, current_user] 3개만

---

## Robota 현재 구현과의 차이점

| 항목 | Claude Code | Robota (현재) |
|------|------------|--------------|
| 토큰 계산 | API `usage` 메타데이터 | chars/3 추정 (부정확) |
| 체크 시점 | API 호출 직전 | execution round 시작 시 (부분 구현) |
| 임계치 | 83.5% | 70% (보수적으로 설정) |
| 요약 주입 | assistant 메시지로 history 교체 | pending summary를 다음 user message에 prepend |
| Tool 결과 | 50K+ chars 디스크 오프로드 | 30K chars 중간 truncation만 |
| Server-side | `context_management.edits` API 사용 가능 | 미구현 |

## 적용 계획

### Phase 1: 토큰 계산 정확도 개선

- API 응답의 `usage.input_tokens`를 누적하여 context 사용량 추적
- chars/3 추정 대신 실제 메타데이터 기반 계산
- 이미 `ContextWindowTracker.updateFromHistory()`에서 메타데이터 읽기 구현됨 — execution round에서도 활용

### Phase 2: Compaction 타이밍 개선

- execution round 시작 시 (API 호출 직전) 토큰 체크 — 현재 구현됨
- 임계치를 Claude Code와 동일하게 83.5%로 조정 (정확한 토큰 계산 전제)
- compaction 트리거 시 execution loop break → run() 완료 → auto-compact → 다음 run()

### Phase 3: 요약 주입 방식 개선

- 현재: user message에 prepend (모델이 context summary + 사용자 질문을 함께 받음)
- 개선: assistant 메시지로 주입하여 히스토리 교체 (Claude Code 방식)
- Robota에 `addAssistantMessage()` 메서드 필요

### Phase 4: Server-side Compaction API 활용 (보류)

- `compact-2026-01-12` beta header 사용
- `context_management.edits` 파라미터로 서버에 위임
- **주의: 클라이언트 히스토리와 불일치 문제**
  - 서버가 압축한 히스토리와 Session이 가진 히스토리가 달라짐
  - ContextWindowTracker, SessionStore가 서버 상태를 모름
  - 도구 호출 기록 등이 서버에 의해 드롭될 수 있음
  - 적용하려면 히스토리 관리를 서버에 완전 위임하는 아키텍처 전환 필요
- 공식 문서: https://platform.claude.com/docs/en/build-with-claude/compaction
- 지원 모델: claude-opus-4-6, claude-sonnet-4-6 (beta)
