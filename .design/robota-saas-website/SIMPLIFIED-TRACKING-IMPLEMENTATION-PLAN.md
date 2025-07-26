# 동적 트래킹 구현 계획 (기존 시스템 활용)

## 🎯 핵심 전략: 기존 블록 시스템 확장

**결론**: 완전히 새로운 TrackingTree를 만들지 않고, **기존 PlaygroundBlockCollector를 확장**하여 동적 트래킹 기능을 추가하는 것이 가장 효율적입니다.

### ✅ 기존 시스템의 장점 활용
1. **이미 작동하는 블록 시스템**: `PlaygroundBlockCollector`, `BlockMessage`, `BlockMetadata`
2. **기존 ToolHooks 인터페이스**: `createBlockTrackingHooks()` 이미 구현됨
3. **UI 연동 완료**: React 컴포넌트들이 블록 시스템과 연동되어 작동
4. **계층 구조 지원**: `parentId`, `children`, `level` 필드로 트리 구조 이미 지원

### 🔧 필요한 확장사항
1. **동적 단계 생성**: Tool 실행 중 하위 블록들이 자동 생성
2. **LLM 응답 블록**: Tool 완료 후 LLM 응답 블록 자동 추가
3. **실행 계획 표시**: Tool 시작 시 예상 단계들을 미리 표시
4. **실시간 진행률**: 각 단계별 진행 상황 실시간 업데이트

## 📋 구현 단계

### Phase 1: 기존 블록 시스템 확장 (1주)

#### 1.1 BlockMetadata 타입 확장
```typescript
// apps/web/src/lib/playground/block-tracking/types.ts 확장
export interface EnhancedBlockMetadata extends BlockMetadata {
  /** 실행 계획 (Tool 시작 시 생성) */
  executionPlan?: {
    steps: ExecutionStep[];
    estimatedTotalTime?: number;
  };
  
  /** 현재 진행 상황 */
  progress?: {
    currentStep: number;
    totalSteps: number;
    percentage: number;
  };
  
  /** Tool별 세부 정보 */
  toolDetails?: {
    toolType: 'single' | 'multi' | 'mcp';
    expectedDuration?: number;
    subBlocks?: string[]; // 동적 생성되는 하위 블록 IDs
  };
}

export interface ExecutionStep {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  description?: string;
  estimatedDuration?: number;
  startTime?: Date;
  endTime?: Date;
}
```

#### 1.2 ToolExecutionPlanner 생성
```typescript
// apps/web/src/lib/playground/execution-planning/tool-planner.ts
export class ToolExecutionPlanner {
  /**
   * Tool 타입별 실행 계획 생성
   */
  static createExecutionPlan(toolName: string): ExecutionStep[] {
    const patterns = {
      // Single-step tools
      single: ['calculator', 'dateTime', 'randomGenerator'],
      // Multi-step API tools
      api: ['webSearch', 'weatherAPI', 'github-mcp'],
      // File processing tools
      file: ['fileSearch', 'codeAnalysis']
    };
    
    if (patterns.single.includes(toolName)) {
      return [{
        id: 'execute',
        name: '실행',
        status: 'pending',
        estimatedDuration: 100
      }];
    } else if (patterns.api.includes(toolName)) {
      return [
        { id: 'prepare', name: '요청 준비', status: 'pending', estimatedDuration: 200 },
        { id: 'api_call', name: 'API 호출', status: 'pending', estimatedDuration: 2000 },
        { id: 'parse', name: '결과 파싱', status: 'pending', estimatedDuration: 500 },
        { id: 'format', name: '결과 포맷팅', status: 'pending', estimatedDuration: 300 }
      ];
    }
    // ... 기타 패턴들
  }
}
```

