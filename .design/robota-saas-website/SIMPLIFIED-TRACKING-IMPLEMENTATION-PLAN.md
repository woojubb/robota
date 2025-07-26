# SDK 향상 기반 실행 추적 시스템 - 상세 구현 계획

## 🎯 핵심 전략: SDK 핵심 향상 + 실제 데이터 추적

**기존 시스템을 약간 향상시켜 훨씬 더 명확하고 강력한 추적 시스템을 구현합니다.**

### ✅ **핵심 원칙**
- **0% Breaking Change**: 기존 코드 100% 호환
- **실제 데이터만**: 가짜 시뮬레이션 일체 사용 안 함
- **비침습적 확장**: 새 파일 추가 + 선택적 필드만 추가
- **SDK 철학 준수**: 모든 아키텍처 원칙 완벽 준수

---

## 🏗️ **Phase 1: SDK 핵심 향상 (1주) - 계층적 실행 추적**

### **1.1 ToolExecutionContext 확장 - 계층적 컨텍스트 지원**

#### 파일: `packages/agents/src/interfaces/tool.ts`
```typescript
// 기존 인터페이스에 새 필드만 추가 (Breaking Change 없음)
export interface ToolExecutionContext {
    // 모든 기존 필드 그대로...
    toolName: string;
    parameters: ToolParameters;
    userId?: string;
    sessionId?: string;
    metadata?: ToolMetadata;
    
    // 새 필드들 (모두 선택적)
    parentExecutionId?: string;    // 부모 실행 ID
    rootExecutionId?: string;      // 최상위 실행 ID (Team/Agent)
    executionLevel?: number;       // 실행 깊이 (0: Team, 1: Agent, 2: Tool)
    executionPath?: string[];      // 실행 경로 ['team', 'agent', 'webSearch']
    
    // 실제 데이터 추적을 위한 필드
    realTimeData?: {
        startTime: Date;           // 실제 시작 시간
        actualParameters: any;     // 실제 입력 파라미터
        estimatedDuration?: number; // Tool이 제공하는 예상 시간
    };
    
    // 기존 인덱스 시그니처로 호환성 보장
    [key: string]: string | number | boolean | ToolParameters | ToolMetadata | undefined;
}
```

#### 구현 방법
- 기존 `ToolExecutionContext` 인터페이스 확장
- 모든 새 필드는 `?` 선택적 표시
- 기존 14개 파일이 수정 없이 그대로 작동

### **1.2 EventEmitterPlugin 향상 - 계층적 이벤트 지원**

#### 파일: `packages/agents/src/plugins/event-emitter-plugin.ts`
```typescript
// 기존 EventType에 새 이벤트만 추가
export type EventType =
    | 'execution.start'        // 기존 그대로
    | 'execution.complete'     // 기존 그대로
    | 'tool.beforeExecute'     // 기존 그대로
    | 'tool.afterExecute'      // 기존 그대로
    // ... 모든 기존 이벤트 타입 그대로
    
    // 새 이벤트들 (기존 구독자에게 영향 없음)
    | 'execution.hierarchy'    // 계층적 실행 컨텍스트 정보
    | 'execution.realtime'     // 실제 실행 데이터 업데이트
    | 'tool.realtime';         // Tool 실시간 상태 변경

// 새 이벤트 데이터 타입
export interface HierarchicalEventData extends EventData {
    parentExecutionId?: string;
    rootExecutionId?: string;
    executionLevel: number;
    executionPath: string[];
    realTimeData?: {
        startTime: Date;
        actualDuration?: number;
        actualParameters?: any;
        actualResult?: any;
    };
}
```

#### 구현 방법
- 기존 이벤트 타입은 변경하지 않음
- 새 이벤트만 추가하여 기존 구독자들에게 영향 없음
- 계층적 실행 컨텍스트 자동 관리 로직 추가

### **1.3 ExecutionTrackingPlugin 생성 - 전용 추적 플러그인**

