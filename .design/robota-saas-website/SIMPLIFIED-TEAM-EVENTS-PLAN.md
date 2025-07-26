# Team 이벤트 단순화 및 계층 표현 계획

## 🎯 핵심 아키텍처 이해

### Team 실행 흐름의 본질
```
Team Agent → assignTask Tool → Sub-Agent → user/assistant/tool 흐름
```

**핵심 통찰**:
- Team은 단순히 Agent에게 Tool(assignTask)을 제공하는 컨테이너
- assignTask Tool 내부에서 Sub-Agent가 독립적으로 실행됨
- Sub-Agent는 일반적인 Agent와 동일한 user→assistant→tool 흐름을 가짐
- **복잡한 Team 전용 이벤트는 불필요**, 계층 구조만 명확히 표현하면 됨

## 📋 단순화된 이벤트 아키텍처

### ✅ 기본 이벤트 타입 (변경 없음)
```typescript
type BasicEventType = 
    | 'user_message'      // 사용자 입력
    | 'assistant_response' // LLM 응답  
    | 'tool_call'         // 도구 호출
    | 'tool_result'       // 도구 결과
    | 'error';            // 오류
```

### ✅ 계층 구조 필드 (핵심)
```typescript
interface ConversationEvent {
    // 기본 필드들...
    id: string;
    type: BasicEventType; // ✅ 단순한 5개 타입만
    timestamp: Date;
    content?: string;
    
    // 🎯 계층 구조 핵심 필드들
    parentEventId?: string;   // 부모 이벤트 참조
    childEventIds: string[];  // 자식 이벤트들 (자동 관리)
    executionLevel: number;   // 0=Team, 1=Tool, 2=Sub-Agent, 3=Sub-Tool
    executionPath: string;    // 'team→assignTask→agent_abc→webSearch'
    
    // 🔧 컨텍스트 추적
    agentId?: string;         // 실행 중인 Agent ID
    toolName?: string;        // 실행 중인 Tool 이름
    delegationId?: string;    // assignTask 호출 고유 ID
}
```

## 🏗️ 구현 계획

### ✅ Phase 1: 이벤트 타입 단순화

#### [x] 1.1 복잡한 Team 이벤트 타입 제거
- [x] `agent_creation_*`, `agent_execution_*`, `task_aggregation_*` 타입 제거
- [x] `tool_call_start/complete/error` → 기본 `tool_call/tool_result/error`로 통합
- [x] **즉시 검증**: 5개 기본 타입만 사용하도록 확인

#### [x] 1.2 ConversationEvent 인터페이스 정리
- [x] 불필요한 metadata 인터페이스들 제거
- [x] 핵심 계층 필드만 유지
- [x] 타입 정의 단순화
- [x] **즉시 검증**: 인터페이스 컴파일 오류 없음

### ✅ Phase 2: Tool Hook 기반 계층 추적

#### [x] 2.1 assignTask Tool Hook 구현
- [x] `onToolStart`: assignTask 시작 시 `tool_call` 이벤트 + delegation context
- [x] `onToolComplete`: assignTask 완료 시 `tool_result` 이벤트 + 결과
- [x] `onToolError`: assignTask 실패 시 `error` 이벤트
- [x] **즉시 검증**: assignTask Hook 정상 동작

#### [ ] 2.2 Sub-Agent 이벤트 자동 계층화
- [x] Team Level 이벤트 기록 (Level 0)
- [ ] Sub-Agent의 `user_message` → `parentEventId` = assignTask의 `tool_call.id`
- [ ] Sub-Agent의 `assistant_response` → 동일한 `parentEventId` 
- [ ] Sub-Agent의 `tool_call` → `executionLevel = 3` (Sub-Tool)
- [ ] **즉시 검증**: 계층 구조 자동 생성 확인

### ✅ Phase 3: 계층 표현 로직 구현

#### [x] 3.1 executionLevel 자동 계산
- [x] calculateExecutionLevel 메서드 구현
- [x] null/undefined 안전성 보장
- [x] 범위 제한 (최대 3레벨)