#### 1.3 Enhanced BlockTrackingHooks
```typescript
// apps/web/src/lib/playground/block-tracking/enhanced-block-hooks.ts
export function createEnhancedBlockTrackingHooks(
  blockCollector: BlockDataCollector,
  options: EnhancedTrackingOptions = {}
): ToolHooks {
  return {
    async beforeExecute(toolName: string, parameters: any, context?: ToolExecutionContext) {
      // 1. 실행 계획 생성
      const executionPlan = ToolExecutionPlanner.createExecutionPlan(toolName);
      
      // 2. Tool 블록 생성 (기존 방식 + 실행 계획 추가)
      const toolBlock = createToolBlockWithPlan(toolName, parameters, executionPlan);
      blockCollector.collectBlock(toolBlock);
      
      // 3. 예상 단계 블록들 미리 생성 (pending 상태)
      executionPlan.forEach((step, index) => {
        const stepBlock = createStepBlock(step, toolBlock.blockMetadata.id, index + 1);
        blockCollector.collectBlock(stepBlock);
      });
    },
    
    async afterExecute(toolName: string, parameters: any, result: any, context?: ToolExecutionContext) {
      // 1. Tool 블록 완료 상태로 업데이트
      updateToolBlockCompleted(toolBlock.blockMetadata.id, result);
      
      // 2. LLM 응답 블록 자동 생성
      const llmBlock = createLLMResponseBlock(toolBlock.blockMetadata.id, result, parameters);
      blockCollector.collectBlock(llmBlock);
      
      // 3. LLM 처리 시작 (실제 LLM 호출은 SDK에서 자동 처리)
      updateLLMBlockInProgress(llmBlock.blockMetadata.id);
    }
  };
}
```

### Phase 2: 동적 단계 업데이트 시스템 (1주)

#### 2.1 StepProgressTracker 구현
```typescript
// 실행 중인 Tool의 단계별 진행 상황을 실시간 추적
export class StepProgressTracker {
  private activeTools = new Map<string, ToolExecutionState>();
  
  /**
   * Tool 단계 진행 시 호출
   */
  onStepProgress(toolExecutionId: string, stepId: string, status: 'in_progress' | 'completed') {
    // 해당 단계 블록 상태 업데이트
    const stepBlockId = this.getStepBlockId(toolExecutionId, stepId);
    this.blockCollector.updateBlock(stepBlockId, {
      visualState: status,
      executionContext: {
        timestamp: new Date(),
        duration: this.calculateStepDuration(toolExecutionId, stepId)
      }
    });
    
    // 전체 Tool 진행률 계산 및 업데이트
    this.updateToolProgress(toolExecutionId);
  }
}
```

#### 2.2 실시간 진행률 계산
```typescript
// 각 Tool의 현재 진행 상황을 % 로 계산
function calculateToolProgress(executionPlan: ExecutionStep[]): ProgressInfo {
  const completedSteps = executionPlan.filter(step => step.status === 'completed').length;
  const totalSteps = executionPlan.length;
  const currentStepIndex = executionPlan.findIndex(step => step.status === 'in_progress');
  
  return {
    percentage: Math.round((completedSteps / totalSteps) * 100),
    currentStep: currentStepIndex + 1,
    totalSteps,
    currentStepName: executionPlan[currentStepIndex]?.name
  };
}
```

### Phase 3: LLM 응답 블록 자동 생성 (3일)

#### 3.1 LLM Response Handler
```typescript
// Tool 완료 후 자동으로 LLM 응답 블록 생성
export class LLMResponseHandler {
  /**
   * Tool 결과를 받아 LLM 응답 블록 생성
   */
  createLLMResponseBlock(
    parentToolBlockId: string,
    toolResult: any,
    originalUserMessage: string
  ): BlockMessage {
    return {
      role: 'assistant',
      content: '🔄 LLM 응답 생성 중...',
      blockMetadata: {
        id: generateBlockId(),
        type: 'assistant',
        level: getParentLevel(parentToolBlockId) + 1,
        parentId: parentToolBlockId,
        children: [],
        isExpanded: true,
        visualState: 'in_progress',
        executionContext: {
          timestamp: new Date(),
          toolName: 'llm_response'
        },
        renderData: {
          inputData: {
            toolResult,
            userMessage: originalUserMessage
          }
        }
      }
    };
  }
  
  /**
   * LLM 응답 완료 시 블록 업데이트
   */
  onLLMResponseComplete(blockId: string, response: string) {
    this.blockCollector.updateBlock(blockId, {
      content: response,
      visualState: 'completed',
      executionContext: {
        duration: this.calculateResponseTime(blockId)
      }
    });
  }
}
```