#### 파일: `packages/agents/src/plugins/execution-tracking-plugin.ts` (새 파일)
```typescript
export interface ExecutionNode {
    id: string;
    type: 'team' | 'agent' | 'tool' | 'llm_response';
    name: string;
    status: 'pending' | 'in_progress' | 'completed' | 'error';
    
    // 실제 데이터만
    startTime?: Date;
    endTime?: Date;
    actualDuration?: number;
    actualParameters?: any;
    actualResult?: any;
    
    // 계층 정보
    parentId?: string;
    childrenIds: string[];
    level: number;
    path: string[];
}

export class ExecutionTrackingPlugin extends BasePlugin {
    name = 'ExecutionTrackingPlugin';
    category = PluginCategory.MONITORING;
    priority = PluginPriority.HIGH;
    
    private executionTree = new Map<string, ExecutionNode>();
    private subscribers = new Set<(tree: Map<string, ExecutionNode>) => void>();
    
    // EventEmitterPlugin과 연동
    async initialize(eventEmitter: EventEmitterPlugin) {
        eventEmitter.on('tool.beforeExecute', this.onToolStart.bind(this));
        eventEmitter.on('tool.afterExecute', this.onToolComplete.bind(this));
        eventEmitter.on('execution.hierarchy', this.onHierarchyUpdate.bind(this));
    }
    
    // 외부에서 실행 트리 구독
    subscribeToExecutionTree(callback: (tree: Map<string, ExecutionNode>) => void) {
        this.subscribers.add(callback);
        // 현재 트리 상태 즉시 전달
        callback(new Map(this.executionTree));
    }
    
    private notifySubscribers() {
        this.subscribers.forEach(callback => {
            callback(new Map(this.executionTree));
        });
    }
}
```

#### 구현 방법
- 완전히 새로운 독립 플러그인
- 표준 BasePlugin 패턴 사용
- EventEmitterPlugin과 자연스럽게 연동

### **1.4 ProgressReportingTool 인터페이스 - Tool 자체 진행률 보고**

#### 파일: `packages/agents/src/interfaces/progress-reporting.ts` (새 파일)
```typescript
export interface ToolExecutionStep {
    id: string;
    name: string;
    estimatedDuration: number;
    description?: string;
}

// 기존 ToolInterface를 확장하는 선택적 인터페이스
export interface ProgressReportingTool extends ToolInterface {
    /**
     * Tool이 자체적으로 예상 소요 시간을 제공 (선택사항)
     */
    getEstimatedDuration?(parameters: ToolParameters): number;
    
    /**
     * Tool이 실행 단계를 정의 (선택사항)
     */
    getExecutionSteps?(parameters: ToolParameters): ToolExecutionStep[];
    
    /**
     * 진행 상황 콜백 설정 (선택사항) 
     */
    setProgressCallback?(callback: (step: string, progress: number) => void): void;
}
```

#### 구현 방법
- 기존 ToolInterface는 전혀 변경하지 않음
- 새로운 선택적 인터페이스로 기존 Tool들에 영향 없음
- 원하는 Tool만 선택적으로 구현

---

## 🌐 **Phase 2: Web App 연동 시스템 (1주) - SDK와 UI 브리지**

### **2.1 ExecutionSubscriber 구현 - SDK → Web App 브리지**

#### 파일: `apps/web/src/lib/playground/execution-subscriber.ts` (새 파일)
```typescript
import type { ExecutionNode } from '@robota-sdk/agents';
import type { BlockMessage, BlockMetadata } from './block-tracking/types';

export class ExecutionSubscriber {
    constructor(
        private blockCollector: PlaygroundBlockCollector,
        private executionTrackingPlugin: ExecutionTrackingPlugin
    ) {
        // SDK의 실행 트리 변경사항 구독
        this.executionTrackingPlugin.subscribeToExecutionTree(
            this.onExecutionTreeUpdate.bind(this)
        );
    }
    
    private onExecutionTreeUpdate(executionTree: Map<string, ExecutionNode>) {
        // 실행 트리를 BlockMessage로 변환
        executionTree.forEach(node => {
            const blockMessage = this.convertNodeToBlock(node);
            
            if (node.status === 'pending' && !this.blockCollector.hasBlock(node.id)) {
                // 새 노드 추가
                this.blockCollector.collectBlock(blockMessage);
            } else {
                // 기존 노드 업데이트
                this.blockCollector.updateBlock(node.id, blockMessage.blockMetadata);
            }
        });
    }
    
    private convertNodeToBlock(node: ExecutionNode): BlockMessage {
        // 실제 데이터만 변환 (시뮬레이션 없음)
        return {
            role: node.type === 'llm_response' ? 'assistant' : 'assistant',
            content: this.generateContentFromNode(node),
            blockMetadata: {
                id: node.id,
                type: this.mapNodeTypeToBlockType(node.type),
                level: node.level,
                parentId: node.parentId,
                children: node.childrenIds,
                isExpanded: true,
                visualState: node.status,
                executionContext: {
                    toolName: node.name,
                    timestamp: node.startTime || new Date(),
                    duration: node.actualDuration
                },
                renderData: {
                    parameters: node.actualParameters,
                    result: node.actualResult
                }
            }
        };
    }
}
```

