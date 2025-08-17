# 🔄 React-Flow 통합 시스템 설계

## 📋 프로젝트 개요

현재 Mermaid 다이어그램으로 워크플로우를 시각화하고 있는 시스템을 확장하여, **중간 단계 데이터 구조**를 만들고 이를 기반으로 **React-Flow의 nodes + edges 형태**로 변환하는 기능을 개발합니다.

## 🎯 목표

1. **중간 데이터 구조 설계**: 워크플로우를 범용적으로 표현할 수 있는 데이터 구조
2. **React-Flow 변환기 개발**: 중간 데이터 → React-Flow nodes/edges 변환
3. **기존 Mermaid 시스템 유지**: 기존 기능은 그대로 유지하면서 확장

## 📊 React-Flow 데이터 구조 분석 (v12.8.2 기준)

### **Node 구조 (v12 호환)**
```typescript
// @xyflow/react v12.8.2 호환 Node 인터페이스
interface ReactFlowNode {
  id: string;                    // 고유 식별자
  type?: string;                 // 노드 타입 (default, input, output, custom)
  position: { x: number; y: number }; // 위치 좌표
  data: {                        // 노드 데이터
    label: string;               // 표시될 텍스트
    [key: string]: any;          // 추가 커스텀 데이터
  };
  
  // v12 신규 필드들
  measured?: {                   // 측정된 크기 (v12 신규)
    width?: number;
    height?: number;
  };
  width?: number;                // 사전 정의 너비 (SSR 지원)
  height?: number;               // 사전 정의 높이 (SSR 지원)
  origin?: [number, number];     // 노드 원점 (v12 신규)
  
  // 기존 필드들
  style?: CSSProperties;         // 스타일링
  className?: string;            // CSS 클래스
  sourcePosition?: Position;     // 연결점 위치
  targetPosition?: Position;     // 연결점 위치
  hidden?: boolean;              // 숨김 여부
  selected?: boolean;            // 선택 상태
  draggable?: boolean;           // 드래그 가능 여부
  selectable?: boolean;          // 선택 가능 여부 (v12 신규)
  deletable?: boolean;           // 삭제 가능 여부 (v12 신규)
  parentId?: string;             // 부모 노드 ID (v12 신규)
}
```

### **Edge 구조 (v12 호환)**
```typescript
// @xyflow/react v12.8.2 호환 Edge 인터페이스
interface ReactFlowEdge {
  id: string;                    // 고유 식별자
  source: string;                // 시작 노드 ID
  target: string;                // 종료 노드 ID
  type?: string;                 // 엣지 타입 (default, straight, step, smoothstep)
  sourceHandle?: string;         // 시작 핸들 ID
  targetHandle?: string;         // 종료 핸들 ID
  
  // v12 신규 필드들
  reconnectable?: boolean | 'source' | 'target'; // 재연결 가능 여부 (v12 신규)
  focusable?: boolean;           // 포커스 가능 여부 (v12 신규)
  deletable?: boolean;           // 삭제 가능 여부 (v12 신규)
  
  // 기존 필드들
  label?: string | ReactNode;    // 엣지 라벨
  labelStyle?: CSSProperties;    // 라벨 스타일
  labelShowBg?: boolean;         // 라벨 배경 표시
  labelBgStyle?: CSSProperties;  // 라벨 배경 스타일
  labelBgPadding?: [number, number]; // 라벨 배경 패딩
  labelBgBorderRadius?: number;  // 라벨 배경 모서리
  style?: CSSProperties;         // 엣지 스타일
  className?: string;            // CSS 클래스
  animated?: boolean;            // 애니메이션 여부
  hidden?: boolean;              // 숨김 여부
  selected?: boolean;            // 선택 상태
  data?: Record<string, any>;    // 커스텀 데이터
}
```

## 🏗️ 아키텍처 설계

### **1단계: 중간 데이터 구조 (UniversalWorkflowStructure)**

```typescript
// 도메인 중립적인 워크플로우 표현
interface UniversalWorkflowStructure {
  __workflowType: 'UniversalWorkflowStructure';
  nodes: UniversalWorkflowNode[];
  edges: UniversalWorkflowEdge[];
  layout: UniversalLayoutConfig;
  visualState: UniversalVisualState;
  metadata: UniversalWorkflowMetadata;
}

interface UniversalWorkflowNode {
  id: string;
  type: WorkflowNodeType;  // 'agent' | 'tool_call' | 'response' 등
  position: UniversalPosition;
  data: UniversalNodeData;
  metadata: UniversalNodeMetadata;
}

interface UniversalWorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: WorkflowConnectionType;  // 'processes' | 'executes' | 'return' 등
  data: UniversalEdgeData;
  metadata: UniversalEdgeMetadata;
}
```

### **2단계: React-Flow 변환기**

