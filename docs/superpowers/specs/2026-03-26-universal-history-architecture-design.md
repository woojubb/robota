# Universal History Architecture Design

## Summary

Core 히스토리를 AI 채팅 메시지 전용에서 범용 이벤트 로그로 확장. 모든 시스템 이벤트가 히스토리에 기록되고, AI provider에는 채팅 메시지만 필터링하여 전달.

## Confirmed Decisions

| #   | Decision      | Choice                                                                                             |
| --- | ------------- | -------------------------------------------------------------------------------------------------- |
| 1   | 최상위 타입   | `IHistoryEntry` — 모든 것이 히스토리 엔트리                                                        |
| 2   | 구분 방식     | `category` (대분류) + `type` (세부 구분), 문자열 자유 확장                                         |
| 3   | 기존 호환     | 점진적 전환. `TUniversalMessage`는 `IHistoryEntry`의 chat 서브타입으로 유지                        |
| 4   | 저장/전달     | 저장은 `IHistoryEntry[]`, AI 전달 시 `category === 'chat'`만 필터링 → `TUniversalMessage[]`로 변환 |
| 5   | 데이터        | `data: T` 제네릭 필드에 종류별 구조화된 데이터                                                     |
| 6   | content/state | 공통이 아님. `data` 안에 포함                                                                      |
| 7   | metadata      | 불필요. `data`로 통합                                                                              |

## IHistoryEntry

```typescript
interface IHistoryEntry<T = unknown> {
  id: string;
  timestamp: Date;
  category: string; // 'chat', 'event', ...
  type: string; // 자유 확장. 사전 정의 없음
  data?: T; // 종류별 구조화된 데이터
}
```

5개 필드만. `id`, `timestamp`는 식별/정렬, `category`+`type`은 분류, `data`는 내용.

## 채팅 메시지 (category: 'chat')

기존 `TUniversalMessage`의 필드는 `data`에 들어감:

```typescript
// user message
{ id, timestamp, category: 'chat', type: 'user',
  data: { role: 'user', content: '질문', parts: [...] } }

// assistant message
{ id, timestamp, category: 'chat', type: 'assistant',
  data: { role: 'assistant', content: '응답', state: 'complete', toolCalls: [...] } }

// tool message
{ id, timestamp, category: 'chat', type: 'tool',
  data: { role: 'tool', content: '결과', toolCallId: '...', name: 'Read' } }

// system prompt
{ id, timestamp, category: 'chat', type: 'system',
  data: { role: 'system', content: '시스템 프롬프트' } }
```

## 이벤트 (category: 'event')

내용은 사전에 정의하지 않음. 자유 확장:

```typescript
// skill invocation
{ id, timestamp, category: 'event', type: 'skill-invocation',
  data: { skillName: 'audit', source: 'plugin' } }

// context compaction
{ id, timestamp, category: 'event', type: 'compaction',
  data: { before: 80, after: 30 } }

// permission decision
{ id, timestamp, category: 'event', type: 'permission',
  data: { toolName: 'Bash', decision: 'allowed' } }
```

## AI Provider 전달 흐름

```
IHistoryEntry[]
  ↓ filter: category === 'chat'
  ↓ convert: extract data → TUniversalMessage
TUniversalMessage[]
  ↓ provider.chat(messages)
```

`getMessagesForAPI()` 함수가 `IHistoryEntry[]` → `TUniversalMessage[]` 변환 담당.

## 기존 코드 호환

- `TUniversalMessage`는 유지. `IHistoryEntry`에서 chat 엔트리를 변환한 결과 타입.
- 기존에 `TUniversalMessage`를 사용하는 코드는 변경 없음.
- 히스토리 전체를 다루는 새 코드만 `IHistoryEntry[]` 사용.
- `ConversationStore` (core)가 `IHistoryEntry[]`로 저장.
- `Session.getHistory()`는 `IHistoryEntry[]` 반환 (기존 `TUniversalMessage[]`에서 변경).
- AI provider에 전달하는 `getMessagesForAPI()`만 `TUniversalMessage[]` 반환.

## 변경 범위

### agent-core

- `IHistoryEntry` 인터페이스 정의 (messages.ts 또는 새 파일)
- `ConversationStore`: `IHistoryEntry[]`로 저장
- `getMessagesForAPI()`: `IHistoryEntry[]` → `TUniversalMessage[]` 필터/변환
- `TUniversalMessage` 유지 (AI provider 전달용)

### agent-sessions

- `Session.getHistory()`: `IHistoryEntry[]` 반환
- `Session.addEntry(entry: IHistoryEntry)`: 범용 엔트리 추가 메서드

### agent-sdk

- `InteractiveSession`: 이벤트 발생 시 `IHistoryEntry`로 히스토리에 기록
- `InteractiveSession.getMessages()`: `IHistoryEntry[]` 반환 (렌더링용)

### agent-cli

- `MessageList`: `IHistoryEntry`를 렌더링 (category별 다른 UI)
- `TuiStateManager`: `IHistoryEntry[]`로 messages 관리

## 원칙

- 히스토리는 append-only, read-only
- 모든 시스템 이벤트는 히스토리에 기록됨 (로그 성격)
- AI provider는 필터링된 뷰만 봄
- `type` 문자열은 사전 정의하지 않음 (자유 확장)

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