### **2.2 RealTimeBlockMetadata 확장 - 실제 데이터 필드 추가**

#### 파일: `apps/web/src/lib/playground/block-tracking/types.ts`
```typescript
// 기존 BlockMetadata 확장 (Breaking Change 없음)
export interface RealTimeBlockMetadata extends BlockMetadata {
    // 실제 실행 정보
    startTime?: Date;           // 실제 시작 시간
    endTime?: Date;             // 실제 완료 시간
    actualDuration?: number;    // 실제 소요 시간 (ms)
    toolParameters?: any;       // 실제 입력 파라미터
    toolResult?: any;           // 실제 출력 결과
    
    // 계층적 실행 정보
    executionHierarchy?: {
        parentId?: string;
        rootId?: string;
        level: number;
        path: string[];
    };
    
    // Tool이 제공하는 추가 정보 (선택사항)
    toolProvidedData?: {
        estimatedDuration?: number;
        executionSteps?: ToolExecutionStep[];
        currentStep?: string;
    };
}
```

### **2.3 RealTimeTrackingHooks 구현 - 실제 데이터만 추적**

#### 파일: `apps/web/src/lib/playground/block-tracking/real-time-hooks.ts` (새 파일)
```typescript
export function createRealTimeTrackingHooks(
    executionSubscriber: ExecutionSubscriber,
    logger: SimpleLogger = SilentLogger
): ToolHooks {
    return {
        async beforeExecute(toolName: string, parameters: any, context?: ToolExecutionContext): Promise<void> {
            // 실제 시작 시점만 기록 (시뮬레이션 없음)
            const startTime = new Date();
            
            logger.debug('Real-time tracking: Tool execution started', {
                toolName,
                startTime,
                parameters,
                executionLevel: context?.executionLevel,
                parentExecutionId: context?.parentExecutionId
            });
            
            // SDK의 ExecutionTrackingPlugin에 알림
            // (실제 구현에서는 EventEmitter를 통해 전달)
        },

        async afterExecute(toolName: string, parameters: any, result: any, context?: ToolExecutionContext): Promise<void> {
            const endTime = new Date();
            const startTime = context?.realTimeData?.startTime || endTime;
            const actualDuration = endTime.getTime() - startTime.getTime();
            
            logger.debug('Real-time tracking: Tool execution completed', {
                toolName,
                endTime,
                actualDuration,
                result
            });
            
            // 실제 완료 정보만 기록
            // LLM 응답 블록 자동 생성 (실제 시작 시점)
            this.createLLMResponseBlock(result, parameters, context);
        }
    };
}
```

### **2.4 LLM 응답 추적 시스템 - 실제 응답 감지**