#### [x] 3.2 executionPath 자동 생성
- [x] buildExecutionPath 메서드 구현
- [x] 안전한 문자열 생성
- [x] 기본값 'team' 보장

#### [x] 3.3 부모-자식 관계 자동 관리
- [x] recordEvent 시 parentEventId 기반 자식 배열 업데이트
- [x] 순환 참조 방지 로직
- [x] **즉시 검증**: 관계 추적 정상 동작

### ✅ Phase 4: UI 계층 시각화

#### [x] 4.1 단순한 들여쓰기 기반 표시
- [x] executionLevel 기반 들여쓰기 (level * 20px)
- [x] 이벤트 타입별 색상 구분
- [x] 실행 경로 breadcrumb 표시
- [x] **즉시 검증**: UI 계층 표현 정상 동작

#### [ ] 4.2 확장/축소 기능
- [ ] 부모 이벤트 클릭 시 자식들 토글
- [ ] Level별 색상 구분
- [ ] 실행 경로 breadcrumb 표시
- [ ] **즉시 검증**: UI 계층 표현 정상 동작

## 🔧 구현 예시

### Team 실행 시나리오
```
사용자: "vue와 react 비교해줘"

📊 생성되는 이벤트 구조:
┌─ user_message (level=0, team)
├─ tool_call (level=1, team→assignTask)  
│  ├─ user_message (level=2, team→assignTask→agent_vue)
│  ├─ assistant_response (level=2, team→assignTask→agent_vue)  
│  ├─ user_message (level=2, team→assignTask→agent_react)
│  └─ assistant_response (level=2, team→assignTask→agent_react)
├─ tool_result (level=1, team→assignTask) 
└─ assistant_response (level=0, team)
```

### Hook 구현 예시
```typescript
// assignTask Tool에 주입될 Hook
const createAssignTaskHooks = (historyPlugin: PlaygroundHistoryPlugin) => ({
    onToolStart: async (context: ToolExecutionContext) => {
        historyPlugin.recordEvent({
            type: 'tool_call',
            toolName: 'assignTask',
            content: `Task assignment started`,
            delegationId: generateId(),
            // parentEventId는 Team의 user_message.id
        });
    },
    
    onToolComplete: async (context: ToolExecutionContext, result: any) => {
        historyPlugin.recordEvent({
            type: 'tool_result', 
            toolName: 'assignTask',
            content: result.summary,
            // parentEventId는 동일한 delegationId의 tool_call.id
        });
    }
});
```

## 🎯 핵심 이점

### 1. 아키텍처 단순성
- **복잡한 Team 전용 이벤트 제거** → 유지보수 용이
- **기본 5개 이벤트 타입만 사용** → 이해하기 쉬움  
- **Tool Hook 패턴 활용** → 기존 SDK 아키텍처와 일관성

### 2. 확장성
- **새로운 Tool 추가 시** → 동일한 Hook 패턴 적용
- **더 깊은 중첩** → executionLevel만 증가
- **다른 Agent 타입** → 동일한 이벤트 구조 사용

### 3. 디버깅 용이성  
- **실행 경로 추적** → `executionPath`로 한눈에 파악
- **계층별 필터링** → Level별로 보기 가능
- **단순한 이벤트 타입** → 로그 분석 용이

## ✅ 성공 기준

**기술적 목표**:
- [ ] 5개 기본 이벤트 타입만 사용
- [ ] Tool Hook을 통한 자동 계층 추적
- [ ] UI에서 계층 구조 명확히 표시
- [ ] Team 스트리밍 정상 동작

**사용자 경험 목표**:
- [ ] Team 실행 과정을 한눈에 파악 가능
- [ ] 각 Sub-Agent의 독립적 실행 과정 확인
- [ ] 오류 발생 시 정확한 위치 추적 가능
- [ ] 복잡하지 않은 직관적인 인터페이스 