```typescript
// SDK 내부 WorkflowStructure → Universal → React-Flow 변환 체인
class UniversalToReactFlowConverter extends BaseWorkflowConverter<
  UniversalWorkflowStructure,
  ReactFlowData
> {
  async convert(
    universal: UniversalWorkflowStructure,
    options?: ReactFlowConversionOptions
  ): Promise<WorkflowConversionResult<ReactFlowData>> {
    // Universal → React-Flow 변환 로직
  }
}
```

### **3단계: 실시간 통합**

```typescript
// 기존 RealTimeWorkflowBuilder 확장
class RealTimeWorkflowBuilder {
  // 기존 Mermaid 기능 유지
  generateMermaidDiagram(): string { ... }
  
  // 새로운 React-Flow 기능 추가
  generateReactFlowData(): ReactFlowData { ... }
  generateUniversalStructure(): UniversalWorkflowStructure { ... }
}
```

## 🎨 노드 타입 정의

### **현재 SDK 노드 타입 (도메인 중립)**
```typescript
export const WORKFLOW_NODE_TYPES = {
  USER_INPUT: 'user_input',
  AGENT: 'agent',
  AGENT_THINKING: 'agent_thinking',
  TOOL_CALL: 'tool_call',
  TOOL_CALL_RESPONSE: 'tool_call_response',
  RESPONSE: 'response',
  MERGE_RESULTS: 'merge_results'
} as const;
```

### **React-Flow 커스텀 노드 매핑**
```typescript
const NODE_TYPE_MAPPING = {
  'user_input': 'inputNode',
  'agent': 'agentNode',
  'agent_thinking': 'thinkingNode',
  'tool_call': 'toolNode',
  'tool_call_response': 'responseNode',
  'response': 'outputNode',
  'merge_results': 'mergeNode'
} as const;
```

## 🔄 연결 타입 정의

### **현재 SDK 연결 타입**
```typescript
export const WORKFLOW_CONNECTION_TYPES = {
  RECEIVES: 'receives',        // User Input → Agent
  PROCESSES: 'processes',      // Agent → Thinking
  EXECUTES: 'executes',        // Thinking → Tool Call
  RESULT: 'result',           // Tool Call → Tool Response
  RETURN: 'return',           // Response → Agent
  CONSOLIDATES: 'consolidates' // Tool Response → Merge Results
} as const;
```

### **React-Flow 엣지 스타일 매핑**
```typescript
const EDGE_STYLE_MAPPING = {
  'receives': { type: 'smoothstep', style: { stroke: '#3b82f6' } },
  'processes': { type: 'default', style: { stroke: '#10b981' } },
  'executes': { type: 'straight', style: { stroke: '#f59e0b' } },
  'result': { type: 'smoothstep', style: { stroke: '#8b5cf6' } },
  'return': { type: 'default', style: { stroke: '#ef4444' } },
  'consolidates': { type: 'step', style: { stroke: '#6b7280' } }
} as const;
```

## 🎯 현재 연결 문제 해결 우선순위

### **1. Tool Response → Merge Results 연결 복구**
- 현재 `connectedToolResponses` 배열이 비어있는 문제
- `toolResponsesByExecution` Map의 key 불일치 문제
- 이벤트 순서 문제 (merge_results가 tool_response보다 먼저 생성)

### **2. Agent Numbering System 활성화**
- Agent 메타데이터에 `agentNumber` 설정
- `AgentCopyManager` 활용
- Agent Standard Structure 구현

### **3. Agent Integration Instance 패턴**
- Agent 0 Copy 노드 생성
- 교차 연결 방지
- 선형 워크플로우 구조 보장

## 🔧 구현 전략

### **Phase 1: 기본 연결 문제 해결**
1. SDK 레벨에서 Tool Response 연결 수정
2. 중복 노드 제거
3. 기본 워크플로우 구조 안정화

### **Phase 2: React-Flow 변환기 구현**
1. Universal 데이터 구조 완성
2. React-Flow 변환기 개발
3. 레이아웃 엔진 통합

### **Phase 3: 실시간 시각화**
1. React-Flow 컴포넌트 개발
2. 실시간 업데이트 시스템
3. 인터랙션 기능 구현

## 🎨 시각화 목표

### **현재 상태 (Playground)**
- Mermaid 다이어그램으로 기본 시각화
- 정적 노드 배치
- 제한된 인터랙션

### **목표 상태 (React-Flow)**
- 동적 노드 배치 및 드래그 가능
- 실시간 워크플로우 업데이트
- 노드별 상세 정보 표시
- 워크플로우 진행 상태 애니메이션
- 커스텀 노드 스타일링

---

**문서 업데이트**: 2025-01-08  
**상태**: 🔄 설계 완료, 구현 대기  
**다음 단계**: 워크플로우 연결 문제 해결 후 React-Flow 통합 진행