### Phase 4: UI 컴포넌트 업데이트 (3일)

#### 4.1 Enhanced Block Components
```typescript
// Block 렌더링 시 진행률 표시
export function EnhancedToolBlock({ block }: { block: BlockMessage }) {
  const { progress, executionPlan } = block.blockMetadata;
  
  return (
    <div className="tool-block">
      {/* 기존 블록 헤더 */}
      <BlockHeader block={block} />
      
      {/* 진행률 표시 */}
      {progress && (
        <ProgressBar 
          percentage={progress.percentage}
          currentStep={progress.currentStep}
          totalSteps={progress.totalSteps}
        />
      )}
      
      {/* 실행 계획 표시 */}
      {executionPlan && (
        <ExecutionSteps steps={executionPlan.steps} />
      )}
      
      {/* 기존 블록 내용 */}
      <BlockContent block={block} />
    </div>
  );
}
```

## 🎯 MVP 구현 우선순위

### Week 1: 기본 확장
1. **BlockMetadata 확장**: 실행 계획, 진행률 필드 추가
2. **ToolExecutionPlanner**: 3가지 Tool 타입 (single, api, mcp) 실행 계획 생성
3. **Enhanced Hooks**: 기존 ToolHooks에 실행 계획 생성 로직 추가

### Week 2: 동적 업데이트
1. **StepProgressTracker**: 실시간 단계 진행 추적
2. **LLM Response Handler**: Tool 완료 후 LLM 블록 자동 생성
3. **Progress Calculation**: 진행률 계산 및 블록 업데이트

### Week 3: UI 완성
1. **Enhanced Block Components**: 진행률 표시 UI
2. **Real-time Updates**: WebSocket 또는 polling 기반 실시간 업데이트
3. **Testing & Polish**: 전체 시스템 테스트 및 UX 개선

## ✅ 이 접근법의 장점

### 1. 기존 시스템 재활용
- **90% 기존 코드 유지**: 새로 만들지 않고 확장만
- **검증된 아키텍처**: 이미 작동하는 블록 시스템 기반
- **React 연동 완료**: UI 컴포넌트들이 이미 연동되어 있음

### 2. 점진적 개발 가능
- **단계별 검증**: 각 Phase마다 즉시 테스트 가능
- **롤백 가능**: 문제 발생 시 이전 단계로 쉽게 복원
- **병렬 개발**: UI와 백엔드 로직을 독립적으로 개발

### 3. Robota SDK 모범 사례
- **ToolHooks 활용**: SDK의 표준 훅 시스템 사용
- **플러그인 패턴**: 기존 플러그인 아키텍처와 호환
- **최소 침입**: 기존 Agent/Tool 코드 수정 없음

### 4. 개발자 친화적
- **학습 곡선 최소**: 기존 블록 시스템 개념 재사용
- **디버깅 용이**: 블록 단위로 각 단계 추적 가능
- **확장성**: 새로운 Tool 타입 쉽게 추가 가능

## 🚀 구현 시작점

**즉시 시작 가능한 첫 번째 작업**:
1. `apps/web/src/lib/playground/block-tracking/types.ts`에 확장 타입 추가
2. `ToolExecutionPlanner` 클래스 생성
3. `createEnhancedBlockTrackingHooks` 함수 구현

이 방식으로 **기존 playground의 복잡성을 그대로 활용하면서도, 새로운 동적 트래킹 기능을 단계적으로 추가**할 수 있습니다! 