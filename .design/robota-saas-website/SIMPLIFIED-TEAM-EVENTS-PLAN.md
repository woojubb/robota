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

✅ **구현 상세 계획은 별도 문서 참조**: [TEAM-HOOKS-IMPLEMENTATION-CHECKLIST.md](./TEAM-HOOKS-IMPLEMENTATION-CHECKLIST.md)

### 핵심 아키텍처 변경점

**기존 문제**: Team 라이브러리에 Hook을 주입할 표준 방법이 없음
**해결 방안**: TeamOptions에 toolHooks 옵션 추가로 표준화된 Hook 주입 제공

**아키텍처 준수**:
- **Dependency Injection**: 생성자 옵션을 통한 Hook 주입
- **Single Responsibility**: Team은 실행만, Hook은 추적만 담당  
- **Interface Segregation**: 기존 ToolHooks 인터페이스 재사용
- **보편성**: 모든 Team 라이브러리 사용자가 활용 가능

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

### Team 실행 시나리오 (toolHooks 기반)
```
사용자: "vue와 react 비교해줘"

📊 생성되는 이벤트 구조:
┌─ user_message (level=0, team) [Team Level]
├─ tool_call (level=1, team→assignTask) [Hook: onBeforeExecute]
│  ├─ [Sub-Agent 실행 과정은 Team 내부에서 처리]
│  ├─ [Vue 전문가 Agent 생성 → 분석 → 결과 반환]
│  └─ [React 전문가 Agent 생성 → 분석 → 결과 반환]
├─ tool_result (level=1, team→assignTask) [Hook: onAfterExecute]
└─ assistant_response (level=0, team) [Team Level]
```

### Hook 구현 예시 (Playground용)
```typescript
// Playground에서 Team 생성 시
const team = createTeam({
  aiProviders: [openaiProvider, anthropicProvider],
  toolHooks: {
    beforeExecute: async (toolName, params, context) => {
      if (toolName === 'assignTask') {
        historyPlugin.recordEvent({
          type: 'tool_call',
          content: `🚀 [${toolName}] Starting: ${JSON.stringify(params)}`,
          toolName,
          parameters: params,
          delegationId: generateDelegationId(),
          // parentEventId는 Team의 user_message (자동 계층화)
        });
      }
    },
    afterExecute: async (toolName, params, result, context) => {
      if (toolName === 'assignTask') {
        historyPlugin.recordEvent({
          type: 'tool_result',
          content: `✅ [${toolName}] Completed: ${result}`,
          toolName,
          result,
          // parentEventId는 동일 delegationId의 tool_call (자동 계층화)
        });
      }
    },
    onError: async (toolName, params, error, context) => {
      if (toolName === 'assignTask') {
        historyPlugin.recordEvent({
          type: 'error',
          content: `❌ [${toolName}] Error: ${error.message}`,
          toolName,
          error: error.message,
        });
      }
    }
  }
});
```

### Team 패키지 구현 예시
```typescript
// packages/team/src/team-container.ts
class TeamContainer {
  private toolHooks?: ToolHooks;

  constructor(options: TeamContainerOptions) {
    this.toolHooks = options.toolHooks;
    // ...
  }

  private createAssignTaskTool() {
    if (this.toolHooks) {
      // Hook이 있으면 AgentDelegationTool 사용
      return new AgentDelegationTool({
        hooks: this.toolHooks,
        availableTemplates: this.availableTemplates,
        executor: (params) => this.assignTask(params),
        logger: this.logger
      });
    } else {
      // Hook이 없으면 기존 방식 사용
      return createTaskAssignmentFacade(
        this.availableTemplates.map(t => ({ id: t.id, description: t.description })),
        (params) => this.assignTask(params)
      ).tool;
    }
  }
}
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

## ✅ 성공 기준 (toolHooks 아키텍처)

**기술적 목표**:
- [ ] TeamOptions에 toolHooks 옵션 추가로 표준 Hook 주입 방법 제공
- [ ] 기존 ToolHooks 인터페이스 재사용하여 타입 안전성 보장
- [ ] AgentDelegationTool과 기존 createTaskAssignmentFacade 선택적 사용
- [ ] Playground에서 createTeam({ toolHooks }) 방식으로 간단 사용
- [ ] assignTask 실행 시 Hook을 통한 자동 계층 이벤트 생성

**사용자 경험 목표**:
- [ ] Team 실행 과정을 Level 0(Team) → Level 1(assignTask) 계층으로 표시
- [ ] assignTask 도구 호출과 완료가 명확히 구분되어 표시
- [ ] Sub-Agent 실행은 Team 내부 처리로 단순화 (복잡성 제거)
- [ ] 오류 발생 시 정확한 도구 레벨에서 추적 가능
- [ ] 직관적인 들여쓰기 UI로 실행 흐름 파악 가능

**아키텍처 준수 목표**:
- [ ] **Dependency Injection**: toolHooks를 생성자 옵션으로 주입
- [ ] **Single Responsibility**: Team은 실행만, Hook은 추적만 담당
- [ ] **Interface Segregation**: 기존 ToolHooks 인터페이스 재사용
- [ ] **보편성**: 모든 Team 라이브러리 사용자가 활용 가능한 공통 기능
- [ ] **선택성**: Hook 없이도 기존과 동일하게 동작 (하위 호환성)

**검증 체크리스트**:
- [ ] `createTeam({ toolHooks })` 호출 시 컴파일 오류 없음
- [ ] Team 실행 시 onBeforeExecute Hook 정상 호출
- [ ] assignTask 완료 시 onAfterExecute Hook 정상 호출  
- [ ] Hook을 통해 기록된 이벤트가 올바른 계층 레벨(0,1) 표시
- [ ] UI에서 team→assignTask 경로가 들여쓰기로 표시
- [ ] 기존 Team 라이브러리 사용자에게 영향 없음 (toolHooks 미사용 시) 