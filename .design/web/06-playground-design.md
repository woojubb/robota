# Playground 현재 구현 상태

## 📊 **구현 완료 상태**
- **Block Coding System**: 100% 완료 ✅
- **Universal Hook System**: 100% 완료 ✅
- **Real-time Visualization**: 100% 완료 ✅
- **Team Basic Support**: 100% 완료 ✅

---

## 🎯 **현재 Playground Architecture**

### **핵심 특징**
- **Visual Configuration**: 코드 대신 UI로 Agent/Team 설정
- **Block Coding Visualization**: 실시간 블록 스타일 대화 시각화
- **Universal Hook Integration**: 모든 Tool 자동 블록 추적
- **Three-Panel Layout**: Configuration / Chat / Block Visualization

### **Three-Panel Layout (구현됨)**
```
┌─────────────────┬─────────────────┬─────────────────┐
│ Configuration   │ Chat Interface  │ Block           │
│ Panel           │                 │ Visualization   │
│                 │                 │                 │
│ ✅ Agent Setup │ ✅ Real-time   │ ✅ Hierarchical│
│ ✅ Team Setup  │    Chat         │    Block Tree   │
│ ✅ Play/Stop   │ ✅ Streaming   │ ✅ Statistics  │
│    Controls     │    Support      │ ✅ Debug Info  │
└─────────────────┴─────────────────┴─────────────────┘
```

---

## 🧩 **Block System Implementation**

### **Block Types (구현됨)**
```typescript
// 실제 구현된 Block 타입들
type BlockType = 
  | 'user'        // 사용자 메시지 (파란색)
  | 'assistant'   // AI 응답 (초록색)  
  | 'tool_call'   // Tool 호출 (보라색)
  | 'tool_result' // Tool 결과 (주황색)
  | 'error'       // 에러 (빨간색)
  | 'system';     // 시스템 메시지 (회색)

interface BlockMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  blockMetadata: {
  id: string;
    type: BlockType;
    level: number;           // 중첩 레벨
    parentId?: string;       // 부모 블록 ID
    children: string[];      // 자식 블록 ID들
    isExpanded: boolean;     // 확장/축소 상태
    visualState: 'pending' | 'in_progress' | 'completed' | 'error';
    executionContext: {
      timestamp: Date;
      duration?: number;
      toolName?: string;
    };
  };
}
```

### **Real-time Block Updates (구현됨)**
```typescript
// 실시간 블록 업데이트 시스템
export class PlaygroundBlockCollector implements BlockDataCollector {
  private blocks: Map<string, BlockMessage> = new Map();
  private listeners: Set<BlockCollectionListener> = new Set();

  // 즉시 블록 생성
  createGroupBlock(type: BlockType, content: string, parentId?: string): BlockMessage {
    const blockId = this.generateBlockId();
    const groupBlock: BlockMessage = {
      role: 'system',
      content,
      blockMetadata: {
        id: blockId,
        type,
        level: parentId ? this.getParentLevel(parentId) + 1 : 0,
        parentId,
        children: [],
        isExpanded: true,
        visualState: 'pending',
        executionContext: { timestamp: new Date() }
      }
    };
    this.addBlock(groupBlock);
    return groupBlock;
  }

  // 실시간 블록 상태 업데이트
  updateBlock(blockId: string, updates: Partial<BlockMessage>): void {
    const block = this.blocks.get(blockId);
    if (block) {
      Object.assign(block, updates);
      this.notifyListeners({ type: 'block_updated', block });
    }
  }
}
```

---

## ⚡ **Hook System Integration**