#### 파일: `apps/web/src/lib/playground/llm-tracking/llm-tracker.ts` (새 파일)
```typescript
export class RealTimeLLMTracker {
    constructor(
        private blockCollector: PlaygroundBlockCollector,
        private conversationHistory: ConversationHistoryManager
    ) {
        // Agent의 실제 메시지 추가 이벤트 감지
        this.conversationHistory.on('messageAdded', this.onMessageAdded.bind(this));
    }
    
    createLLMResponseBlock(toolResult: any, toolParameters: any, toolContext?: ToolExecutionContext): string {
        const llmBlockId = generateBlockId();
        
        // LLM 응답 블록 생성 (실제 시작 시점)
        const llmBlock: BlockMessage = {
            role: 'assistant',
            content: '🔄 LLM 응답 생성 중...',
            blockMetadata: {
                id: llmBlockId,
                type: 'assistant',
                level: (toolContext?.executionLevel || 0) + 1,
                parentId: toolContext?.parentExecutionId,
                children: [],
                isExpanded: true,
                visualState: 'in_progress',
                executionContext: {
                    toolName: 'llm_response',
                    timestamp: new Date()
                },
                renderData: {
                    inputData: {
                        toolResult,
                        toolParameters,
                        userMessage: this.getUserMessage(toolContext)
                    }
                }
            }
        };
        
        this.blockCollector.collectBlock(llmBlock);
        return llmBlockId;
    }
    
    onMessageAdded(message: UniversalMessage) {
        if (message.role === 'assistant' && this.currentLLMBlockId) {
            // 실제 LLM 응답 완료 시점
            const endTime = new Date();
            const startTime = this.getLLMBlockStartTime(this.currentLLMBlockId);
            const actualDuration = endTime.getTime() - startTime.getTime();
            
            this.blockCollector.updateBlock(this.currentLLMBlockId, {
                visualState: 'completed',
                executionContext: {
                    duration: actualDuration,
                    timestamp: endTime
                },
                renderData: {
                    result: message.content
                }
            });
            
            this.currentLLMBlockId = null;
        }
    }
}
```

---

## 🎨 **Phase 3: UI 컴포넌트 향상 (1주) - 실제 데이터 시각화**

### **3.1 RealTimeToolBlock 컴포넌트 - 실제 데이터만 표시**

#### 파일: `apps/web/src/components/playground/real-time-tool-block.tsx` (새 파일)
```typescript
interface RealTimeToolBlockProps {
    metadata: RealTimeBlockMetadata;
}

export function RealTimeToolBlock({ metadata }: RealTimeToolBlockProps) {
    const formatDuration = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
    const formatTime = (date: Date) => date.toLocaleTimeString();
    
    return (
        <div className="real-time-tool-block">
            {/* 기본 헤더 */}
            <div className="tool-header">
                {metadata.visualState === 'in_progress' ? '🔄' : '✅'} 
                {metadata.executionContext?.toolName}
                
                {/* 계층적 정보 표시 */}
                {metadata.executionHierarchy && (
                    <span className="execution-path">
                        {metadata.executionHierarchy.path.join(' → ')}
                    </span>
                )}
            </div>
            
            {/* 실제 실행 정보만 표시 */}
            <div className="execution-info">
                {metadata.startTime && (
                    <div>시작: {formatTime(metadata.startTime)}</div>
                )}
                
                {metadata.visualState === 'in_progress' && metadata.startTime && (
                    <div>진행 중... (경과: {formatDuration(Date.now() - metadata.startTime.getTime())})</div>
                )}
                
                {metadata.visualState === 'completed' && (
                    <>
                        {metadata.endTime && (
                            <div>완료: {formatTime(metadata.endTime)}</div>
                        )}
                        {metadata.actualDuration && (
                            <div>소요 시간: {formatDuration(metadata.actualDuration)}</div>
                        )}
                    </>
                )}
            </div>
            
            {/* 실제 입력/출력 데이터 */}
            {metadata.toolParameters && (
                <div className="tool-input">
                    <strong>입력:</strong> {JSON.stringify(metadata.toolParameters)}
                </div>
            )}
            
            {metadata.toolResult && (
                <div className="tool-output">
                    <strong>결과:</strong> {JSON.stringify(metadata.toolResult)}
                </div>
            )}
            
            {/* Tool이 제공하는 추가 정보 (선택사항) */}
            {metadata.toolProvidedData?.estimatedDuration && (
                <div className="tool-estimates">
                    예상 소요 시간: {formatDuration(metadata.toolProvidedData.estimatedDuration)}
                </div>
            )}
        </div>
    );
}
```

### **3.2 기존 UI 시스템과 통합**

#### 파일: `apps/web/src/components/playground/block-renderer.tsx` (수정)
```typescript
// 기존 블록 렌더러에 새 컴포넌트만 추가
export function BlockRenderer({ block }: { block: BlockMessage }) {
    // 기존 로직 그대로...
    
    // 새로운 실시간 메타데이터가 있으면 새 컴포넌트 사용
    if (isRealTimeBlockMetadata(block.blockMetadata)) {
        return <RealTimeToolBlock metadata={block.blockMetadata} />;
    }
    
    // 기존 컴포넌트들 그대로 사용
    return <StandardBlockRenderer block={block} />;
}
```

### **3.3 실시간 업데이트 연동**

#### 기존 시스템 활용
- PlaygroundBlockCollector의 기존 listener 시스템 그대로 사용
- 실제 데이터 변경 시 자동 UI 업데이트
- 기존 React 상태 관리 시스템과 완벽 호환

---

## 📋 **Phase 4: RobotaExecutor 통합 (3일)**

### **4.1 기존 시스템과 통합**

#### 파일: `apps/web/src/lib/playground/robota-executor.ts` (수정)
```typescript
export class RobotaExecutor {
    private executionTrackingPlugin?: ExecutionTrackingPlugin;
    private executionSubscriber?: ExecutionSubscriber;
    
    async createTeam(config: PlaygroundTeamConfig): Promise<void> {
        // 기존 로직 그대로...
        
        // 선택적으로 실행 추적 활성화
        if (config.enableRealTimeTracking) {
            this.setupRealTimeTracking();
        }
        
        // 기존 toolHooks와 새 hooks 결합
        const combinedHooks = this.combineHooks(
            createAssignTaskHooks(this.historyPlugin),
            createRealTimeTrackingHooks(this.executionSubscriber)
        );
        
        this.currentTeam = createTeam({
            // 기존 옵션들 그대로...
            toolHooks: combinedHooks
        });
    }
    
    private setupRealTimeTracking() {
        // ExecutionTrackingPlugin 생성
        this.executionTrackingPlugin = new ExecutionTrackingPlugin();
        
        // ExecutionSubscriber 생성 (SDK → Web App 브리지)
        this.executionSubscriber = new ExecutionSubscriber(
            this.blockCollector,
            this.executionTrackingPlugin
        );
    }
    
    private combineHooks(...hookArrays: ToolHooks[]): ToolHooks {
        // 여러 hooks를 안전하게 결합
        return {
            async beforeExecute(toolName, parameters, context) {
                for (const hooks of hookArrays) {
                    await hooks.beforeExecute?.(toolName, parameters, context);
                }
            },
            async afterExecute(toolName, parameters, result, context) {
                for (const hooks of hookArrays) {
                    await hooks.afterExecute?.(toolName, parameters, result, context);
                }
            }
        };
    }
}
```

### **4.2 기존 API 호환성 100% 유지**

```typescript
// 기존 사용법 (변경 없음)
const executor = new RobotaExecutor(config);
await executor.createTeam({ /* 기존 옵션들 */ });

// 새 기능 활용 (선택사항)
await executor.createTeam({
    // 기존 옵션들 그대로...
    enableRealTimeTracking: true  // 새 옵션만 추가
});
```

---

## ✅ **최종 구현 보장사항**

### **1. 0% Breaking Change 확인**
- [ ] 모든 기존 테스트가 수정 없이 통과
- [ ] 기존 API 호출이 완전 동일하게 작동
- [ ] 기존 UI 컴포넌트들이 그대로 작동

### **2. 실제 데이터만 사용 확인**
- [ ] 시뮬레이션이나 가짜 데이터 일체 사용 안 함
- [ ] 실제 Tool 시작/완료 시간만 표시
- [ ] 실제 입력/출력 데이터만 기록

### **3. SDK 철학 준수 확인**
- [ ] 모든 새 기능이 선택적으로 활성화
- [ ] 명시적 구성을 통한 기능 제어
- [ ] 표준 플러그인 시스템 사용
- [ ] 의존성 주입 패턴 준수

### **4. 성능 영향 최소화**
- [ ] 기존 실행 성능에 영향 없음
- [ ] 새 기능은 선택적 활성화시에만 동작
- [ ] 메모리 사용량 증가 최소화

이 접근법으로 **SDK의 핵심을 약간만 향상**시켜서 **훨씬 더 강력하고 정확한 추적 시스템**을 만들 수 있습니다! 🎯 