### **Universal Tool Factory (구현됨)**
```typescript
// 모든 Tool에 블록 추적 자동 적용
export class UniversalToolFactory {
  constructor(
    private readonly blockCollector: BlockDataCollector,
    private readonly logger: SimpleLogger = SilentLogger
  ) {}

  createFunctionTool(schema: ToolSchema, fn: ToolExecutor): FunctionTool {
    const hooks = createBlockTrackingHooks(this.blockCollector, this.logger);
    return new FunctionTool(schema, fn, { hooks, logger: this.logger });
  }

  // 기존 Tool들을 Block Tracking 버전으로 자동 변환
  wrapExistingTools(tools: BaseTool<any, any>[]): BaseTool<any, any>[] {
    const hooks = createBlockTrackingHooks(this.blockCollector, this.logger);
    return tools.map(tool => this.wrapToolWithHooks(tool, hooks));
  }
}
```

### **Block Tracking Hooks (구현됨)**
```typescript
// Tool 실행을 자동으로 블록으로 변환
export function createBlockTrackingHooks(
  blockCollector: BlockDataCollector,
  logger?: SimpleLogger
): ToolHooks {
  return {
    async beforeExecute(toolName, parameters, context) {
      // Tool 호출 시작 블록 생성
      const startMessage: UniversalMessage = {
        role: 'system',
        content: `🔧 Starting ${toolName} execution`,
        timestamp: new Date().toISOString()
      };

      blockCollector.collectBlock(startMessage, {
        id: context?.executionId || generateId(),
        timestamp: Date.now(),
        type: 'system',
        status: 'pending'
      });
    },

    async afterExecute(toolName, parameters, result, context) {
      // Tool 완료 블록 업데이트
      const completionMessage: UniversalMessage = {
        role: 'system',
        content: `✅ ${toolName} completed successfully`,
        timestamp: new Date().toISOString()
      };

      blockCollector.collectBlock(completionMessage, {
        id: context?.executionId || generateId(),
      timestamp: Date.now(),
        type: 'system',
        status: 'completed'
      });
    },

    async onError(toolName, parameters, error, context) {
      // Tool 에러 블록 생성
      const errorMessage: UniversalMessage = {
        role: 'system',
        content: `❌ ${toolName} failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };

      blockCollector.collectBlock(errorMessage, {
        id: context?.executionId || generateId(),
      timestamp: Date.now(),
        type: 'system',
        status: 'error'
      });
    }
  };
}
```

---

## 🎨 **UI Components (구현됨)**

### **Block Visualization Panel**
```typescript
export const BlockVisualizationPanel: React.FC<{
  blockTracking: UseBlockTrackingResult;
}> = ({ blockTracking }) => {
  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="tree" className="h-full flex flex-col">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="tree">Tree View</TabsTrigger>
          <TabsTrigger value="raw">Raw Data</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
        </TabsList>
        
        <TabsContent value="tree" className="flex-1 overflow-hidden">
          <BlockTree blockCollector={blockTracking.blockCollector} />
        </TabsContent>
        
        <TabsContent value="raw" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <pre className="text-xs">
              {JSON.stringify(blockTracking.blocks, null, 2)}
            </pre>
          </ScrollArea>
        </TabsContent>
        
        <TabsContent value="stats" className="flex-1 overflow-hidden">
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{blockTracking.stats?.total || 0}</div>
                <div className="text-sm text-muted-foreground">Total Blocks</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold">{blockTracking.stats?.rootBlocks || 0}</div>
                <div className="text-sm text-muted-foreground">Root Blocks</div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
```

### **Block Node Component**
```typescript
export const BlockNode: React.FC<{
  block: BlockMessage;
  onToggleExpand?: (blockId: string) => void;
}> = ({ block, onToggleExpand }) => {
  const typeColors = {
    user: 'border-blue-400 bg-blue-50',
    assistant: 'border-green-400 bg-green-50',
    tool_call: 'border-purple-400 bg-purple-50',
    tool_result: 'border-orange-400 bg-orange-50',
    error: 'border-red-400 bg-red-50',
    system: 'border-gray-400 bg-gray-50'
  };

  const typeIcons = {
    user: MessageSquare,
    assistant: Bot,
    tool_call: Wrench,
    tool_result: CheckCircle,
    error: AlertCircle,
    system: Info
  };

  const TypeIcon = typeIcons[block.blockMetadata.type];

  return (
    <div className={`
      p-3 rounded border transition-all duration-200
      ${typeColors[block.blockMetadata.type]}
      ${block.blockMetadata.visualState === 'in_progress' ? 'animate-pulse' : ''}
    `}>
      <div className="flex items-center gap-2 mb-2">
        <TypeIcon className="h-4 w-4" />
        <Badge variant="outline" className="text-xs">
          {block.blockMetadata.type.replace('_', ' ')}
        </Badge>
        {block.blockMetadata.visualState === 'in_progress' && (
          <Loader2 className="h-3 w-3 animate-spin" />
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {block.blockMetadata.executionContext.timestamp.toLocaleTimeString()}
        </span>
      </div>
      
      <div className="text-sm whitespace-pre-wrap">
        {block.content}
      </div>
      
      {block.blockMetadata.children.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-6 px-2"
          onClick={() => onToggleExpand?.(block.blockMetadata.id)}
        >
          {block.blockMetadata.isExpanded ? (
            <>
              <ChevronDown className="h-3 w-3 mr-1" />
              Hide {block.blockMetadata.children.length} children
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3 mr-1" />
              Show {block.blockMetadata.children.length} children
            </>
          )}
        </Button>
      )}
    </div>
  );
};
```

---

## 🔄 **남은 작업**

### **우선순위 1: Team Stream 지원**
현재 Team Mode는 기본 실행만 지원하며, 스트리밍이 구현되지 않았습니다.

```typescript
// 현재 문제: TeamContainer.stream() 메서드 없음
class TeamContainer {
  async execute(prompt: string): Promise<string> { /* ✅ 동작 */ }
  // ❌ stream 메서드 필요
}
```

### **우선순위 2: Code Generation**
UI 설정을 실제 Robota 코드로 변환하는 시스템이 필요합니다.

```typescript
// 계획된 기능
class RobotaCodeGenerator {
  generateAgentCode(config: PlaygroundAgentConfig): string {
    // UI 설정 → 실제 Robota 코드 변환
  }
}
```

### **우선순위 3: Advanced Analytics**
더 상세한 성능 분석 및 통계 기능이 필요합니다.

---

## 🎯 **성과 및 혁신**

### **달성된 사용자 비전**
✅ **"블록코딩같이 구조를 보여줘"**
- 계층적 블록 구조로 Tool 호출과 결과 시각화
- 확장/축소 가능한 중첩 블록

✅ **"실행하면 채팅이 얼마나 오갔는지도 블럭코딩처럼 비주얼하게 보여줘"**
- 실시간 채팅 히스토리 블록 시각화
- 모든 Tool 호출 과정을 실시간 블록으로 표현

✅ **"내가 프롬프트를 입력하면 채팅 블록들이 실시간으로 업데이트 되면서 보이는게 이 플레이그라운드의 핵심 킥"**
- 사용자 입력 → 실시간 블록 생성 및 업데이트
- Tool 호출, 실행, 결과까지 모든 과정을 실시간 표시

### **기술적 혁신**
- **업계 최초**: 실시간 블록 코딩 스타일 AI 디버깅
- **Universal Hook Architecture**: 모든 Tool에 자동 적용되는 범용 Hook 시스템
- **Seamless Integration**: UI 설정이 실제 Robota Instance에 즉시 반영

**현재 Playground는 혁신적인 Block Coding 시각화를 통해 AI Agent 개발의 새로운 패러다임을 제시하고 있습니다.** 🚀✨ 

---

## 🧭 Playground 분리 설계 (apps/web 내부)

### 목표
- Playground 구현과 사용처(페이지)를 분리하여 재사용성과 유지보수성 향상
- `Workflow` 래퍼(뷰/어댑터)를 별도 폴더로 분리하여 의존성 방향성을 명확히 함
- Next.js 페이지는 분리된 컴포넌트를 import만 하도록 단순화

### 폴더 구조 제안 (apps/web/src)
```
app/
  playground/
    page.tsx                 # 페이지 진입: 분리된 PlaygroundApp만 import해서 렌더

playground/                  # Playground 기능(도메인 독립) 레이어
  core/                      # 타입/상수/어댑터(플랫폼 독립)
    types.ts
    constants.ts
    adapters/
      WorkflowAdapter.ts     # @robota-sdk/workflow 래퍼 인터페이스 (UI-agnostic)
  services/                  # 이벤트/브릿지/ATS 연동
    PlaygroundEventService.ts
    WorkflowBridgeService.ts # BridgeEventService/ATS 브릿지 책임
  state/                     # 상태관리(zustand/context)
    store.ts
    selectors.ts
  hooks/                     # UI 훅(서비스/상태 조합)
    usePlayground.ts
    useWorkflowSync.ts
  components/                # 프리젠테이션 컴포넌트
    PlaygroundApp.tsx        # 최상위 컴포넌트 (페이지에서 import)
    Canvas.tsx
    Sidebar.tsx
    Toolbar.tsx
    Panels/
      AgentsPanel.tsx
      ToolsPanel.tsx
      LogsPanel.tsx
  index.ts                   # 외부 공개 표면(PlaygroundApp 등 export)

workflow/                    # Workflow 뷰 & 래퍼(Playground와 분리)
  core/
    types.ts                 # 뷰에서 쓰는 워크플로우 표시용 타입
    adapters/
      SubscriberAdapter.ts   # WorkflowEventSubscriber ⟷ UI 뷰 데이터 변환 래퍼
  components/
    WorkflowView.tsx         # 그래프/플로우 캔버스 뷰
    NodeRenderers/
    EdgeRenderers/
  utils/
    converters.ts            # UniversalWorkflow ↔ 뷰 모델 변환 (소스-오브-트루스 불변)
  index.ts                   # 외부 공개 표면(WorkflowView 등 export)
```

### 마이그레이션 단계
1) 디렉터리 생성 및 진입점 분리
- `src/playground/`에 `components/PlaygroundApp.tsx` 추가, `src/workflow/`에 `components/WorkflowView.tsx` 추가
- 각 폴더 `index.ts`에서 필요한 컴포넌트/타입 export

2) 기존 Playground 코드 이동 (점진)
- `src/lib/playground/*` → 역할별로 `playground/core|services|state|hooks|components`로 이전
- 임시 호환: 필요한 경우 `lib/playground/index.ts`에서 신규 경로 re-export 후 점진 제거

3) Workflow 뷰/래퍼 분리
- Subscriber 직접 사용, Universal 변환, 노드/엣지 렌더링 등 뷰 관련 코드는 전부 `src/workflow/`로 이동
- `SubscriberAdapter.ts`에서 subscriber 이벤트를 UI 친화적 모델로 변환

4) Next.js 페이지 연결
```tsx
// apps/web/src/app/playground/page.tsx
import { PlaygroundApp } from '@/playground';
export default function PlaygroundPage() { return <PlaygroundApp />; }
```

### 레이어 원칙
- 의존성 방향: playground → workflow(뷰) 사용은 가능, 뷰는 playground 서비스 구현에 의존 금지(단방향)
- 정적 import만 허용(동적 import 금지), 이벤트명은 상수 사용(하드코딩 금지)
- Path-Only / 소스-오브-트루스: 변환은 뷰 모델만 만들고 원본 순서/타임스탬프/간선은 변경 금지

### 성공 기준
- `app/playground/page.tsx`는 `PlaygroundApp`만 import
- Playground 구현(services/state/hooks)과 Workflow 뷰(components) 분리 완료
- 기존 `lib/playground` 참조 제거, 신규 레이어로 대체