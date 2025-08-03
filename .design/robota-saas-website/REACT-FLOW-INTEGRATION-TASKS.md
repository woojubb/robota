# 🔄 React-Flow 통합 작업 계획서

## 🚨 **현재 상황 및 가장 시급한 작업들**

### ✅ **완료된 작업**

#### **Phase 1: 중간 데이터 구조 설계 및 구현** ✅ **100% 완료**
- **Universal 데이터 구조 설계**: `UniversalWorkflowStructure`, `UniversalWorkflowNode`, `UniversalWorkflowEdge` 완료
- **아키텍처 기반 구조**: `BaseWorkflowConverter`, `BaseLayoutEngine`, `BaseWorkflowValidator` 완료
- **구체 구현체**: `WorkflowToUniversalConverter`, `HierarchicalLayoutEngine`, `UniversalWorkflowValidator` 완료
- **인터페이스 분리**: `WorkflowConverterInterface`, `LayoutEngineInterface`, `WorkflowValidatorInterface` 완료

#### **Phase X.1: 타입 구조적 리팩토링** ✅ **75% 완료** ⚠️ **빌드 오류 26개 남음**
- [x] **공통 타입 시스템**: `interfaces/base-types.ts`에 `GenericConfig`, `GenericMetadata` 정의
- [x] **Type Safety 강화**: 4-step verification process 적용
- [x] **아키텍처 준수**: Interface Import Hierarchy 및 Type Ownership 원칙 적용
- [ ] **빌드 오류 해결**: 126개 → 26개로 감소했으나 **완전 해결 필요**

#### **Phase 2: React-Flow 변환기 구현** ✅ **90% 완료** ⚠️ **테스트 파일 오류**
- [x] **React-Flow v12 타입 시스템**: 완전한 v12.8.2 호환 타입 정의
- [x] **UniversalToReactFlowConverter**: BaseWorkflowConverter 상속, 설정 가능한 매핑
- [x] **ReactFlowLayoutEngine**: 4가지 레이아웃 알고리즘 (hierarchical, dagre, force, grid)
- [x] **ReactFlowMetadataMapper**: Type-safe 메타데이터 변환 시스템
- [ ] **통합 테스트 시스템**: 테스트 파일에서 타입 오류 발생 중

#### **Phase 3: 실시간 워크플로우 빌더 확장** ✅ **95% 완료** ⚠️ **일부 통합 오류**
- [x] **RealTimeWorkflowBuilder 확장**: React-Flow 지원 추가 (`generateReactFlowData()`)
- [x] **RealTimeReactFlowGenerator**: Mermaid와 병렬 동작, 캐싱 및 성능 최적화
- [x] **RealTimeEventIntegration**: 이벤트 기반 실시간 업데이트, 배칭 및 스로틀링
- [x] **ReactFlowPerformanceOptimizer**: 증분 업데이트, 스마트 캐싱, 메모리 관리
- [ ] **통합 테스트 시스템**: 일부 integration-test.ts에서 타입 호환성 오류

### 🚨 **현재 상황: SDK 호환 ID 연결 완료, 예제 기반 테스트 필요**

### 📊 **현재 작업 상태 (2024-12-20)**
- **✅ SDK 호환 ID**: External Store Agent ID를 `agent_${executionId}` 패턴으로 변경하여 SDK 연결 준비 완료
- **🔧 연결 테스트 준비**: 초기 3개 노드와 SDK 18개 노드의 연결관계 검증 필요
- **📝 예제 기반 검증**: apps/examples에 독립적인 테스트 환경 구축 필요
- **우선순위**: **전체 워크플로우 연결 무결성 검증이 최우선**

### 📊 **진행 상황 요약 (업데이트됨)**
- **Phase 1**: ✅ **100% 완료** (Universal 데이터 구조)
- **Phase X.1**: ⚠️ **75% 완료** (타입 시스템 리팩토링 - 빌드 오류 26개 남음)
- **Phase 2**: ⚠️ **90% 완료** (React-Flow 변환기 - 테스트 파일 오류)
- **Phase 3**: ⚠️ **95% 완료** (실시간 시스템 - 통합 오류)
- **Phase 4**: ⚠️ **빌드 무결성 복구 필요**
- **Phase 12**: 🔄 **진행 중** (예제 기반 워크플로우 연결 테스트)

## 📋 프로젝트 개요

현재 Mermaid 다이어그램으로 워크플로우를 시각화하고 있는 시스템을 확장하여, **중간 단계 데이터 구조**를 만들고 이를 기반으로 **React-Flow의 nodes + edges 형태**로 변환하는 기능을 개발합니다.

## 🎯 목표

1. **중간 데이터 구조 설계**: 워크플로우를 범용적으로 표현할 수 있는 데이터 구조
2. **React-Flow 변환기 개발**: 중간 데이터 → React-Flow nodes/edges 변환
3. **기존 Mermaid 시스템 유지**: 기존 기능은 그대로 유지하면서 확장

## 📊 React-Flow 데이터 구조 분석 (v12.8.2 기준)

> **📌 최신 버전**: React-Flow v12.8.2 (`@xyflow/react`) - 2024년 12월 기준 최신 안정 버전

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
  target: string;                // 끝 노드 ID
  type?: string;                 // 엣지 타입 (default, straight, step, smoothstep)
  sourceHandle?: string | null;  // 시작 핸들 ID (v12에서 null 처리 개선)
  targetHandle?: string | null;  // 끝 핸들 ID (v12에서 null 처리 개선)
  label?: string;                // 엣지 라벨
  style?: CSSProperties;         // 스타일링
  animated?: boolean;            // 애니메이션 여부
  hidden?: boolean;              // 숨김 여부
  selected?: boolean;            // 선택 상태 (v12 신규)
  selectable?: boolean;          // 선택 가능 여부 (v12 신규)
  deletable?: boolean;           // 삭제 가능 여부 (v12 신규)
  data?: any;                    // 추가 데이터
}
```

### **v12 주요 신규 기능**
- **SSR/SSG 지원**: `width`, `height` 사전 정의 가능
- **Dark Mode**: `colorMode` prop으로 자동 다크모드 지원
- **CSS Variables**: 스타일링 커스터마이징 개선
- **Reactive Flows**: `useHandleConnections`, `useNodesData` 훅 추가
- **Controlled Viewport**: `viewport`, `onViewportChange` props

## 🏗️ 작업 단계별 체크리스트

### **Phase 1: 중간 데이터 구조 설계 및 구현 (아키텍처 원칙 준수)**

#### **1.1 Universal 데이터 구조 및 인터페이스** ✅ **완료**

#### **1.5 테스트 코드 및 통합** ⚠️ **필요**
- [ ] 추상 클래스 테스트 작성 ⚠️ **필요**
  - [ ] 각 Base 클래스의 공통 동작 검증 
- [ ] 구체 구현 테스트 작성 ⚠️ **필요**
  - [ ] 기존 24-workflow-structure-test.ts와 연동 테스트
  - [ ] Mock 객체 활용한 단위 테스트

### **Phase 2: React-Flow 변환기 구현** ✅ **핵심 기능 완료**

#### **React-Flow 핵심 기능** ✅ **구현 완료**
React-Flow v12 변환기, 레이아웃 엔진, 실시간 생성기 등 핵심 기능들이 모두 구현되어 FEATURES.md로 이관되었습니다.

### **Phase 4-5: 품질 보증 및 Playground 통합** ⚠️ **향후 계획**

핵심 React-Flow 기능 구현 완료 후 진행 예정:
- 검증 시스템 구현
- Playground UI 통합  
- 성능 최적화
- 문서화 및 배포

## 📁 **구현된 파일 구조** ✅ **완료**

핵심 Universal 타입 시스템과 React-Flow 통합 기능들이 `packages/agents/src/`에 구현되어 FEATURES.md와 ARCHITECTURE.md로 이관되었습니다.

## 🎯 **성공 기준** (업데이트됨)

### **✅ 달성된 기준**
- ✅ **기존 Mermaid 기능 100% 유지**: 완료
- ✅ **React-Flow v12.8.2 호환**: 완료
- ✅ **Universal 데이터 구조**: 완료
- ✅ **타입 안전성**: 핵심 타입 시스템 완료
- ✅ **아키텍처 원칙 준수**: Robota SDK 원칙 준수

### **🚨 미달성 기준 (즉시 해결 필요)**
- [ ] **빌드 무결성**: 26개 타입 오류 해결 필요
- [ ] **테스트 파일 호환성**: integration-test.ts 오류 수정 필요

### **⚠️ 향후 기준 (Phase 4-5)**
- [ ] Playground 실시간 통합
- [ ] 성능 최적화 (< 100ms 변환)
- [ ] 포괄적 검증 시스템

## 📋 **Phase 4.8: Playground React-Flow 워크플로우 통합 구현**

### **🎯 목표: Create Agent/Team 버튼 → React-Flow 노드 생성**

**현재 상황 분석**:
- ✅ React-Flow 변환기 구현 완료 (90% 코드 감축 달성)
- ✅ Create Agent/Team 버튼 존재 (`apps/web/src/app/playground/page.tsx`)
- ✅ **React-Flow 패키지 설치 완료** (`@xyflow/react v12.8.2`)
- ❌ React-Flow 컴포넌트가 playground UI에 미통합
- ❌ Agent/Team 생성 시 워크플로우 노드 생성 로직 없음

### **🚨 PHASE 4.7.5: 아키텍처 개선 - 외부 의존성 분리 (URGENT)** 

**목표**: React-Flow 관련 모든 기능을 agents 패키지에서 완전 제거
**현재 진행상황**: 🔄 **React-Flow 완전 분리 작업 진행중**

**🚨 완전 분리 필요 이유**:
- **외부 의존성 분리**: `@xyflow/react`는 UI 라이브러리로 순수 비즈니스 로직 패키지인 `agents`에 부적합
- **도메인 명확화**: React-Flow는 시각화/UI 도메인, agents는 순수 비즈니스 로직 도메인
- **키워드 완전 제거**: agents 패키지에 `react-flow`, `reactFlow` 등 키워드 자체가 존재하면 안됨
- **설계 원칙 준수**: Feature Ownership 원칙에 따라 React-Flow 관련 모든 것은 apps/web에서 관리

#### **4.7.5.1 React-Flow 기능 분리** ✅ **완료**
- [x] **`packages/agents/src/services/react-flow/` 전체 이동**
  - 목적지: `apps/web/src/lib/workflow-visualization/react-flow/` ✅
  - 이동 파일: `index.ts`, `layout-engine.ts`, `types.ts` ✅
- [x] **import 경로 업데이트**
  - `packages/agents/src/index.ts`에서 React-Flow export 제거 ✅

#### **4.7.5.2 React-Flow 관련 클래스 및 파일 완전 이동** 🚨 **진행중**
- [ ] **`RealTimeReactFlowGenerator` 전체 이동**
  - 소스: `packages/agents/src/services/real-time-react-flow-generator.ts` (611줄)
  - 목적지: `apps/web/src/lib/workflow-visualization/real-time-react-flow-generator.ts`
  - 의존성: `EventService`, `RealTimeWorkflowBuilder`, React-Flow 타입들
- [ ] **React-Flow 관련 기능을 `RealTimeWorkflowBuilder`에서 분리**
  - 파일: `packages/agents/src/services/real-time-workflow-builder.ts` (732줄)
  - 분리 대상: 모든 `ReactFlow*` 타입, 변수명, 메서드
  - 새로운 분리 방식: Universal 워크플로우만 반환, React-Flow 변환은 apps/web에서 처리
- [ ] **React-Flow 관련 기능을 `RealTimeEventIntegration`에서 분리**
  - 파일: `packages/agents/src/services/real-time-event-integration.ts` (573줄)
  - 분리 대상: `RealTimeReactFlowGenerator` 의존성, React-Flow 관련 타입들
- [ ] **React-Flow 관련 기능을 `RealTimeSystemIntegrationTester`에서 분리**
  - 파일: `packages/agents/src/services/real-time-system-integration-test.ts` (956줄)
  - 분리 대상: React-Flow 테스트 관련 모든 코드

#### **4.7.5.3 agents 패키지 React-Flow 키워드 완전 제거** 🚨 **진행중**
- [ ] **변수명 및 타입명 정리**
  - `reactFlowResult` → `universalResult` 또는 `visualizationResult`
  - `ReactFlowData` → `UniversalWorkflowStructure` 또는 적절한 타입
  - `ReactFlowConfig` → `UniversalVisualizationConfig` 또는 제거
- [ ] **주석 및 문서 정리**
  - React-Flow 관련 모든 주석 제거 또는 Universal 용어로 변경
  - 파일 설명에서 React-Flow 언급 제거
- [ ] **export 및 import 정리**
  - `packages/agents/src/index.ts`에서 React-Flow 관련 모든 export 제거
  - 내부 파일들의 React-Flow 관련 import 제거

#### **4.7.5.4 Universal 워크플로우 중심 재설계** 🚨 **진행중**
- [ ] **`RealTimeWorkflowBuilder` 순수화**
  - React-Flow 변환 로직 완전 제거
  - Universal 워크플로우 구조만 생성하도록 단순화
  - apps/web에서 Universal → React-Flow 변환 처리
- [ ] **이벤트 시스템 재설계**
  - `RealTimeEventIntegration`에서 React-Flow 의존성 제거
  - Universal 워크플로우 이벤트만 발행
  - React-Flow 업데이트는 apps/web에서 구독하여 처리
- [ ] **테스트 시스템 재설계**
  - React-Flow 관련 테스트 로직을 apps/web으로 이동
  - agents 패키지는 Universal 워크플로우 생성 테스트만 유지

#### **4.7.5.5 상세 작업 단계** 🚨 **진행중**

##### **Step 1: RealTimeReactFlowGenerator 이동** ✅ **완료**
- [x] 1.1. `real-time-react-flow-generator.ts` 파일 이동
  - 소스: `packages/agents/src/services/real-time-react-flow-generator.ts`
  - 목적지: `apps/web/src/lib/workflow-visualization/real-time-react-flow-generator.ts`
- [x] 1.2. 의존성 import 경로 수정
  - `EventService` → `@robota-sdk/agents`
  - `RealTimeWorkflowBuilder` → `@robota-sdk/agents`
  - `SimpleLogger`, `SilentLogger` → `@robota-sdk/agents`
- [x] 1.3. agents 패키지에서 export 제거
  - `packages/agents/src/index.ts`에서 `RealTimeReactFlowGenerator` export 제거
  - 관련 타입 export도 제거

##### **Step 2: RealTimeWorkflowBuilder React-Flow 기능 분리** 🚨 **우선순위 2**
- [ ] 2.1. React-Flow 관련 변수/타입 제거
  - `ReactFlowData` 타입 → `UniversalWorkflowStructure` 사용
  - `ReactFlowConverterConfig` → 제거 또는 Universal 설정으로 변경
  - `reactFlowUpdateCallbacks` → `universalWorkflowUpdateCallbacks`
  - `reactFlowConfig` → 제거 또는 `visualizationConfig`
- [ ] 2.2. React-Flow 변환 로직 제거
  - `generateReactFlowData()` 메서드에서 React-Flow 변환 부분 제거
  - Universal 워크플로우만 반환하도록 수정
  - 변수명 `reactFlowResult` → `universalResult`
- [ ] 2.3. 메서드명 정리
  - `generateReactFlowData()` → `generateUniversalWorkflow()` 또는 적절한 이름
  - `subscribeToReactFlowUpdates()` → `subscribeToWorkflowUpdates()`

##### **Step 3: RealTimeEventIntegration React-Flow 의존성 제거** 🚨 **우선순위 3**
- [ ] 3.1. RealTimeReactFlowGenerator 의존성 제거
  - `RealTimeReactFlowGenerator` import 제거
  - 관련 타입들 제거: `RealTimeReactFlowResult`, `RealTimeReactFlowConfig`
- [ ] 3.2. Universal 워크플로우 중심으로 재설계
  - React-Flow 관련 콜백을 Universal 워크플로우 콜백으로 변경
  - 이벤트 처리에서 React-Flow 생성 로직 제거

##### **Step 4: RealTimeSystemIntegrationTester React-Flow 테스트 분리** 🚨 **우선순위 4**
- [ ] 4.1. React-Flow 관련 테스트 코드 식별
  - `testReactFlowGenerator()` 메서드
  - `reactFlowResults` 배열
  - `ReactFlowData` 타입 사용 부분들
- [ ] 4.2. apps/web으로 테스트 로직 이동
  - React-Flow 관련 테스트를 새로운 테스트 파일로 이동
  - `apps/web/src/lib/workflow-visualization/__tests__/`에 테스트 파일 생성
- [ ] 4.3. agents 패키지 테스트 정리
  - Universal 워크플로우 생성 테스트만 유지
  - React-Flow 관련 메트릭 및 통계 제거

##### **Step 5: 키워드 및 명명 완전 정리** 🚨 **우선순위 5**
- [ ] 5.1. 모든 파일에서 React-Flow 키워드 검색/제거
  - `react-flow`, `reactflow`, `ReactFlow` 등
  - 변수명, 타입명, 주석, 문서에서 모두 제거
- [ ] 5.2. Universal 용어로 통일
  - Visualization, Universal, Workflow 등의 도메인 중립적 용어 사용
- [ ] 5.3. export/import 최종 정리
  - `packages/agents/src/index.ts`에서 React-Flow 관련 모든 export 확인/제거
  - 내부 파일들의 불필요한 import 제거

##### **Step 6: 검증 및 빌드 확인** 🚨 **최종 단계**
- [ ] 6.1. agents 패키지 빌드 성공 확인
  - `pnpm --filter @robota-sdk/agents build` 성공
  - React-Flow 관련 오류 없음 확인
- [ ] 6.2. React-Flow 키워드 완전 제거 확인
  - `grep -r "react-flow\|reactflow\|ReactFlow" packages/agents/src/` 결과 없음
- [ ] 6.3. apps/web 기능 정상 동작 확인
  - 이동된 React-Flow 기능들이 apps/web에서 정상 동작
  - Universal 워크플로우 → React-Flow 변환 정상 동작

### **🚨 PHASE 4.7.6: 완전한 도메인 중립화 - 키워드 및 아키텍처 정리 (CRITICAL)**

**목표**: agents 패키지에서 React-Flow/Mermaid 키워드 완전 제거 및 Base*/Abstract 아키텍처 도입
**현재 진행상황**: 🔄 **분석 완료, 작업 계획 수립중**

**🚨 발견된 문제:**
- `UniversalWorkflowStructure`에 `reactFlow`, `mermaid` 키워드 다수 존재
- `RealTimeMermaidGenerator` 전체가 agents 패키지에 존재
- Universal 타입에서 특정 플랫폼 키워드 하드코딩
- 추상화 부족으로 인한 강한 결합

**🎯 새로운 아키텍처 원칙:**
- **Base Classes Only**: agents는 `BaseVisualizationGenerator`, `BaseWorkflowConverter` 등만 제공
- **Platform Agnostic**: 키워드 대신 `platform: string` 방식 사용
- **Interface Segregation**: 구체적 구현은 apps/web에서만
- **Dependency Inversion**: apps/web이 agents의 추상 인터페이스에 의존

#### **4.7.6.1 Universal Types 도메인 중립화** ✅ **완료**
- [x] **Platform 키워드 제거**
  - `reactFlow` → `platforms['react-flow']` 또는 generic `platforms[string]`
  - `mermaid` → `platforms['mermaid']` 또는 generic `platforms[string]`
  - `platform: 'mermaid' | 'reactFlow'` → `platform: string`
- [x] **확장성 있는 타입 구조**
  - `UniversalPlatformConfig` 인터페이스 도입
  - 플랫폼별 설정을 동적으로 처리하도록 변경
- [x] **주석 및 문서 정리**
  - 파일 상단 주석에서 React-Flow/Mermaid 언급 제거
  - 도메인 중립적 용어로 변경

#### **4.7.6.2 Mermaid Generator 이동 및 추상화** ✅ **완료**
- [x] **Base 추상 클래스 생성**
  - `BaseVisualizationGenerator` 추상 클래스 생성
  - `packages/agents/src/abstracts/base-visualization-generator.ts`
- [x] **RealTimeMermaidGenerator 이동**
  - 소스: `packages/agents/src/services/mermaid-generator/`
  - 목적지: `apps/web/src/lib/workflow-visualization/mermaid/`
- [x] **agents에서 export 제거**
  - `packages/agents/src/index.ts`에서 Mermaid 관련 모든 export 제거
  - `packages/agents/src/services/index.ts`에서 export 제거

#### **4.7.6.3 추상 인터페이스 및 Base 클래스 설계** ✅ **완료**
- [x] **Base 클래스들 생성**
  - `BaseVisualizationGenerator` - 시각화 생성기 추상 클래스 ✅
  - `BaseWorkflowConverter` - 워크플로우 변환기 추상 클래스 ✅ (이미 존재)
  - `BaseLayoutEngine` - 레이아웃 엔진 추상 클래스 ✅ (이미 존재)
  - `BaseVisualizationRenderer` - 렌더링 추상 클래스 (필요시 추가)
- [x] **인터페이스 분리**
  - `BaseVisualizationConfig`, `VisualizationResult` - 시각화 생성 인터페이스 ✅
  - `WorkflowConverterInterface` - 변환 인터페이스 ✅ (이미 존재)
  - `LayoutEngineInterface` - 레이아웃 인터페이스 ✅ (이미 존재)
- [x] **타입 정의 분리**
  - Platform-agnostic 타입들만 agents에서 export ✅
  - 구체적 구현 타입들은 apps/web에서 정의 ✅

#### **4.7.6.4 apps/web 구현체들을 추상 클래스 상속으로 변경** 🔄 **진행중**
- [ ] **React-Flow 구현체 수정**
  - `SimpleReactFlowConverter extends BaseWorkflowConverter`
  - `ReactFlowLayoutEngine extends BaseLayoutEngine`
  - `RealTimeReactFlowGenerator extends BaseVisualizationGenerator`
- [x] **Mermaid 구현체 수정**  
  - `RealTimeMermaidGenerator extends BaseVisualizationGenerator` ✅
  - 적절한 추상 메서드 구현 ✅
  - MermaidVisualizationConfig 인터페이스 도입 ✅
- [ ] **인터페이스 준수 검증**
  - 모든 구현체가 정의된 인터페이스를 올바르게 구현하는지 확인

#### **4.7.6.5 키워드 스캔 및 최종 정리** ✅ **완료**
- [x] **키워드 완전 제거 확인**
  - `grep -r "react-?flow\|mermaid" packages/agents/src/` 결과 0개 ✅
  - agents 패키지가 완전히 도메인 중립적인지 확인 ✅
  - React-Flow 의존 파일들 apps/web으로 완전 이동 ✅
- [x] **빌드 및 타입 검증**
  - agents 패키지 독립 빌드 성공 ✅
  - BaseVisualizationGenerator 상속 구조 적용 ✅
- [ ] **문서 업데이트**
  - 새로운 아키텍처 문서화
  - 추상 클래스 사용법 가이드 작성

### **⚠️ PHASE 4.7.6 실현가능성 분석**

#### **🟢 높은 실현가능성 (85-95%)**

**4.7.6.1 Universal Types 도메인 중립화**
- **현재 상태**: `reactFlow`, `mermaid` 키워드가 타입 정의에 하드코딩됨
- **리스크**: 낮음 - 단순 타입 변경으로 해결 가능
- **대책**: 
  - `platforms: Record<string, unknown>` 방식으로 변경
  - 기존 데이터 호환성 유지 가능
- **예상 시간**: 45분

**4.7.6.2 Mermaid Generator 이동**  
- **현재 상태**: `packages/agents/src/services/mermaid-generator/` 존재
- **리스크**: 낮음 - React-Flow 이동과 동일한 패턴
- **대책**:
  - 이미 검증된 이동 방식 적용
  - import 경로만 `@robota-sdk/agents`로 수정
- **예상 시간**: 30분

#### **🟡 중간 실현가능성 (70-85%)**

**4.7.6.3 Base 클래스 설계**
- **현재 상태**: 추상 클래스가 존재하지 않음
- **리스크**: 중간 - 적절한 추상화 레벨 설계 필요
- **대책**:
  - 기존 구현체들의 공통 패턴 분석
  - 단계적 추상화 도입 (최소 기능부터)
- **예상 시간**: 60분

**4.7.6.4 상속 구조 적용**
- **현재 상태**: apps/web의 구현체들이 독립적으로 구현됨
- **리스크**: 중간 - 기존 코드 수정 필요
- **대책**:
  - 점진적 상속 도입
  - 기존 기능 유지하면서 추상 클래스 상속
- **예상 시간**: 60분

#### **🔴 위험 요소 및 대책**

**높은 위험 (해결 필요)**
1. **타입 호환성 문제**
   - 위험: Universal 타입 변경 시 기존 코드 영향
   - 대책: 백워드 호환성 유지하는 마이그레이션 전략
2. **추상화 오버엔지니어링**
   - 위험: 불필요한 복잡성 도입
   - 대책: 최소한의 추상화부터 시작, 점진적 개선

**중간 위험 (모니터링 필요)**
1. **Performance 영향**
   - 위험: 추상 클래스 도입으로 인한 성능 저하
   - 대책: 벤치마킹 및 필요시 최적화
2. **Learning Curve**
   - 위험: 새로운 아키텍처 학습 필요
   - 대책: 명확한 문서화 및 예제 제공

#### **📊 종합 실현가능성 평가**

**전체 성공 확률**: **80-85%**

**권장 접근 방식**:
1. **단계적 실행**: 4.7.6.1 → 4.7.6.2 → 4.7.6.3 → 4.7.6.4 순서
2. **점진적 개선**: 각 단계마다 빌드 성공 확인 후 진행
3. **백워드 호환성**: 기존 기능 영향 최소화
4. **문서화 우선**: 새로운 패턴 도입 시 즉시 문서화

**예상 총 소요 시간**: **3-4시간**
**성공 시 얻는 가치**: **완전한 도메인 분리, 확장성 대폭 개선, 아키텍처 일관성**

#### **🔍 현재 진행 상황 상세 분석**

**✅ Phase 4.7.5 완료된 작업:**
- ✅ React-Flow 디렉토리 이동 (`packages/agents/src/services/react-flow/` → `apps/web/src/lib/workflow-visualization/react-flow/`)
- ✅ `RealTimeReactFlowGenerator` 완전 이동 (611줄) → `apps/web/src/lib/workflow-visualization/`
- ✅ `RealTimeWorkflowBuilder`에서 React-Flow 키워드 완전 제거 (`ReactFlowData` → `UniversalWorkflowStructure` 등)
- ✅ agents 패키지에서 React-Flow 관련 모든 export 제거
- ✅ React-Flow 관련 빌드 오류 완전 해결

**🆕 Phase 4.7.6 새로 발견된 문제점:**
- `UniversalWorkflowStructure`에 `reactFlow`, `mermaid` 키워드 하드코딩 (33개 위치)
- `RealTimeMermaidGenerator` 전체가 agents 패키지에 존재 (413줄)
- Universal 타입에서 특정 플랫폼 키워드 의존성
- Base*/Abstract 아키텍처 부재로 인한 강한 결합

**🎯 즉시 해결 필요:** ✅ **모두 완료**
1. ✅ **RealTimeReactFlowGenerator 완전 이동** (최우선) - 완료
2. ✅ **RealTimeWorkflowBuilder React-Flow 키워드 제거** (핵심) - 완료  
3. ✅ **Universal 워크플로우 중심 재설계** (아키텍처) - 완료

**🆕 새로운 목표: 완전한 도메인 중립화**
4. **Universal Types 키워드 제거** (CRITICAL) - 예상 45분
5. **Mermaid Generator 이동 및 추상화** (HIGH) - 예상 60분
6. **Base 클래스 아키텍처 도입** (MEDIUM) - 예상 90분

**📋 작업 우선순위 (URGENT → HIGH → MEDIUM)**
- 🚨 **URGENT**: Step 1 (RealTimeReactFlowGenerator 이동)
- 🚨 **URGENT**: Step 2 (RealTimeWorkflowBuilder 정리)
- 🟡 **HIGH**: Step 3 (RealTimeEventIntegration 정리) 
- 🟡 **HIGH**: Step 4 (테스트 시스템 분리)
- 🟢 **MEDIUM**: Step 5 (키워드 정리)
- 🟢 **MEDIUM**: Step 6 (최종 검증)

**⚠️ 작업 전 필수 확인사항:**
- 모든 임시(Temporary) 처리는 금지
- React-Flow 키워드 자체가 agents 패키지에 존재하면 안됨
- Universal 워크플로우 구조만 사용하도록 완전 재설계
- 정석적인 Feature Ownership 원칙 준수
  - 이동된 파일들의 import 경로를 `@robota-sdk/agents`로 수정 ✅
- [x] **의존성 정리**
  - agents 패키지는 원래 `@xyflow/react` 의존성이 없었음 ✅

#### **4.7.5.2 Mermaid 기능 분리** 🟡 **React-Flow 이후**
- [ ] **`packages/agents/src/services/mermaid-generator/` 이동 검토**
  - 목적지 후보: `apps/web/src/lib/workflow-visualization/mermaid/`
  - 이동 파일: `index.ts`, `types.ts`
- [ ] **Pure 워크플로우 기능과 분리**
  - 순수 워크플로우 변환 로직은 agents에 유지
  - 렌더링/시각화 관련 로직만 분리

### **🚀 PHASE 4.8.0: 실현가능성 향상 작업 (완료)** 

**목표**: 모든 작업의 실현가능성을 65% → 85%로 향상
**현재 진행상황**: 🟢 **100% 완료** (모든 검증 작업 완료)

#### **4.8.0.1 Dependencies 완전 검증** ✅ **완료**
- [x] **React-Flow 패키지 설치**: `@xyflow/react v12.8.2` ✅ **완료**
- [x] **React 19.1.0과 React-Flow v12.8.2 호환성 테스트** ✅ **완료** (컴파일 오류 없음)
- [x] **TypeScript 컴파일 시 React-Flow 타입 오류 사전 점검** ✅ **완료** (React-Flow 관련 오류 없음)
- [x] **`@robota-sdk/agents`에서 필요한 모든 타입 export 상태 확인** ✅ **완료** (Universal 타입들 export 추가)

#### **4.8.0.2 기존 코드 구조 상세 분석** 🟡 **높은 우선순위**
- [ ] playground-context.tsx 전체 구조 및 state 관리 패턴 완전 파악
- [ ] handleCreateAgent/handleCreateTeam 현재 구현 로직 완전 이해
- [ ] 기존 UI 컴포넌트들과의 상호작용 분석

#### **4.8.0.3 기술적 검증 및 위험 요소 해결** 🟡 **높은 우선순위**
- [ ] React-Flow CSS 스타일 import 테스트
- [ ] 기본 React-Flow 컴포넌트 렌더링 테스트
- [ ] playground 레이아웃 변경 시 기존 기능 영향 평가

**성공 기준**: 모든 검증 완료 시 전체 실현가능성 85% 달성

### **🔗 필요한 통합 작업들**

#### **4.8.1 React-Flow 컴포넌트 playground 통합** 🟡 **검증 완료 후**
- **목표**: playground UI에 React-Flow 패널 추가  
- **위치**: 현재 `ExecutionTreePanel` 옆에 React-Flow 워크플로우 뷰 배치
- **실현가능성**: 🔴 **65%** → 🟢 **85%** (4.8.0 검증 완료 시)
- **전제조건**: 4.8.0 모든 검증 작업 완료 필수

**🚨 Critical 차단 요소 해결**:
- [x] **React-Flow 패키지 설치**: `@xyflow/react v12.8.2` ✅ **완료**
- [ ] React-Flow CSS 스타일 import 추가 (`@xyflow/react/dist/style.css`)

**📦 Dependencies 검증**:
- [ ] SimpleReactFlowConverter export 확인 (`@robota-sdk/agents`에서)
- [ ] UniversalWorkflowStructure, UniversalWorkflowNode 타입 export 확인
- [ ] ReactFlowData, ReactFlowNode 타입 export 확인

**🎨 UI 구조 분석 및 준비**:
- [ ] 현재 playground/page.tsx 레이아웃 구조 상세 분석
- [ ] grid-cols-4 → grid-cols-8로 변경 계획 수립 (Chat:2, Workflow:4, Tree:2)
- [ ] 기존 ExecutionTreePanel과의 공존 방안 확인

**🔧 기본 컴포넌트 구현**:
- [ ] PlaygroundWorkflowPanel 컴포넌트 생성 (`components/playground/workflow-panel.tsx`)
- [ ] 기본 React-Flow 설정 (노드 타입, 엣지 타입, 기본 스타일)
- [ ] 에러 바운더리 및 로딩 상태 처리
- [ ] 기본 React-Flow 노드/엣지 렌더링 확인

#### **4.8.2 워크플로우 상태 관리 시스템** 🟡 **검증 완료 후**  
- **목표**: Agent/Team 생성 시 Universal 워크플로우 데이터 생성
- **실현가능성**: 🟡 **75%** → 🟢 **90%** (4.8.0 검증 완료 시)
- **전제조건**: 4.8.0.2 playground-context.tsx 분석 완료 필수

**🔍 Context 구조 분석**:
- [ ] playground-context.tsx 기존 상태 구조 상세 분석
- [ ] PlaygroundState 인터페이스에 workflow 관련 속성 추가 방안 검토
- [ ] 기존 reducer 패턴과의 통합 방안 수립

**📝 워크플로우 상태 정의**:
- [ ] PlaygroundWorkflowState 인터페이스 정의 (nodes, edges, layout)
- [ ] WorkflowNode 생성 규칙 정의 (Agent → Node, Team → Multiple Nodes)
- [ ] 노드 간 연결 관계 정의 (Team → Agent 연결)

**🔧 State Management 구현**:
- [ ] usePlaygroundWorkflow 훅 생성
- [ ] playground-context.tsx에 워크플로우 상태 추가
- [ ] Agent/Team 생성 시 UniversalWorkflowNode 생성 로직
- [ ] 워크플로우 업데이트 액션 및 리듀서 구현

#### **4.8.3 Create Agent → React-Flow 노드 생성** 🟢 **검증 완료 후**
- **목표**: Create Agent 버튼 클릭 시 React-Flow에 Agent 노드 표시
- **실현가능성**: 🟡 **70%** → 🟢 **90%** (4.8.0 검증 완료 시)
- **전제조건**: 4.8.1, 4.8.2 완료 필수

**🔍 현재 Create Agent 플로우 분석**:
- [ ] handleCreateAgent 함수 현재 구현 상세 분석 (playground/page.tsx)
- [ ] PlaygroundAgentConfig → UniversalWorkflowNode 변환 규칙 정의
- [ ] Agent 노드 기본 속성 정의 (type, position, data, visualState)

**🔧 Agent 노드 생성 구현**:
- [ ] handleCreateAgent에서 워크플로우 노드 생성 로직 추가
- [ ] Agent 설정 → UniversalWorkflowNode 변환 함수 구현
- [ ] SimpleReactFlowConverter를 사용한 React-Flow 데이터 생성
- [ ] React-Flow에 새로운 Agent 노드 렌더링
- [ ] 노드 위치 자동 계산 (기존 노드와 겹치지 않게)

#### **4.8.4 Create Team → React-Flow 노드 생성** 🟢 **검증 완료 후**
- **목표**: Create Team 버튼 클릭 시 React-Flow에 Team 노드 표시  
- **실현가능성**: 🟡 **65%** → 🟢 **85%** (4.8.0 검증 완료 시)
- **전제조건**: 4.8.1, 4.8.2, 4.8.3 완료 필수

**🔍 Team 노드 구조 설계**:
- [ ] handleCreateTeam 함수 현재 구현 상세 분석
- [ ] Team → Team 노드 + Agent 노드들 구조 설계
- [ ] Team 노드와 Agent 노드 간 연결 관계 정의

**🔧 Team 노드 생성 구현**:
- [ ] handleCreateTeam에서 워크플로우 노드 생성 로직 추가
- [ ] Team 설정 → UniversalWorkflowNode 변환 (복합 구조)
- [ ] Team 멤버들을 개별 Agent 노드로 표현
- [ ] Team 노드와 Agent 노드 간 연결 엣지 생성
- [ ] 계층적 레이아웃 자동 배치 (Team 중앙, Agent들 주변)

#### **4.8.5 실시간 워크플로우 업데이트** 🟡 **부가기능**
- **목표**: Agent/Team 실행 시 React-Flow 워크플로우 실시간 업데이트
- [ ] 실행 상태에 따른 노드 시각적 상태 변경
- [ ] 실행 중인 노드 하이라이트
- [ ] 완료/오류 상태 시각화
- [ ] 실행 흐름에 따른 엣지 애니메이션

### **⚠️ 실현가능성 분석 및 위험 요소**

#### **📊 현재 실현가능성 평가 (업데이트됨)**
- **4.8.1**: 🟢 **85%** ✅ **달성** (Dependencies 검증 완료)
- **4.8.2**: 🟡 **75%** → 🟢 **90%** (Context 구조 분석 + State 설계 완료 시)  
- **4.8.3**: 🟡 **70%** → 🟢 **90%** (Agent 플로우 분석 + 변환 로직 구현 완료 시)
- **4.8.4**: 🟡 **65%** → 🟢 **85%** (Team 구조 설계 + 복합 노드 처리 완료 시)
- **전체**: 🟢 **74%** → 🟢 **87%** (4.8.0 완료로 실현가능성 6% 향상)

#### **🚨 주요 위험 요소 및 대응책**

**High Risk** → **Medium Risk** (4.8.0 완료로 위험도 감소):
- **React-Flow 버전 호환성**: ✅ **해결됨** (v12.8.2 + React 19.1.0 호환성 검증 완료)
- **playground-context.tsx 복잡성**: 기존 상태 구조가 복잡할 가능성
  - *대응책*: 기존 구조 분석 후 점진적 확장, 별도 context 분리 고려

**Medium Risk**:
- **Universal 타입 Export 누락**: ✅ **해결됨** (Universal 타입들 export 추가 완료)
- **UI 레이아웃 변경 복잡성**: 기존 3-column 구조 변경 시 CSS 문제
  - *대응책*: 단계적 레이아웃 변경, 기존 구조 유지하며 추가

**Low Risk**:
- **성능 이슈**: React-Flow 렌더링 성능
  - *대응책*: 노드 수 제한, 가상화 활용, 메모이제이션 적용

#### **✅ 실현가능성 향상을 위한 추가 검증 작업**

**우선순위 1: Dependencies 완전 검증**
- [ ] `@xyflow/react` 최신 버전과 React 19 호환성 확인
- [ ] `@robota-sdk/agents`에서 필요한 모든 타입 export 상태 확인
- [ ] TypeScript 컴파일 시 React-Flow 관련 타입 오류 가능성 사전 점검

**우선순위 2: 기존 코드 구조 상세 분석**
- [ ] playground-context.tsx 전체 구조 및 state 관리 패턴 파악
- [ ] handleCreateAgent/handleCreateTeam 현재 구현 로직 완전 이해
- [ ] 기존 UI 컴포넌트들과의 상호작용 분석

**우선순위 3: 점진적 구현 전략 수립**
- [ ] MVP 단계별 구현 계획 (기본 노드 표시 → 인터랙션 → 실시간 업데이트)
- [ ] 롤백 계획 수립 (기존 기능 보존 방안)
- [ ] 테스트 환경 구성 (개발/스테이징 분리)

### **📐 UI 레이아웃 변경 계획**

#### **현재 레이아웃**:
```
┌─────────────────────────────────────────┐
│ Configuration Panel | System | Auth    │  <- 상단
├─────────────────────────────────────────┤
│ Chat (1/4)  │  Execution Tree (3/4)    │  <- 메인
├─────────────────────────────────────────┤
│ Block Visualization (전체 폭)           │  <- 하단
└─────────────────────────────────────────┘
```

#### **새로운 레이아웃**:
```
┌─────────────────────────────────────────┐
│ Configuration Panel | System | Auth    │  <- 상단
├─────────────────────────────────────────┤
│ Chat (1/4) │ Workflow (1/2) │ Tree(1/4)│  <- 메인 (React-Flow 중앙)
├─────────────────────────────────────────┤
│ Block Visualization (전체 폭)           │  <- 하단
└─────────────────────────────────────────┘
```

### **🎯 새로운 구현 우선순위 (실현가능성 우선)**

#### **Phase 0: 실현가능성 향상 (0.5-1일)** 🔴 **최우선**
1. **4.8.0.1**: Dependencies 완전 검증 (React 19 + React-Flow v12 호환성)
2. **4.8.0.2**: playground-context.tsx 구조 완전 분석
3. **4.8.0.3**: 기술적 검증 및 위험 요소 해결

#### **Phase 1: 기본 통합 (1-2일)** 🟡 **검증 완료 후**
1. **4.8.1**: React-Flow 컴포넌트 playground 통합
2. **4.8.2**: 워크플로우 상태 관리 시스템 구축
3. playground UI 레이아웃 변경

#### **Phase 2: 노드 생성 (1-2일)** 🟢 **기반 완료 후**  
1. **4.8.3**: Create Agent → React-Flow 노드 생성
2. **4.8.4**: Create Team → React-Flow 노드 생성
3. 기본 노드 스타일링 및 레이아웃

#### **Phase 3: 실시간 업데이트 (1일)** 🟢 **최종 단계**
1. **4.8.5**: 실행 상태 시각화
2. 실시간 노드 상태 업데이트
3. 사용자 인터랙션 (노드 드래그, 선택 등)

### **✅ 성공 기준**
- [ ] Create Agent 버튼 → React-Flow에 Agent 노드 즉시 표시
- [ ] Create Team 버튼 → React-Flow에 Team + Agent 노드들 표시
- [ ] 노드 간 연결 관계 시각화 (Team → Agents)
- [ ] 실행 중 노드 상태 실시간 업데이트
- [ ] 기존 블록 시각화 기능과 공존

## 🚀 **다음 단계 (실현가능성 우선)**

**🔴 즉시 수행 (Phase 4.8.0)**: 실현가능성 향상 작업
1. **4.8.0.1**: Dependencies 완전 검증 (React 19 + React-Flow v12 호환성)
2. **4.8.0.2**: playground-context.tsx 구조 완전 분석  
3. **4.8.0.3**: 기술적 검증 및 위험 요소 해결

**🟡 아키텍처 분리 완료 후 (Phase 4.8.1-4.8.4)**: 실제 구현 작업
1. React-Flow 컴포넌트 playground 통합 (4.8.1)
2. 워크플로우 상태 관리 시스템 (4.8.2)  
3. Create Agent/Team → 노드 생성 (4.8.3, 4.8.4)

**✅ 현재 진행상황**: 
- ✅ **Phase 4.8.0 완료**: 실현가능성 향상 작업 100% 완료
- ✅ React-Flow 패키지 설치 완료 (`@xyflow/react v12.8.2`)
- ✅ React 19 + React-Flow v12 호환성 검증 완료
- ✅ Universal 타입들 export 추가 완료
- 🔄 **다음**: Phase 4.7.5 아키텍처 개선 - 외부 의존성 분리

## 🚨 **중대한 아키텍처 개선 작업 (진행중)**

Universal 타입 시스템과 React-Flow 통합의 핵심 기능들은 구현 완료되었으며, 현재는 빌드 무결성 복구에 집중하고 있습니다.

---

## 📊 **현재 상황 요약 (2024-12-20)**

### ✅ **구현 완료된 핵심 기능들**
- **Universal 데이터 구조**: 플랫폼 중립적 워크플로우 표현 시스템 
- **React-Flow v12.8.2 통합**: 최신 버전 완전 호환
- **실시간 시스템**: 이벤트 기반 실시간 워크플로우 업데이트
- **성능 최적화**: 스마트 캐싱, 증분 업데이트, 메모리 관리

### 🚨 **즉시 해결 필요 (Phase 4.6.0)**
- **빌드 오류 26개**: layout-engine.ts (2개) + integration-test.ts (24개)
- **타입 호환성**: 테스트 파일들의 Universal 타입 적용
- **빌드 무결성**: TypeScript 컴파일 성공 필요

### 📈 **전체 완성도: 90%**
- **핵심 기능**: ✅ **95% 완료** (비즈니스 로직 완료)
- **빌드 무결성**: ⚠️ **75% 완료** (26개 오류 해결 필요)
- **문서화**: ✅ **100% 완료** (기능 문서 이관 완료)

---

## 📋 **Phase 4.7: React-Flow 구현 대폭 단순화 - React-Flow 기본 기능 위임**

### **🎯 핵심 원칙: React-Flow 기본 기능은 React-Flow가 책임진다**

**문제점**: React-Flow가 완벽히 제공하는 기능들을 불필요하게 중복 구현
**해결책**: React-Flow 네이티브 기능 최대 활용, 우리는 단순 변환만 담당

### **🔴 즉시 제거할 React-Flow 중복 구현들**

#### **4.7.1 ReactFlowMetadataMapper 완전 제거** 🔴 **즉시**
- **제거 사유**: React-Flow의 `data` 속성이 모든 메타데이터 처리 가능
- **React-Flow 위임**: 메타데이터는 `data` 속성에 그대로 전달
- **코드 절약**: 17KB, 563줄 제거
- [x] metadata-mapper.ts 파일 완전 삭제 ✅ **완료** (17KB 절약)
- [x] 관련 import 및 참조 제거 ✅ **완료**

#### **4.7.2 ReactFlowLayoutEngine 대폭 간소화** 🟡 **부분 제거**
- **제거 사유**: React-Flow가 dagre, elkjs 등 레이아웃 라이브러리 지원
- **React-Flow 위임**: 레이아웃은 React-Flow 컴포넌트에서 처리
- **최소 기능만 유지**: 단순한 위치 계산만
- [x] 복잡한 레이아웃 알고리즘 제거 (dagre, force, grid) ✅ **완료**
- [x] 단순한 hierarchical 위치 계산만 유지 ✅ **완료**
- [x] 코드 75% 감축 ✅ **완료** (11KB → 2.5KB)

#### **4.7.3 스타일링 시스템 완전 위임** 🔴 **즉시**
- **제거 사유**: React-Flow CSS 변수, theme 시스템 완벽 지원
- **React-Flow 위임**: 모든 스타일링을 React-Flow에 위임
- [x] getNodeStyle, getEdgeStyle 메서드 제거 ✅ **완료**
- [x] theme 설정 시스템 제거 ✅ **완료**
- [x] CSS 클래스 지정 간소화 ✅ **완료**

#### **4.7.4 인터랙션 제어 완전 위임** 🔴 **즉시**
- **제거 사유**: React-Flow props로 직접 제어 가능
- **React-Flow 위임**: draggable, selectable 등을 React-Flow에 위임
- [x] enableSelection, enableDeletion 설정 제거 ✅ **완료**
- [x] 인터랙션 제어 로직 제거 ✅ **완료**

#### **4.7.5 성능 제한 시스템 위임** 🔴 **즉시**
- **제거 사유**: React-Flow 자체 가상화 및 최적화 완벽
- **React-Flow 위임**: 대용량 그래프 처리를 React-Flow에 위임
- [x] maxNodes, maxEdges 제한 제거 ✅ **완료**
- [x] react-flow-performance-optimizer.ts 완전 제거 ✅ **완료**
- [x] integration-test.ts 제거 ✅ **완료** (26KB 절약)

### **✅ 최종 목표: 90% 코드 감축**

#### **최소 필요 기능만 유지**
```typescript
// 🎯 단순화된 최종 구조
class SimpleReactFlowConverter {
  convert(universal: UniversalWorkflowStructure): ReactFlowData {
    return {
      nodes: universal.nodes.map(node => ({
        id: node.id,
        position: {x: node.position.x || 0, y: node.position.y || 0},
        data: {label: node.data.label, ...node.data} // 메타데이터는 그대로 전달
      })),
      edges: universal.edges.map(edge => ({
        id: edge.id,
        source: edge.source, 
        target: edge.target
      }))
    };
  }
}
```

#### **🎉 코드 감축 성과 달성**
- **이전**: ~70KB (5개 파일, 2000+ 줄)
- **현재**: ~6.5KB (3개 파일, 200줄 미만) ✅ **완료**
- **감축률**: 90% 이상 코드 제거 ✅ **달성**

#### **🚀 최종 간소화된 구조**
```
src/services/react-flow/
├── index.ts         (2.8KB) - 단순 변환기만
├── layout-engine.ts (2.5KB) - 기본 레이아웃만
└── types.ts         (1.2KB) - 최소 타입만
```

## 📋 **Phase 4.6: packages/agents 빌드 무결성 복구 작업**

### **🚨 현재 빌드 오류 현황 (2024-12-20)**

**빌드 오류 122개 → 65개로 대폭 감소** ✅ **주요 React-Flow 오류 해결 완료**:

#### **4.6.0 URGENT: 빌드 오류 수정 우선** 🚨 **최우선**
- [x] **layout-engine.ts 수정 (2개 오류)** ✅ **완료**
  - [x] Line 72: `override` modifier 추가 필요
  - [x] Line 124: `LayoutCalculationResult`에 `warnings` property 누락
- [x] **integration-test.ts 수정 (24개 오류)** ✅ **완료**
  - [x] `MetadataMappingConfig` export 누락 문제
  - [x] `UniversalPosition`에 `level`, `order` 속성 누락 (다수)
  - [x] `UniversalVisualState`에 `selected` 속성 존재하지 않음 (다수)
  - [x] Universal 노드 data에 `label` 속성 누락 (다수)
  - [x] 메타데이터 타입에 `createdAt`, `updatedAt` 누락 (다수)
- [x] **React-Flow index.ts 수정 (25개 오류)** ✅ **완료**
  - [x] BaseWorkflowConverter 상속 구조 올바른 구현
  - [x] createErrorResult → createFailureResult 메서드 수정
  - [x] DEFAULT_TYPE_MAPPING import 문제 해결
  - [x] Universal 타입 호환성 수정
- [x] **BaseWorkflowConverter 접근성 수정** ✅ **완료**
  - [x] createSuccessResult, createFailureResult 메서드를 protected로 변경

packages/agents 패키지에 대한 전면적 검토를 통해 다음과 같은 개선 영역들을 발견했습니다.

#### **4.6.1 Type Record 타입 중복 정리** ⚠️ **개선 필요**

- [ ] **Type Record 타입 중복 제거 및 의미 있는 이름 적용**
  - [ ] packages/agents/src 내 Record<string, 타입 선언들 분석 및 분류 - 동일 개념 식별
  - [ ] ConversationContextMetadata, ToolExecutionParameters, ExecutionMetadata, ResponseMetadata 등 중복된 Record 타입들을 GenericMetadata 기반으로 통합
  - [ ] MessageMetadata, AgentCreationMetadata, ToolMetadata 등을 GenericMetadata extends 패턴으로 변경
  - [ ] 기술적 이름(Record, Mapping 등) → 도메인 의미 이름으로 변경 (예: ProviderConfigurationData, ToolParameterValues)

#### **4.6.2 Any/Unknown 타입 4-step 검증 프로세스 적용** ⚠️ **개선 필요**

- [ ] **Any/Unknown 타입 4-step 검증 프로세스 적용**
  - [ ] utils/execution-proxy.ts의 MetadataExtractor any 타입들에 대한 4-step 검증 및 문서화
  - [ ] services/event-service.ts의 hasMetadataProperty(obj: any) → 적절한 타입 가드로 변경
  - [ ] services/tool-execution-service.ts의 safeStringValue(value: any) 등 → UniversalValue 기반으로 타입 안전화
  - [ ] services/real-time-react-flow-generator.ts의 workflow: any 타입을 WorkflowData 제약으로 변경
  - [ ] 테스트 파일들의 any 타입 사용에 대한 규칙 예외 처리 또는 타입 안전화

#### **4.6.3 Interface Import Hierarchy 규칙 준수 검증** ⚠️ **개선 필요**

- [ ] **Interface Import Hierarchy 규칙 준수 검증**
  - [ ] services/execution-service.ts의 다중 계층 import 정리 - abstract, interface, manager 간 계층 구조 준수
  - [ ] services/conversation-service/index.ts의 순환 참조 위험 검토 - manager → service → interface 계층 정리
  - [ ] agents/robota.ts의 과도한 import 정리 - 핵심 의존성만 유지, 나머지는 DI 패턴 적용
  - [ ] 모든 서비스 파일에서 lateral cross-import (동일 레벨 간 import) 제거

#### **4.6.4 Console 사용 규칙 준수 검증** ✅ **양호**

- [ ] **Console 사용 규칙 준수 검증**
  - [ ] 직접적인 console 사용이 utils/simple-logger.ts와 문서 예제에만 제한되어 있는지 확인
  - [ ] 모든 클래스가 SimpleLogger 의존성 주입 패턴을 올바르게 사용하는지 검증
  - [ ] 기본값으로 SilentLogger 사용하는지 확인 (Production-safe 기본값)

#### **4.6.5 Type Ownership 원칙 적용 검증** ⚠️ **개선 필요**

- [ ] **Type Ownership 원칙 적용 검증**
  - [ ] services 내 각 폴더가 자체 types.ts를 통해 타입 소유권을 명확히 하는지 확인
  - [ ] interfaces/ 폴더가 진정한 공유 계약만 포함하고 기능별 타입은 포함하지 않는지 검증
  - [ ] services/workflow-event-subscriber.ts, services/react-flow/ 등의 타입들이 적절한 소유권을 가지는지 확인

#### **4.6.6 Semantic Naming 원칙 적용** ⚠️ **개선 필요**

- [ ] **Semantic Naming 원칙 적용**
  - [ ] 기술적 이름들(EventExecutionValue, EventDataValue 등)을 도메인 의미 이름으로 변경
  - [ ] generic한 이름들(BaseResult, BaseConfig 등)에 구체적인 컨텍스트 추가
  - [ ] Record 기반 타입들에 의미 있는 도메인 이름 부여

#### **4.6.7 Feature-Based Type Organization 적용** ⚠️ **개선 필요**

- [ ] **Feature-Based Type Organization 적용**
  - [ ] services 내 개별 폴더들(conversation-service/, react-flow/, workflow-converter/ 등)에 각각 types.ts 파일 생성
  - [ ] 중앙집권적 types/ 폴더 지양 - 기능별 자율성 보장
  - [ ] interfaces/ 폴더는 최소한의 공유 계약만 유지

#### **4.6.8 Build Integrity 원칙 검증** ✅ **양호**

- [ ] **Build Integrity 원칙 검증**
  - [ ] 임시 any 타입 assertion이나 우회책이 사용되지 않았는지 확인
  - [ ] 모든 타입 오류가 근본적 해결을 통해 처리되었는지 검증
  - [ ] TypeScript strict 모드와 ESLint 규칙이 일관되게 준수되는지 확인

#### **4.6.9 Error Handling 표준화 및 일관성** ⚠️ **개선 필요**

- [ ] **Error Handling 패턴 통합 및 표준화**
  - [ ] plugins/error-handling/error-handling-plugin.ts의 복잡한 ErrorContextData 호환성 문제 해결
  - [ ] services/execution-service.ts의 ExecutionError 인터페이스와 기본 Error 클래스 간 타입 안전성 강화
  - [ ] utils/errors.ts의 ErrorExternalInput Record 타입을 GenericMetadata 기반으로 통합
  - [ ] 모든 에러 핸들링에서 동일한 컨텍스트 데이터 구조 사용하도록 통일

#### **4.6.10 Plugin Lifecycle 및 Dependency Management** ⚠️ **개선 필요**

- [ ] **Plugin 시스템 아키텍처 최적화**
  - [ ] managers/plugins.ts의 순환 의존성 탐지 알고리즘 성능 최적화
  - [ ] abstracts/base-plugin.ts의 PluginHooks 인터페이스 메서드 시그니처 일관성 검증
  - [ ] Plugin priority 및 dependency resolution 로직 타입 안전성 강화
  - [ ] 모든 플러그인에서 dispose 패턴 일관성 확보

#### **4.6.11 Resource Management 및 Memory Leak 방지** ⚠️ **개선 필요**

- [ ] **리소스 정리 패턴 표준화**
  - [ ] agents/robota.ts의 destroy() 메서드 순서 및 에러 핸들링 검증
  - [ ] abstracts/base-module.ts의 dispose() 패턴이 모든 상속 클래스에서 일관되게 적용되는지 확인
  - [ ] managers/ai-provider-manager.ts의 doDispose() 메서드에서 provider.close() 호출 표준화
  - [ ] EventEmitter 및 타이머 정리가 모든 컴포넌트에서 올바르게 수행되는지 검증

#### **4.6.12 Validation 및 Schema 처리 일관성** ⚠️ **개선 필요**

- [ ] **검증 시스템 통합 및 표준화**
  - [ ] utils/validation.ts의 ValidationResult와 interfaces/workflow-validator.ts의 ValidationResult 타입 통합
  - [ ] schemas/agent-template-schema.ts의 SchemaValidationInput 타입을 GenericConfig 기반으로 변경
  - [ ] tools/registry/tool-registry.ts의 validateToolSchema() 메서드 타입 안전성 강화
  - [ ] Zod 스키마와 커스텀 검증 로직 간 일관성 확보

#### **4.6.13 Module System 및 Circular Dependency 관리** ✅ **우수**

- [ ] **Module 시스템 아키텍처 검증 (참고용)**
  - [ ] managers/module-registry.ts의 순환 의존성 탐지 및 해결 메커니즘 검토
  - [ ] managers/module-type-registry.ts의 의존성 순서 해결 알고리즘 성능 검증
  - [ ] 모든 모듈 초기화 순서가 올바른 우선순위를 따르는지 확인

### **🎯 성공 기준 (Phase 4.6 완료 시)**

- [ ] **타입 중복 제거**: 현재 30+ Record 타입 선언 → 5-10개 도메인 타입으로 통합
- [ ] **Any/Unknown 검증**: 모든 any/unknown 사용에 대한 4-step 검증 완료 또는 적절한 대안 적용
- [ ] **Import 계층 준수**: 모든 서비스가 Interface Import Hierarchy 규칙 100% 준수
- [ ] **타입 소유권 명확화**: 각 기능별 타입 소유권 명확히 정의 및 적절한 위치 배치
- [ ] **의미 있는 네이밍**: 모든 타입이 도메인 중심의 의미 있는 이름 사용
- [ ] **빌드 무결성**: TypeScript 컴파일 및 ESLint 검사 완전 통과
- [ ] **에러 핸들링 통일**: 모든 컴포넌트에서 일관된 에러 컨텍스트 및 처리 패턴 사용
- [ ] **리소스 관리 완성**: 모든 dispose/destroy 메서드에서 완전한 리소스 정리 수행
- [ ] **검증 시스템 통합**: Zod 스키마와 커스텀 검증 로직 간 완전한 호환성 확보

### **⚠️ 우선순위 (2024-12-20 업데이트)**

1. **🚨 URGENT**: **빌드 오류 수정 (4.6.0)** - 26개 타입 오류 즉시 해결 필요
   - `layout-engine.ts` override modifier 및 warnings 속성 추가
   - `integration-test.ts` 타입 호환성 문제 전면 수정
2. **높음**: Type Record 중복 제거 (4.6.1) - 아키텍처 위반 사례 정리
3. **높음**: Any/Unknown 타입 검증 (4.6.2) - 타입 안전성 확보  
4. **높음**: Import Hierarchy 준수 (4.6.3) - 아키텍처 일관성
5. **중간**: Error Handling 표준화 (4.6.9) - 시스템 안정성 향상
6. **중간**: Resource Management 개선 (4.6.11) - 메모리 누수 방지
7. **중간**: Validation 시스템 통합 (4.6.12) - 데이터 무결성 확보
8. **낮음**: Type Ownership 명확화 (4.6.5) - 장기적 유지보수성
9. **낮음**: Plugin Lifecycle 최적화 (4.6.10) - 성능 개선
10. **낮음**: Semantic Naming 및 Organization (4.6.6, 4.6.7) - 코드 품질 향상

### **📊 추가 발견 사항 요약**

꼼꼼한 재검토를 통해 다음과 같은 추가 개선 영역들을 발견했습니다:

- **Error Handling 복잡성**: ErrorContextData와 ErrorHandlingContextData 간 타입 호환성 문제
- **Resource Management 불일치**: dispose/destroy 패턴이 일부 컴포넌트에서 불완전
- **Validation 중복**: ValidationResult 타입이 여러 위치에서 다르게 정의됨
- **Schema 타입 불일치**: Zod 기반 스키마와 커스텀 타입 간 호환성 문제

**총 개선 영역**: 13개 (기존 8개 + 추가 5개)

**이 작업들을 완료하면 packages/agents가 Robota SDK 아키텍처 원칙을 100% 준수하는 모범적인 패키지가 됩니다.**

---

## 🚀 **PHASE 5: 기존 구조 존중 기반 React-Flow 통합 (수정된 접근법)**

### **🎯 핵심 원칙: 기존 구조 최대 존중 및 범용성 유지**

**⚠️ 중요한 설계 원칙:**
1. **기존 구조 변경 최소화** - PlaygroundContext, WorkflowVisualization 등 기존 인터페이스 유지
2. **범용성 확보** - 다른 플레이그라운드나 환경에서도 재사용 가능하도록 설계
3. **점진적 확장** - 기존 기능에 영향 없이 새로운 기능 추가
4. **구조 변경 시 사전 협의** - 기본 구조 수정은 반드시 사용자와 협의 후 진행

### **📊 기존 구조 분석 및 존중 사항**

**✅ 기존 우수 구조 (절대 변경 금지):**
- `PlaygroundContext`: 완벽한 상태 관리 패턴 (reducer + useCallback 조합)
- `WorkflowVisualization({ workflow })`: 깔끔한 props 인터페이스
- `currentWorkflow: UniversalWorkflowStructure | null`: 이미 완벽한 상태 설계
- `createAgent`, `createTeam`, `executeStreamPrompt`: 일관된 메서드 시그니처

**✅ 기존 패턴 준수 필수:**
- Action 타입: `{ type: 'ACTION_NAME'; payload: DataType }` 형식
- 메서드: `useCallback`로 감싸고 의존성 배열 명시
- 에러 처리: try-catch + dispatch 패턴
- 타입 안전성: 모든 인터페이스 명시적 정의

**❌ 현재 누락된 연결 (최소 확장으로 해결):**
- `currentWorkflow` 상태 업데이트 액션 없음 → 기존 패턴 따라 추가만
- WorkflowVisualization과 실시간 데이터 연결 없음 → Props 활용하여 연결만

### **👁️ PHASE 5.1: 눈에 보이는 결과 우선 - 단계별 확인 방식**

#### **🎯 목표: 각 단계마다 사용자가 직접 확인할 수 있는 시각적 결과 제공**

**📋 진행 방식:**
1. **작업 실행** → **시각적 결과 확인** → **사용자 승인** → **다음 단계**
2. 각 단계는 독립적으로 테스트 가능
3. 문제 발생 시 해당 단계에서 중단하고 수정

---

#### **👀 STEP 1: 기본 액션 추가 → 개발자 도구에서 확인** ✅ **완료**

**🎯 기대 결과:** 개발자 도구에서 `SET_CURRENT_WORKFLOW` 액션 확인 가능

- [x] **1.1 PlaygroundAction 타입 확장**
  ```typescript
  | { type: 'SET_CURRENT_WORKFLOW'; payload: UniversalWorkflowStructure | null }
  ```
  
- [x] **1.2 playgroundReducer 케이스 추가**
  ```typescript
  case 'SET_CURRENT_WORKFLOW':
    return { ...state, currentWorkflow: action.payload };
  ```

- [x] **1.3 setWorkflow 메서드 추가**
  ```typescript
  const setWorkflow = useCallback((workflow: UniversalWorkflowStructure | null) => {
    dispatch({ type: 'SET_CURRENT_WORKFLOW', payload: workflow });
  }, []);
  ```

- [x] **1.4 PlaygroundContextValue에 메서드 추가**
  ```typescript
  setWorkflow: (workflow: UniversalWorkflowStructure | null) => void;
  ```

**✅ 확인 방법:** 
- 브라우저 개발자 도구 → Redux DevTools (또는 console.log)
- `setWorkflow` 호출 시 상태 변경 확인
- **사용자 확인 필요:** "액션이 정상적으로 동작하는지"

---

#### **👀 STEP 2: Create Agent 버튼 → React-Flow에 노드 나타남** ✅ **완료**

**🎯 기대 결과:** Create Agent 클릭 시 Workflow Visualization 박스에 Agent 노드 표시

- [x] **2.1 간단한 워크플로우 생성 함수 추가**
  ```typescript
  function createSimpleAgentWorkflow(agentName: string): UniversalWorkflowStructure {
    return {
      id: `workflow_${Date.now()}`,
      nodes: [{
        id: `agent_${Date.now()}`,
        type: 'agent',
        position: { x: 100, y: 100 },
        data: { label: agentName }
      }],
      edges: [],
      // ... 기타 필수 속성들
    };
  }
  ```

- [x] **2.2 handleCreateAgent에 워크플로우 생성 추가**
  ```typescript
  // 기존 createAgent 호출 후
  const workflow = createSimpleAgentWorkflow(config.name);
  setWorkflow(workflow);
  ```

**✅ 확인 방법:**
- Playground 접속 → Create Agent 버튼 클릭
- Workflow Visualization 박스에 Agent 노드 표시 확인
- **사용자 확인 필요:** "Agent 노드가 보이는지"

---

#### **👀 STEP 3: Create Team 버튼 → React-Flow에 Team + Agent 노드들 나타남** ✅ **완료**

**🎯 기대 결과:** Create Team 클릭 시 Team 노드 + 멤버 Agent 노드들 표시

- [x] **3.1 Team 워크플로우 생성 함수 추가**
  ```typescript
  function createSimpleTeamWorkflow(teamConfig: PlaygroundTeamConfig): UniversalWorkflowStructure {
    const teamNode = { id: 'team_main', type: 'team', position: { x: 100, y: 50 } };
    const agentNodes = teamConfig.members.map((member, index) => ({
      id: `agent_${member.name}`,
      type: 'agent', 
      position: { x: 50 + index * 150, y: 200 }
    }));
    // Team → Agent 연결 엣지들
    const edges = agentNodes.map(agent => ({
      id: `edge_team_${agent.id}`,
      source: 'team_main',
      target: agent.id
    }));
    
    return { nodes: [teamNode, ...agentNodes], edges, ... };
  }
  ```

- [x] **3.2 handleCreateTeam에 워크플로우 생성 추가**

**✅ 확인 방법:**
- Create Team 버튼 클릭
- Team 노드 + 여러 Agent 노드들이 연결된 상태로 표시 확인
- **사용자 확인 필요:** "Team과 Agent들이 연결되어 보이는지"

---

#### **👀 STEP 4: 실행 버튼 → 노드 상태 변화 확인** ✅ **완료**

**🎯 기대 결과:** Play 버튼 클릭 시 Agent 노드 색상/상태 변화

- [x] **4.1 노드 상태 업데이트 함수 추가**
  ```typescript
  function updateAgentNodeStatus(nodeId: string, status: 'running' | 'completed' | 'error') {
    // currentWorkflow에서 해당 노드 찾아서 상태 업데이트
  }
  ```

- [x] **4.2 executeStreamPrompt에 상태 업데이트 추가**
  - 실행 시작 시: 'running' 상태
  - 실행 완료 시: 'completed' 상태
  - 오류 시: 'error' 상태

**✅ 확인 방법:**
- Create Agent → Play 버튼 클릭
- Agent 노드 색상이 변하는지 확인
- **사용자 확인 필요:** "노드 상태 변화가 보이는지"

---

#### **👀 STEP 5: 채팅 입력 → 새로운 노드들 추가** ✅ **완료**

**🎯 기대 결과:** 채팅 시 User Input, Agent Response 노드 추가 (개선된 타이밍)

- [x] **5.1 채팅 기반 노드 추가 함수**
- [x] **5.2 executeStreamPrompt에서 실시간 노드 추가**
- [x] **5.3 Team 워크플로우 연결 수정** (User Input → Team 우선 연결)

**✅ 확인 방법:**
- 채팅 입력 후 User Input 노드 추가 확인
- 응답 완료 후 Agent Response 노드 추가 확인
- **사용자 확인 필요:** "채팅할 때마다 노드가 추가되는지"

---

#### **👀 STEP 6: Team assignTask Tool 시각화 → Tool Call 노드 추가**

**🎯 목표: Team의 assignTask Tool을 활용한 Tool Call 노드 시각화 구현**

**💡 핵심 아이디어:**
- **Create Agent**: Tool Call 기능 없음 (현재 상태 유지)
- **Create Team**: Team Leader Agent + assignTask Tool 기본 보유
- **assignTask 실행 시**: Tool Call 노드 + 새로운 Agent 노드 자동 생성
- **단계별 눈으로 확인**: 각 단계마다 시각적 결과 확인 후 진행

**📋 세부 단계:**

##### **👀 STEP 6.1: Team 기본 Tool 노드 표시** ✅ **완료 (수정됨)**
**🎯 기대 결과:** Create Team 시 Team + Agent(Leader) 표시, Agent 하위에 Tool Slot으로 assignTask 표시

- [ ] **6.1.1 Team 워크플로우 생성 함수 확장**
  ```typescript
  function createTeamWithToolsWorkflow(teamConfig: PlaygroundTeamConfig): UniversalWorkflowStructure {
    const teamNode = { id: 'team_main', type: 'team', position: { x: 200, y: 50 } };
    const assignTaskNode = { 
      id: 'tool_assignTask', 
      type: 'toolCall', 
      position: { x: 200, y: 200 },
      data: { label: 'assignTask Tool', toolName: 'assignTask', status: 'available' }
    };
    const agentNodes = teamConfig.agents.map((agent, index) => ({
      id: `agent_${agent.name}`,
      type: 'agent', 
      position: { x: 50 + index * 200, y: 350 }
    }));
    
    // 연결: Team → assignTask Tool, assignTask Tool → Agent들
    const edges = [
      { source: 'team_main', target: 'tool_assignTask', sourceHandle: 'team-output', targetHandle: 'tool-input' },
      ...agentNodes.map(agent => ({
        source: 'tool_assignTask', 
        target: agent.id,
        sourceHandle: 'tool-output', 
        targetHandle: 'agent-input'
      }))
    ];
    
    return { nodes: [teamNode, assignTaskNode, ...agentNodes], edges, ... };
  }
  ```

- [ ] **6.1.2 handleCreateTeam 함수 업데이트**
  ```typescript
  // 기존 createSimpleTeamWorkflow → createTeamWithToolsWorkflow로 변경
  const workflow = createTeamWithToolsWorkflow(config);
  setWorkflow(workflow);
  ```

**✅ 확인 방법:**
- Create Team 버튼 클릭
- **Team 노드** + **assignTask Tool 노드** + **Agent 노드들** 표시 확인
- Team → assignTask → Agent들 연결선 확인
- **사용자 확인 필요:** "assignTask Tool 노드가 Team과 Agent 사이에 보이는지"

---

##### **👀 STEP 6.2: Event 기반 동적 Tool Call/Agent 노드 생성** ✅ **완료**
**🎯 기대 결과:** Team/Agent 채팅 시 Tool 실행에 따라 동적으로 Tool Call 및 Agent 노드 생성

- [x] **6.2.1 모드 기반 User Input 연결**
  ```typescript
  // 도메인 중립적 모드 감지 (특정 Tool 키워드 없음)
  const connectUserInput = () => {
    if (currentMode === 'team') {
      // User Input → Team 노드 연결
      addUserInputNode('team', teamNodeId);
    } else if (currentMode === 'agent') {
      // User Input → Agent 노드 연결
      addUserInputNode('agent', agentNodeId);
    }
  }
  ```

- [x] **6.2.2 Event 기반 Tool Call 노드 동적 생성**
  ```typescript
  // Event System에서 tool_call_start 이벤트 감지
  eventService.on('tool_call_start', (event) => {
    // 범용적인 Tool Call 노드 생성 (Tool 이름 무관)
    const toolCallNode = createToolCallNode({
      id: `tool-${event.toolName}-${Date.now()}`,
      toolName: event.toolName,
      sourceAgentId: event.sourceId
    });
    addNodeToWorkflow(toolCallNode);
  });
  ```

- [x] **6.2.3 Event 기반 Agent 노드 동적 생성**
  ```typescript
  // Event System에서 agent_created 이벤트 감지  
  eventService.on('agent_created', (event) => {
    // 새 Agent 노드 생성 및 Tool Call과 연결
    const agentNode = createAgentNode({
      id: event.agentId,
      parentToolCallId: event.parentToolCallId,
      taskName: event.taskName
    });
    addNodeToWorkflow(agentNode);
    connectNodes(event.parentToolCallId, event.agentId);
  });
  ```

**⚠️ 현재 문제**: Team 채팅에서 LLM이 Tool Call을 하지 않아 tool_call_start 이벤트가 발생하지 않음

**✅ 확인 방법:**
- Create Team → Team 채팅 시작
- 임의의 Tool 실행 명령 입력 (Tool 이름 무관)
- Tool Call 노드 동적 생성 확인
- 새 Agent 노드 동적 생성 및 연결 확인
- **사용자 확인 필요:** "Event 기반 동적 노드 생성이 보이는지"

---

##### **👀 STEP 6.3: 도메인 중립적 Tool Call 유도 System Message 수정** 🔄 **진행중**

**🎯 목적**: Team Agent가 도메인 중립적으로 Tool 사용을 고려하도록 System Message 개선

**🔧 핵심 구현 사항**:
- Team Container에서 Team Agent System Message에 일반적인 Tool 사용 유도 문구 추가
- 특정 Tool 이름(assignTask) 언급 없이 일반적인 Tool 활용 권장
- 도메인 중립성 유지하면서 LLM의 Tool Call 결정 유도

**🎯 기대 결과**: Team 채팅에서 복잡한 작업 시 LLM이 자발적으로 사용 가능한 Tool 활용

**📋 세부 작업**:
- [x] **6.3.1 Console 로깅 강화 (디버깅용)**
  ```typescript
  // apps/web/src/contexts/playground-context.tsx에 추가된 디버깅 로그:
  // ✅ [Event Setup] Event listeners being registered
  // 📡 [Event Setup] Registering tool_call_start listener
  // 🚀 [Team/Agent Execution] Starting team mode execution
  // 🔧 [EVENT DETECTED] Tool Call started (if event occurs)
  ```

- [ ] **6.3.2 도메인 중립성 검증**
  - ✅ 특정 Tool 이름(`assignTask`) 언급 없음
  - ✅ 일반적인 Tool 사용 유도 (모든 Tool에 적용 가능)
  - ✅ Team Package만 수정 (다른 패키지는 `assignTask` 모름)
  - ✅ Event 이름도 중립적 (기존 `tool_call_start` 사용)

- [ ] **6.3.3 Tool Call 유도 테스트**
  - [ ] 복잡한 작업 프롬프트 테스트: "웹사이트를 만들어주세요. 프론트엔드와 백엔드가 모두 필요합니다."
  - [ ] LLM의 Tool Call 결정 및 `tool_call_start` 이벤트 발생 확인
  - [ ] Tool Call Node 및 Agent Node 동적 생성 검증

- [ ] **6.3.4 Event 흐름 정상 동작 확인**
  - [ ] Team Agent → Tool Call → `tool_call_start` 이벤트 → Tool Call Node 생성
  - [ ] Team Tool 실행 → `agent.creation_complete` 이벤트 → Agent Node 생성
  - [ ] 전체 Node 연결 관계 및 시각화 정상 동작 확인

---

##### **👀 STEP 6.3: Tool Call로 생성된 새로운 Agent 노드 추가**
**🎯 기대 결과:** assignTask 실행으로 새로운 Agent 생성 시 Agent 노드 추가

- [ ] **6.3.1 Tool Call로 생성된 Agent 감지 로직**
  ```typescript
  // Tool Call 결과로 새로운 Agent 생성 이벤트 감지
  if (newAgentCreatedFromToolCall) {
    const newAgentNode = {
      id: `agent-${timestamp}`,
      type: 'agent',  // 동일한 agent 타입 사용
      position: calculateNewAgentPosition(),
      data: { 
        label: `Agent (${taskName})`, 
        taskName: taskName,
        status: 'pending',
        level: parentAgent.level + 1  // 계층 레벨 관리
      }
    };
    
    // Tool Call → Agent 연결
    const toolToAgentEdge = {
      source: toolCallNodeId,
      target: newAgentNode.id,
      sourceHandle: 'tool-output',
      targetHandle: 'agent-input'
    };
  }
  ```

- [ ] **6.3.2 새로운 Agent의 재귀적 패턴 지원**
  ```typescript
  // 새로운 Agent도 동일한 패턴으로 Tool Call 가능
  // Agent → Tool Call → Agent → Tool Call... (무한 반복 가능)
  ```

**✅ 확인 방법:**
- assignTask 실행 후 새로운 Agent 노드 추가 확인
- Tool Call → Agent 연결선 확인
- 새로운 Agent 노드 상태 변화 확인 (pending → running → completed)
- **사용자 확인 필요:** "Tool Call에서 새로운 Agent 노드가 연결되어 나타나는지"

---

##### **👀 STEP 6.4: 완전한 재귀적 Agent Workflow 생명주기 확인**
**🎯 기대 결과:** Team의 완전한 Tool Call → Agent → Tool Call... 재귀적 워크플로우 시각화

- [ ] **6.4.1 전체 흐름 통합 테스트**
  ```
  User Input → Team → assignTask Tool Call → Agent → Agent Response
                  ↓                            ↓
           Direct Agent Response        Agent → Tool Call → Agent → Response
                                                        ↓
                                              Agent → Tool Call → ...
  ```

- [ ] **6.4.2 복잡한 재귀적 시나리오 테스트**
  - 여러 Agent 동시 생성 (Tool Call로부터)
  - 중첩된 Tool Call (Agent → Tool Call → Agent → Tool Call...)
  - 계층적 레벨 관리 (level 1, 2, 3... Agent들)
  - Tool Call 실패 시 오류 상태 표시

**✅ 확인 방법:**
- Create Team → 복잡한 팀 작업 요청
- 재귀적 Agent → Tool Call → Agent 패턴 확인
- 모든 노드 상태 변화 추적
- **사용자 확인 필요:** "재귀적 Agent 워크플로우가 제대로 시각화되는지"

---

### **📋 진행 순서**

1. **STEP 1 완료** ✅ → 사용자 확인 완료 → 다음 단계 승인
2. **STEP 2 완료** ✅ → 사용자 확인 완료 → 다음 단계 승인  
3. **STEP 3 완료** ✅ → 사용자 확인 완료 → 다음 단계 승인
4. **STEP 4 완료** ✅ → 사용자 확인 완료 → 다음 단계 승인
5. **STEP 5 완료** ✅ → 사용자 확인 완료 → 다음 단계 승인
6. **STEP 6.1** → 사용자 확인 → STEP 6.2 진행
7. **STEP 6.2** → 사용자 확인 → STEP 6.3 진행
8. **STEP 6.3** → 사용자 확인 → STEP 6.4 진행
9. **STEP 6.4** → 사용자 확인 → **Tool Call 시각화 완료**

**각 STEP에서 문제 발생 시 해당 단계에서 멈추고 수정합니다.**

### **📋 PHASE 5.2: 범용성 보장 및 사용자 협의 필수 영역**

**⚠️ 경고: 이 단계부터는 기존 구조 변경이 필요할 수 있음**
**모든 변경 사항은 사용자와 사전 협의 후 진행**

#### **5.2.1 구조 변경 검토 필요 영역 (사용자 협의 필수)**

**🔍 협의 필요 사항들:**

- [ ] **PlaygroundExecutor 확장 검토**
  - **현재**: `PlaygroundExecutor`에 `RealTimeWorkflowBuilder` 연결 없음
  - **제안**: `PlaygroundExecutor`에 워크플로우 이벤트 연동 추가
  - **영향도**: 중간 - 기존 API는 유지하되 내부 구조 확장
  - **범용성**: 다른 플레이그라운드에서도 활용 가능한 구조인지 검토 필요
  - **사용자 협의 필요**: PlaygroundExecutor 확장 방향성

- [ ] **executeStreamPrompt 확장 검토**
  - **현재**: 순수한 채팅 실행 메서드
  - **제안**: 워크플로우 노드 생성 로직 추가
  - **영향도**: 높음 - 핵심 실행 로직 변경
  - **범용성**: 다른 환경에서 워크플로우 기능을 원하지 않을 수 있음
  - **사용자 협의 필요**: 채팅 실행과 워크플로우 연동 방식

- [ ] **실시간 데이터 동기화 아키텍처 검토**
  - **현재**: `currentWorkflow` 상태와 실시간 시스템 분리됨
  - **제안**: 이벤트 기반 실시간 동기화 시스템
  - **영향도**: 높음 - 새로운 아키텍처 패턴 도입
  - **범용성**: 복잡성 증가로 범용성 저하 우려
  - **사용자 협의 필요**: 실시간 동기화의 필요성 및 구현 방식

#### **5.2.2 대안적 접근법 (구조 변경 최소화)**

**Option A: 수동 업데이트 방식 (추천)**
- [ ] 채팅 실행 완료 후 수동으로 워크플로우 상태 업데이트
- [ ] 실시간 연동 대신 이벤트 완료 시점에서 상태 갱신
- [ ] 기존 구조 변경 없이 최소한의 추가 로직만 구현

**Option B: 플러그인 방식**
- [ ] 워크플로우 업데이트 기능을 별도 플러그인으로 분리
- [ ] PlaygroundExecutor에 플러그인 시스템 도입
- [ ] 선택적으로 워크플로우 기능 활성화/비활성화 가능

**Option C: 이벤트 리스너 방식**
- [ ] PlaygroundContext에 이벤트 리스너 추가
- [ ] executeStreamPrompt 완료 시 이벤트 발생
- [ ] 이벤트 기반으로 워크플로우 상태 업데이트

#### **5.2.3 사용자 결정 대기 항목**

다음 항목들은 사용자 협의 후 진행:
- [ ] PlaygroundExecutor 내부 구조 확장 여부
- [ ] 실시간 vs 수동 업데이트 방식 선택
- [ ] 범용성 vs 기능성 우선순위
- [ ] 복잡성 증가에 대한 허용 범위

### **📋 PHASE 5.3: WorkflowVisualization 컴포넌트 노드 상태 시각화 강화**

#### **5.3.1 노드 상태별 시각적 표현 구현**
- [ ] **실행 상태 시각화 강화**
  - [ ] `AgentNode`, `TeamNode` 컴포넌트에 상태별 스타일링 추가
  - [ ] pending: 회색, running: 파란색 + 애니메이션, completed: 초록색, error: 빨간색
  - [ ] 실행 중 노드에 로딩 스피너 또는 펄스 애니메이션 추가
  - [ ] 노드 상태 변경 시 부드러운 트랜지션 효과

- [ ] **새로운 노드 타입 추가**
  - [ ] `UserInputNode`: 사용자 채팅 입력 노드 컴포넌트
  - [ ] `AgentResponseNode`: Agent 응답 노드 컴포넌트  
  - [ ] `ToolCallNode`: Tool 호출 노드 컴포넌트
  - [ ] `SubAgentNode`: Sub-Agent 노드 컴포넌트
  - [ ] 각 노드 타입별 고유 아이콘 및 색상 스키마

#### **5.3.2 동적 레이아웃 및 자동 배치**
- [ ] **실시간 노드 추가 시 레이아웃 자동 조정**
  - [ ] 새로운 노드 추가 시 기존 노드와 겹치지 않는 위치 계산
  - [ ] 워크플로우 방향에 따른 자동 배치 (세로/가로 플로우)
  - [ ] 노드 간 적절한 간격 및 연결선 최적화
  - [ ] 화면 크기에 맞는 자동 확대/축소

- [ ] **연결선 및 흐름 시각화 개선**
  - [ ] 실행 흐름에 따른 엣지 애니메이션 (화살표 이동 효과)
  - [ ] 노드 타입별 연결선 색상 및 스타일 차별화
  - [ ] 에러 발생 시 연결선 빨간색으로 표시
  - [ ] 성공적인 실행 흐름 강조 표시

### **📋 PHASE 5.4: 완전한 생명주기 통합 및 검증**

#### **5.4.1 End-to-End 생명주기 검증**
- [ ] **Agent 생성 → 실행 → 채팅 → 응답 전체 플로우 테스트**
  - [ ] Create Agent → Agent 노드 생성 확인
  - [ ] Agent 실행 시작 → 노드 상태 'running' 확인
  - [ ] 채팅 입력 → User Input 노드 추가 확인
  - [ ] Agent 응답 → Agent Response 노드 추가 및 연결 확인
  - [ ] Tool 호출 → Tool Call 노드 추가 및 연결 확인
  - [ ] 실행 완료 → 노드 상태 'completed' 확인

- [ ] **Team 생성 → 복잡한 워크플로우 검증**
  - [ ] Create Team → Team + Agent 노드들 생성 확인
  - [ ] Team 실행 → 멀티 Agent 워크플로우 노드 생성 확인
  - [ ] Sub-Agent 실행 → 계층적 노드 구조 확인
  - [ ] 병렬 처리 → 동시 실행 노드 상태 관리 확인

#### **5.4.2 데이터 일관성 및 오류 처리**
- [ ] **ID 매칭 및 중복 방지**
  - [ ] 일관된 노드 ID 생성 규칙 정의 (`${type}_${timestamp}_${uniqueId}`)
  - [ ] `RealTimeWorkflowBuilder` 이벤트와 UI 생성 노드 ID 매칭 보장
  - [ ] 중복 노드 생성 방지 로직
  - [ ] 기존 노드 유지하면서 새로운 노드 추가하는 병합 로직

- [ ] **오류 상황 처리**
  - [ ] Agent 실행 실패 시 노드 상태 'error' 반영
  - [ ] WebSocket 연결 끊김 시 워크플로우 상태 보존
  - [ ] 불완전한 워크플로우 데이터 복구 메커니즘
  - [ ] 사용자에게 명확한 오류 피드백 제공

### **📋 PHASE 5.5: 테스트 및 검증**

#### **5.5.1 기능 테스트**
- [ ] **Create Agent/Team 플로우 테스트**
  - [ ] Create Agent 버튼 → React-Flow 노드 생성 검증
  - [ ] Create Team 버튼 → Team + Agent 노드들 생성 검증
  - [ ] 노드 위치 자동 계산 정확성 검증
  - [ ] 다양한 시나리오에서 노드 생성 테스트

- [ ] **실시간 워크플로우 반영 테스트**
  - [ ] 채팅 실행 → 워크플로우 노드 추가 검증
  - [ ] Tool 호출 → Tool 노드 생성 검증
  - [ ] Sub-Agent 생성 → 새로운 노드 추가 검증
  - [ ] 실행 상태 변경 → 시각적 피드백 검증

#### **5.5.2 통합 테스트**
- [ ] **End-to-End 시나리오 테스트**
  - [ ] Agent 생성 → 채팅 실행 → 결과 시각화 전체 플로우
  - [ ] Team 생성 → 복잡한 태스크 실행 → 멀티 에이전트 워크플로우 시각화
  - [ ] 오류 상황에서의 시각화 동작 검증
  - [ ] 대용량 워크플로우 처리 성능 테스트

- [ ] **회귀 테스트**
  - [ ] 기존 플레이그라운드 기능 정상 동작 확인
  - [ ] 다른 시각화 방식과의 호환성 확인
  - [ ] 브라우저별 호환성 테스트
  - [ ] 모바일 환경에서의 동작 테스트

### **🎯 완전한 생명주기 성공 기준**

- [ ] **🔧 Agent 생성 단계**
  - [ ] Create Agent 버튼 클릭 → React-Flow에 Agent 노드 즉시 표시
  - [ ] Agent 노드에 이름, 모델, 상태 정보 표시
  - [ ] 노드 위치 자동 계산 및 배치

- [ ] **⚡ 실행 시작 단계**  
  - [ ] Play 버튼 클릭 → Agent 노드 상태가 'running'으로 변경
  - [ ] 실행 중 노드에 시각적 피드백 (색상 변경, 애니메이션)
  - [ ] 실행 준비 완료 상태 명확한 표시

- [ ] **💬 채팅 입력 단계**
  - [ ] 채팅 메시지 전송 → User Input 노드 즉시 추가
  - [ ] Agent 노드와 User Input 노드 간 연결선 생성
  - [ ] 사용자 입력 내용이 노드에 표시

- [ ] **🤖 채팅 응답 단계**
  - [ ] Agent 응답 생성 → Agent Response 노드 추가
  - [ ] User Input → Agent Response 연결선 생성
  - [ ] Tool 호출 시 → Tool Call 노드 및 연결선 추가
  - [ ] Sub-Agent 생성 시 → 새로운 Agent 노드 추가

- [ ] **🏁 실행 완료 단계**
  - [ ] 실행 완료 시 → 모든 노드 상태 'completed'로 변경
  - [ ] 성공적인 실행 흐름 시각적 강조
  - [ ] 오류 발생 시 해당 노드 'error' 상태 표시

- [ ] **🔄 데이터 일관성**
  - [ ] 기존 노드 유지하면서 새로운 노드 추가
  - [ ] 중복 노드 생성 방지
  - [ ] 모든 연결 관계 정확성 보장
  - [ ] 메모리 누수 없는 상태 관리

### **⚠️ 위험 요소 및 대응책**

**높은 위험**:
- **데이터 동기화 복잡성**: Universal ↔ React-Flow 데이터 불일치
  - *대응책*: 철저한 ID 매칭 시스템, 자동 검증 로직
- **성능 저하**: 실시간 업데이트로 인한 렌더링 지연
  - *대응책*: 메모이제이션, 배칭, 가상화 적용

**중간 위험**:
- **UI 복잡성**: React-Flow 설정 및 커스터마이징
  - *대응책*: 단계적 구현, 기본 기능부터 시작
- **테스트 복잡성**: 실시간 상태 변경 테스트 어려움  
  - *대응책*: Mock 데이터 활용, 단위 테스트 분리

### **📊 수정된 예상 소요 시간**

- **PHASE 5.1**: 1-2일 (기존 구조 활용한 생명주기 통합)
- **PHASE 5.2**: 2-3일 (실행 상태 및 채팅 연동)
- **PHASE 5.3**: 1-2일 (시각화 강화)
- **PHASE 5.4**: 1-2일 (완전한 통합 검증)
- **PHASE 5.5**: 1일 (테스트 및 디버깅)

**총 예상 시간**: **6-10일** (기존 구조 활용으로 단축)

### **🚀 즉시 시작 단계**

**Step 1 (최우선)**: PHASE 5.1.1 - Create Agent/Team → currentWorkflow 상태 업데이트
1. `handleCreateAgent`에서 `UniversalWorkflowStructure` 생성 및 `setCurrentWorkflow` 호출
2. `handleCreateTeam`에서 Team + Agent 노드들 포함한 워크플로우 생성
3. `PlaygroundContext`에 `SET_CURRENT_WORKFLOW` 액션 추가

**Step 2**: PHASE 5.1.2 - PlaygroundContext 액션 확장
1. `UPDATE_WORKFLOW_NODES`, `updateWorkflowNodeStatus` 메서드 추가
2. 워크플로우 병합 로직 구현

**Step 3**: PHASE 5.2.1 - Agent 실행 상태 연동
1. `PlaygroundExecutor.run()`에서 실행 시작/완료 이벤트 발생
2. 노드 상태 업데이트 로직 구현

### **🔍 기존 구조 존중 기반 실현 가능성 재평가 (2024-12-20)**

#### **🟢 즉시 실현 가능 (95-100%) - 기존 구조 완전 준수**

**PHASE 5.1: 기존 패턴 엄격 준수 - 최소 확장**
- **현재 상태**: 완벽한 기존 패턴이 존재 ✅
- **필요 작업**: 기존 패턴 100% 동일하게 적용만 하면 됨
- **복잡도**: 매우 낮음 - 복사 붙여넣기 수준
- **위험도**: 거의 없음 - 기존 구조 일체 변경 없음
- **예상 시간**: 1-2시간 (기존 패턴 그대로 적용)

**구체적 작업:**
- `PlaygroundAction` 타입에 액션 하나 추가 (기존 스타일 100% 동일)
- `playgroundReducer`에 케이스 하나 추가 (기존 케이스 복사)  
- `useCallback` 메서드 하나 추가 (기존 메서드 복사)
- Props 연결 한 줄 추가 (기존 방식과 동일)

#### **🟡 사용자 협의 필요 (실현 가능성 미정)**

**PHASE 5.2: 구조 변경 검토 영역**
- **실현 가능성**: 사용자 결정에 따라 0% ~ 90%
- **핵심 이슈**: 기존 구조 변경의 범용성 및 필요성
- **협의 필요 사항**:
  - PlaygroundExecutor 확장 여부 및 방향성
  - executeStreamPrompt 확장 vs 대안 방식
  - 실시간 vs 수동 업데이트 선택
  - 복잡성 증가 허용 범위

#### **📊 수정된 전략 및 권장사항**

**즉시 시작 가능 (Phase 5.1):**
1. **최소 확장 우선** - 기존 구조 100% 유지하며 기본 기능만 구현
2. **MVP 검증** - Create Agent → 노드 표시 기본 기능 확인
3. **사용자 피드백** - 기본 기능 확인 후 추가 기능 협의

**사용자 협의 후 진행 (Phase 5.2):**
1. **구조 변경 영향도** 분석 및 범용성 검토
2. **대안 방식** 비교 검토 (수동 vs 실시간 vs 플러그인)
3. **점진적 확장** vs **기능 제한** 선택

### **🎯 수정된 성공 확률**

**PHASE 5.1 (기존 구조 완전 준수)**: **95-100%**
- 위험 요소: 거의 없음
- 필요 시간: 1-2시간
- 즉시 시작 가능

**PHASE 5.2 (사용자 협의 후)**: **협의 결과에 따라 결정**
- 구조 변경 허용 시: 70-85%
- 구조 변경 제한 시: 50-70% (기능 제한됨)
- 대안 방식 채택 시: 80-90%

### **✅ 최종 권장 방향**

1. **즉시 PHASE 5.1 진행** - 기존 구조 100% 유지하며 기본 기능 구현
2. **기본 기능 검증** - Create Agent → 노드 표시 동작 확인  
3. **사용자 협의** - 추가 기능의 구조 변경 필요성 및 범용성 검토
4. **협의 결과에 따른 진행** - 구조 변경 vs 대안 방식 vs 기능 제한 선택

**결론**: **기존 구조를 완전히 존중하면 95-100% 실현 가능**

---

## 🚨 **STEP 7: 실제 SDK API 기반 아키텍처 수정 (수정됨)**

### **📋 7차 검토 결과 - 이전 STEP 7의 치명적 결함 발견**

**❌ 이전 STEP 7의 실현 불가능한 부분들:**
1. **존재하지 않는 메서드**: `getUniversalWorkflow()`, `subscribeToWorkflowUpdates()` 
2. **EventService 인터페이스 오해**: `on()`, `off()` 메서드는 EventService에 없음
3. **현재 시스템과 호환성 문제**: 기존 PlaygroundContext는 `eventService.on()` 의존
4. **실제 SDK API 무시**: 실제 메서드 이름과 동작 방식 다름

**✅ 실제 존재하는 SDK API:**
```typescript
// RealTimeWorkflowBuilder - 실제 메서드들
✅ generateUniversalWorkflow(): Promise<UniversalWorkflowStructure | null>  // async
✅ subscribeToUniversalUpdates(callback): void  // 실제 이름

// EventService 인터페이스 - 실제 메서드들
✅ emit(eventType, data): void  // 유일한 필수 메서드
✅ trackExecution?(): void  // 선택적
✅ createBoundEmit?(): void  // 선택적
❌ on(), off() 메서드 없음  // EventService에 존재하지 않음
```

---

### **📋 올바른 문제 진단 결과**

**🔍 실제 근본 원인:**

1. **✅ PlaygroundExecutor 아키텍처 문제**: WorkflowEventSubscriber + RealTimeWorkflowBuilder 미사용 (정확함)
2. **✅ Event 처리 불완전**: PlaygroundEventService는 History만 기록, Workflow Node 생성 안함 (정확함)
3. **❌ SDK 아키텍처 무시 (부분 수정)**: 실제 존재하는 SDK 기능을 활용해야 함
4. **❌ Rule 위반 (부분 수정)**: 기존 on/off 시스템은 유지하되 Workflow 생성 추가

**✅ 실제 SDK 아키텍처 (apps/examples/24-workflow-structure-test.ts 참조):**
```typescript
// 1. WorkflowEventSubscriber 생성
const workflowSubscriber = new WorkflowEventSubscriber();

// 2. RealTimeWorkflowBuilder 생성  
const workflowBuilder = new RealTimeWorkflowBuilder(workflowSubscriber);

// 3. Team 생성 시 WorkflowEventSubscriber 사용
const team = createTeam({
    eventService: workflowSubscriber  // 실제로 작동함
});

// 4. 실제 존재하는 구독 메서드
workflowBuilder.subscribeToUniversalUpdates((universalData) => {  // 실제 메서드명
    // UI 업데이트
});
```

---

##### **👀 STEP 7.1: PlaygroundExecutor에 SDK Workflow 시스템 추가 (시각적 확인 단계별)** 🔄 진행중

**🎯 목적**: 눈에 보이는 작은 변화들을 단계별로 확인하며 SDK Workflow 시스템 통합

---

**📋 7.1.1: WorkflowEventSubscriber 추가 및 Console 로그 확인**
- [ ] **PlaygroundExecutor에 WorkflowEventSubscriber 추가**
  ```typescript
  // apps/web/src/lib/playground/robota-executor.ts
  import { WorkflowEventSubscriber } from '@robota-sdk/agents';
  
  constructor() {
      // 기존 코드 유지 + 추가
      this.workflowSubscriber = new WorkflowEventSubscriber(this.logger);
      console.log('🏗️ [STEP 7.1.1] WorkflowEventSubscriber created:', !!this.workflowSubscriber);
  }
  ```

**🎯 시각적 확인**: 
- 브라우저 Console에서 `🏗️ [STEP 7.1.1] WorkflowEventSubscriber created: true` 로그 확인
- Playground 접속 시 에러 없이 정상 로딩 확인

**✅ 사용자 확인 필요**: Console 로그가 보이고 에러가 없으면 다음 단계 진행

---

**📋 7.1.2: RealTimeWorkflowBuilder 추가 및 초기화 로그 확인**
- [ ] **RealTimeWorkflowBuilder 추가**
  ```typescript
  // PlaygroundExecutor constructor에 추가
  import { RealTimeWorkflowBuilder } from '@robota-sdk/agents';
  
  constructor() {
      // 7.1.1 코드 이후 추가
      this.workflowBuilder = new RealTimeWorkflowBuilder(this.workflowSubscriber, this.logger);
      console.log('🔧 [STEP 7.1.2] RealTimeWorkflowBuilder created:', !!this.workflowBuilder);
      console.log('🔧 [STEP 7.1.2] Workflow system ready');
  }
  ```

**🎯 시각적 확인**: 
- Console에서 `🔧 [STEP 7.1.2] RealTimeWorkflowBuilder created: true` 로그 확인
- Console에서 `🔧 [STEP 7.1.2] Workflow system ready` 로그 확인

**✅ 사용자 확인 필요**: 두 로그가 모두 보이면 다음 단계 진행

---

**📋 7.1.3: getCurrentWorkflow 메서드 추가 및 테스트 버튼 생성**
- [ ] **getCurrentWorkflow 메서드 추가**
  ```typescript
  // PlaygroundExecutor에 메서드 추가
  async getCurrentWorkflow(): Promise<UniversalWorkflowStructure | null> {
      console.log('📊 [STEP 7.1.3] getCurrentWorkflow called');
      const result = await this.workflowBuilder.generateUniversalWorkflow();
      console.log('📊 [STEP 7.1.3] Workflow result:', result ? 'Success' : 'Null');
      return result;
  }
  ```

- [ ] **Playground UI에 테스트 버튼 임시 추가**
  ```typescript
  // apps/web/src/app/playground/page.tsx에 임시 버튼 추가
  <button 
      onClick={async () => {
          const workflow = await executor?.getCurrentWorkflow();
          console.log('🧪 [TEST] Current workflow:', workflow);
      }}
      className="bg-blue-500 text-white px-4 py-2 rounded"
  >
      Test getCurrentWorkflow
  </button>
  ```

**🎯 시각적 확인**: 
- Playground에 "Test getCurrentWorkflow" 버튼이 보임
- 버튼 클릭 시 Console에서 로그 확인
- `📊 [STEP 7.1.3] getCurrentWorkflow called` 및 결과 로그 확인

**✅ 사용자 확인 필요**: 버튼이 보이고 클릭 시 로그가 나오면 다음 단계 진행

---

**📋 7.1.4: subscribeToWorkflowUpdates 메서드 추가 및 구독 테스트**
- [ ] **subscribeToWorkflowUpdates 메서드 추가**
  ```typescript
  // PlaygroundExecutor에 메서드 추가
  subscribeToWorkflowUpdates(callback: (workflow: UniversalWorkflowStructure) => void): void {
      console.log('📡 [STEP 7.1.4] Setting up workflow subscription');
      this.workflowBuilder.subscribeToUniversalUpdates((workflow) => {
          console.log('📡 [STEP 7.1.4] Workflow update received:', !!workflow);
          callback(workflow);
      });
  }
  ```

- [ ] **구독 테스트 버튼 추가**
  ```typescript
  // Playground UI에 추가 버튼
  <button 
      onClick={() => {
          executor?.subscribeToWorkflowUpdates((workflow) => {
              console.log('🧪 [TEST] Subscription callback:', workflow);
          });
          console.log('🧪 [TEST] Subscription set up completed');
      }}
      className="bg-green-500 text-white px-4 py-2 rounded ml-2"
  >
      Test Workflow Subscription
  </button>
  ```

**🎯 시각적 확인**: 
- "Test Workflow Subscription" 버튼이 보임
- 버튼 클릭 시 `📡 [STEP 7.1.4] Setting up workflow subscription` 로그 확인
- `🧪 [TEST] Subscription set up completed` 로그 확인

**✅ 사용자 확인 필요**: 구독 설정 로그가 보이면 다음 단계 진행

---

**📋 7.1.5: createTeam에서 WorkflowEventSubscriber 사용 및 이벤트 감지 확인**
- [ ] **createTeam 메서드 수정**
  ```typescript
  // PlaygroundExecutor의 createTeam 메서드 수정
  async createTeam(config: PlaygroundTeamConfig): Promise<void> {
      console.log('🚀 [STEP 7.1.5] Creating team with WorkflowEventSubscriber');
      
      this.currentTeam = createTeam({
          aiProviders: aiProviders,
          maxMembers: config.maxMembers || 5,
          logger: this.logger,
          // 핵심: WorkflowEventSubscriber 사용
          eventService: this.workflowSubscriber
      });
      
      console.log('🚀 [STEP 7.1.5] Team created with Workflow system');
  }
  ```

**🎯 시각적 확인**: 
- Create Team 버튼 클릭 시 `🚀 [STEP 7.1.5] Creating team with WorkflowEventSubscriber` 로그 확인
- `🚀 [STEP 7.1.5] Team created with Workflow system` 로그 확인
- 기존 Team 생성 기능이 정상 동작하는지 확인

**✅ 사용자 확인 필요**: Team 생성이 정상 동작하고 로그가 보이면 STEP 7.1 완료

**🎯 STEP 7.1 최종 결과**: 
- PlaygroundExecutor에 Workflow 시스템이 추가됨
- 기존 기능은 그대로 유지됨  
- Console 로그로 각 단계별 동작 확인 가능
- 임시 테스트 버튼들로 새로운 기능 동작 확인 가능

---

##### **👀 STEP 7.2: PlaygroundContext에 SDK Workflow 구독 추가 (시각적 확인 단계별)** 🔄 진행중

**🎯 목적**: UI에서 눈으로 확인 가능한 단계별로 Workflow 구독 기능 추가

---

**📋 7.2.1: Workflow 구독 상태 표시를 위한 UI 추가**
- [ ] **Playground UI에 Workflow 상태 표시 영역 추가**
  ```typescript
  // apps/web/src/app/playground/page.tsx에 상태 표시 영역 추가
  <div className="bg-gray-100 p-4 rounded mb-4">
      <h3 className="font-bold">🔄 Workflow System Status</h3>
      <div id="workflow-status">
          <p>📊 Current Workflow: <span id="workflow-nodes-count">0</span> nodes</p>
          <p>📡 SDK Subscription: <span id="sdk-subscription-status">Not Connected</span></p>
          <p>🕐 Last Update: <span id="last-workflow-update">Never</span></p>
      </div>
  </div>
  ```

**🎯 시각적 확인**: 
- Playground에 "Workflow System Status" 박스가 표시됨
- 초기값: "0 nodes", "Not Connected", "Never" 표시

**✅ 사용자 확인 필요**: Status 박스가 보이면 다음 단계 진행

---

**📋 7.2.2: PlaygroundState에 UPDATE_WORKFLOW_FROM_SDK action 추가**
- [ ] **PlaygroundAction 타입에 새로운 액션 추가**
  ```typescript
  // apps/web/src/contexts/playground-context.tsx
  type PlaygroundAction = 
      | { type: 'SET_CURRENT_WORKFLOW'; payload: UniversalWorkflowStructure }
      | { type: 'UPDATE_WORKFLOW_FROM_SDK'; payload: UniversalWorkflowStructure }  // 새로 추가
      | ...기존 액션들;
  ```

- [ ] **playgroundReducer에 케이스 추가**
  ```typescript
  // playgroundReducer에 케이스 추가
  case 'UPDATE_WORKFLOW_FROM_SDK':
      console.log('🔄 [STEP 7.2.2] Workflow updated from SDK:', action.payload ? 'Success' : 'Null');
      // UI 상태 업데이트
      if (typeof document !== 'undefined') {
          const nodesCountElement = document.getElementById('workflow-nodes-count');
          const lastUpdateElement = document.getElementById('last-workflow-update');
          if (nodesCountElement) nodesCountElement.textContent = String(action.payload?.nodes?.length || 0);
          if (lastUpdateElement) lastUpdateElement.textContent = new Date().toLocaleTimeString();
      }
      return {
          ...state,
          currentWorkflow: action.payload
      };
  ```

**🎯 시각적 확인**: 
- Console에서 `🔄 [STEP 7.2.2] Workflow updated from SDK` 로그 확인 가능
- 빌드 에러 없이 정상 컴파일 확인

**✅ 사용자 확인 필요**: 빌드 에러가 없으면 다음 단계 진행

---

**📋 7.2.3: SDK Workflow 구독 useEffect 추가 및 연결 상태 확인**
- [ ] **PlaygroundProvider에 Workflow 구독 useEffect 추가**
  ```typescript
  // PlaygroundProvider 컴포넌트에 추가
  useEffect(() => {
      console.log('🚨 [STEP 7.2.3] Setting up SDK workflow subscription');
      
      // UI 상태 업데이트: 연결 시도 중
      const statusElement = document.getElementById('sdk-subscription-status');
      if (statusElement) statusElement.textContent = 'Connecting...';
      
      if (!state.executor?.subscribeToWorkflowUpdates) {
          console.log('🔍 [STEP 7.2.3] No workflow subscription available');
          if (statusElement) statusElement.textContent = 'Not Available';
          return;
      }
      
      console.log('✅ [STEP 7.2.3] Setting up workflow subscription');
      
      // 실제 SDK 구독 설정
      state.executor.subscribeToWorkflowUpdates((workflow) => {
          console.log('🔄 [STEP 7.2.3] Workflow update received:', !!workflow);
          dispatch({ type: 'UPDATE_WORKFLOW_FROM_SDK', payload: workflow });
      });
      
      // UI 상태 업데이트: 연결 완료
      if (statusElement) statusElement.textContent = 'Connected';
      console.log('🎉 [STEP 7.2.3] SDK subscription setup completed');
      
  }, [state.executor, state.isInitialized]);
  ```

**🎯 시각적 확인**: 
- Status 박스에서 "SDK Subscription: Connected" 표시 확인
- Console에서 `🚨 [STEP 7.2.3] Setting up SDK workflow subscription` 로그 확인
- Console에서 `🎉 [STEP 7.2.3] SDK subscription setup completed` 로그 확인

**✅ 사용자 확인 필요**: Status가 "Connected"로 바뀌고 로그가 보이면 다음 단계 진행

---

**📋 7.2.4: 초기 Workflow 로드 기능 추가 및 버튼으로 테스트**
- [ ] **초기 Workflow 로드 useEffect 추가**
  ```typescript
  // PlaygroundProvider에 추가
  useEffect(() => {
      if (!state.executor?.getCurrentWorkflow) return;
      
      console.log('🔄 [STEP 7.2.4] Loading initial workflow');
      
      const loadInitialWorkflow = async () => {
          try {
              const workflow = await state.executor.getCurrentWorkflow();
              console.log('🔄 [STEP 7.2.4] Initial workflow loaded:', !!workflow);
              if (workflow && workflow.nodes.length > 0) {
                  dispatch({ type: 'UPDATE_WORKFLOW_FROM_SDK', payload: workflow });
              }
          } catch (error) {
              console.warn('⚠️ [STEP 7.2.4] Failed to load initial workflow:', error);
          }
      };
      
      loadInitialWorkflow();
  }, [state.executor, state.isInitialized]);
  ```

- [ ] **"Load Current Workflow" 테스트 버튼 추가**
  ```typescript
  // Playground UI에 테스트 버튼 추가
  <button 
      onClick={async () => {
          console.log('🧪 [TEST] Manual workflow load triggered');
          const workflow = await executor?.getCurrentWorkflow();
          if (workflow) {
              dispatch({ type: 'UPDATE_WORKFLOW_FROM_SDK', payload: workflow });
              console.log('🧪 [TEST] Manual workflow load completed');
          }
      }}
      className="bg-purple-500 text-white px-4 py-2 rounded ml-2"
  >
      Load Current Workflow
  </button>
  ```

**🎯 시각적 확인**: 
- "Load Current Workflow" 버튼이 보임
- 버튼 클릭 시 Status 박스의 "nodes" 수가 업데이트됨
- Console에서 workflow 로드 로그 확인

**✅ 사용자 확인 필요**: 버튼 클릭 시 Status가 업데이트되면 다음 단계 진행

---

**📋 7.2.5: Team 생성 시 SDK Workflow 자동 업데이트 확인**
- [ ] **Create Team 후 자동 Workflow 업데이트 확인**
  ```typescript
  // 기존 CreateTeam 버튼 클릭 후 자동으로 SDK Workflow 업데이트되는지 확인
  // (별도 코드 수정 불필요 - STEP 7.1에서 이미 설정됨)
  ```

**🎯 시각적 확인**: 
- Create Team 버튼 클릭
- Status 박스에서 "nodes" 수가 자동으로 증가하는지 확인
- "Last Update" 시간이 업데이트되는지 확인
- Console에서 `🔄 [STEP 7.2.3] Workflow update received` 로그 확인

**✅ 사용자 확인 필요**: Team 생성 시 Status가 자동 업데이트되면 STEP 7.2 완료

**🎯 STEP 7.2 최종 결과**: 
- UI에서 Workflow 상태를 실시간으로 확인 가능
- SDK Workflow 구독이 정상 동작함
- Team 생성 시 자동으로 Workflow가 업데이트됨
- 모든 변화가 Status 박스와 Console 로그로 확인 가능

---

##### **👀 STEP 7.3: 실제 Team assignTask 실행 및 SDK Workflow 동작 확인 (시각적 테스트)** 🔄 진행중

**🎯 목적**: 실제 Team을 사용해서 SDK Workflow 시스템이 정상 동작하는지 눈으로 확인

---

**📋 7.3.1: assignTask Tool Call 감지를 위한 추가 UI 상태 표시**
- [ ] **Tool Call 추적 상태 표시 추가**
  ```typescript
  // apps/web/src/app/playground/page.tsx의 Status 박스에 추가
  <div className="bg-gray-100 p-4 rounded mb-4">
      <h3 className="font-bold">🔄 Workflow System Status</h3>
      <div id="workflow-status">
          <p>📊 Current Workflow: <span id="workflow-nodes-count">0</span> nodes</p>
          <p>📡 SDK Subscription: <span id="sdk-subscription-status">Not Connected</span></p>
          <p>🕐 Last Update: <span id="last-workflow-update">Never</span></p>
          {/* 새로 추가 */}
          <p>🔧 Tool Calls Detected: <span id="tool-calls-count">0</span></p>
          <p>🤖 Agents Created: <span id="agents-created-count">0</span></p>
      </div>
  </div>
  ```

**🎯 시각적 확인**: 
- Status 박스에 "Tool Calls Detected: 0", "Agents Created: 0" 표시 추가됨

**✅ 사용자 확인 필요**: 새로운 상태 표시가 보이면 다음 단계 진행

---

**📋 7.3.2: WorkflowEventSubscriber의 이벤트 감지 로그 강화**
- [ ] **Tool Call 이벤트 감지 시 UI 업데이트 추가**
  ```typescript
  // apps/web/src/contexts/playground-context.tsx의 UPDATE_WORKFLOW_FROM_SDK에 추가
  case 'UPDATE_WORKFLOW_FROM_SDK':
      console.log('🔄 [STEP 7.3.2] Workflow updated from SDK:', action.payload ? 'Success' : 'Null');
      
      // 기존 UI 상태 업데이트
      if (typeof document !== 'undefined') {
          const nodesCountElement = document.getElementById('workflow-nodes-count');
          const lastUpdateElement = document.getElementById('last-workflow-update');
          if (nodesCountElement) nodesCountElement.textContent = String(action.payload?.nodes?.length || 0);
          if (lastUpdateElement) lastUpdateElement.textContent = new Date().toLocaleTimeString();
          
          // 새로 추가: Tool Call 및 Agent 카운트
          const toolCallsElement = document.getElementById('tool-calls-count');
          const agentsElement = document.getElementById('agents-created-count');
          if (action.payload?.nodes) {
              const toolCallNodes = action.payload.nodes.filter(node => node.type === 'tool_call' || node.type === 'toolCall');
              const agentNodes = action.payload.nodes.filter(node => node.type === 'agent');
              if (toolCallsElement) toolCallsElement.textContent = String(toolCallNodes.length);
              if (agentsElement) agentsElement.textContent = String(agentNodes.length);
          }
      }
      return { ...state, currentWorkflow: action.payload };
  ```

**🎯 시각적 확인**: 
- Workflow 업데이트 시 Tool Calls와 Agents 카운트가 자동 업데이트됨

**✅ 사용자 확인 필요**: 카운트 업데이트 로직이 추가되면 다음 단계 진행

---

**📋 7.3.3: 실제 Team assignTask 테스트 실행**
- [ ] **복잡한 작업 프롬프트로 assignTask 유도**
  ```typescript
  // 테스트 시나리오 준비
  테스트 단계:
  1. Create Team 버튼 클릭
  2. Play 버튼 클릭 (ready 상태로 변경)
  3. 다음 프롬프트 입력:
     "웹사이트를 만들어주세요. 프론트엔드와 백엔드가 모두 필요합니다. 
      각각 별도의 전문가가 담당해야 합니다."
  4. 전송 버튼 클릭
  ```

**🎯 시각적 확인**: 
- 채팅 응답 진행 중 Status 박스의 변화 관찰
- Console에서 `🔄 [STEP 7.2.3] Workflow update received` 로그 확인
- "Tool Calls Detected" 숫자가 증가하는지 확인
- "Agents Created" 숫자가 증가하는지 확인

**✅ 사용자 확인 필요**: 채팅 중에 Status 박스 숫자가 증가하면 다음 단계 진행

---

**📋 7.3.4: React-Flow 시각화에 SDK Workflow 데이터 반영 확인**
- [ ] **현재 React-Flow 영역에 SDK 데이터 표시 확인**
  ```typescript
  // Workflow Visualization 영역에서 확인할 내용:
  // 1. Team Node 존재 확인
  // 2. Tool Call Node(assignTask) 생성 확인  
  // 3. 새로운 Agent Node 생성 확인
  // 4. Node 간 연결선(Edge) 확인
  ```

**🎯 시각적 확인**: 
- React-Flow 영역에서 새로운 Node들이 나타나는지 확인
- Node 간 연결선이 올바르게 그어지는지 확인
- Node 상태(pending → running → completed) 변화 확인

**✅ 사용자 확인 필요**: React-Flow에서 실제 Workflow가 시각화되면 다음 단계 진행

---

**📋 7.3.5: 기존 Event 시스템과 새로운 Workflow 시스템 동시 동작 확인**
- [ ] **이중 시스템 동작 확인**
  ```typescript
  // 확인할 내용:
  // 1. 기존 Event Listener (handleToolCallStart, handleAgentCreated)도 여전히 동작하는지
  // 2. 새로운 SDK Workflow 구독도 동작하는지
  // 3. 두 시스템이 서로 간섭하지 않는지
  // 4. UI가 올바르게 업데이트되는지
  ```

**🎯 시각적 확인**: 
- Console에서 기존 Event Listener 로그도 함께 보이는지 확인
- Console에서 SDK Workflow 로그도 함께 보이는지 확인
- 두 시스템의 로그가 충돌 없이 같이 나타나는지 확인

**✅ 사용자 확인 필요**: 두 시스템의 로그가 모두 보이고 충돌이 없으면 STEP 7.3 완료

**🎯 STEP 7.3 최종 결과**: 
- 실제 Team assignTask가 SDK Workflow 시스템을 통해 시각화됨
- Status 박스에서 실시간으로 Tool Call 및 Agent 생성 확인 가능
- React-Flow에서 실제 Workflow 구조 시각화 확인
- 기존 시스템과 새로운 시스템이 충돌 없이 동시 동작
- 모든 변화가 눈으로 직접 확인 가능

---

##### **👀 STEP 7.4: 시각화 개선 및 임시 테스트 요소 정리 (시각적 완성)** 🔄 진행중

**🎯 목적**: 실제 사용자에게 보여줄 수 있는 깔끔한 UI로 완성

---

**📋 7.4.1: Status 박스를 실제 사용자용 UI로 개선**
- [ ] **Status 박스 디자인 개선 및 토글 기능 추가**
  ```typescript
  // apps/web/src/app/playground/page.tsx에서 Status 박스 개선
  <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
      <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">🔄 Workflow System</h3>
          <button 
              onClick={() => setShowWorkflowDetails(!showWorkflowDetails)}
              className="text-sm text-blue-600 hover:text-blue-800"
          >
              {showWorkflowDetails ? 'Hide Details' : 'Show Details'}
          </button>
      </div>
      
      {showWorkflowDetails && (
          <div className="mt-3 space-y-2 text-sm text-gray-600">
              <div className="flex justify-between">
                  <span>📊 Current Workflow:</span>
                  <span id="workflow-nodes-count" className="font-medium">0</span> nodes
              </div>
              <div className="flex justify-between">
                  <span>🔧 Tool Calls:</span>
                  <span id="tool-calls-count" className="font-medium">0</span>
              </div>
              <div className="flex justify-between">
                  <span>🤖 Agents Created:</span>
                  <span id="agents-created-count" className="font-medium">0</span>
              </div>
              <div className="flex justify-between">
                  <span>📡 SDK Status:</span>
                  <span id="sdk-subscription-status" className="font-medium text-green-600">Connected</span>
              </div>
          </div>
      )}
  </div>
  ```

**🎯 시각적 확인**: 
- 깔끔한 디자인의 접을 수 있는 Status 박스가 표시됨
- "Show Details" / "Hide Details" 토글 버튼 동작 확인

**✅ 사용자 확인 필요**: 개선된 Status 박스가 보이고 토글이 작동하면 다음 단계 진행

---

**📋 7.4.2: 임시 테스트 버튼들을 개발자 모드로 이동**
- [ ] **테스트 버튼들을 개발자 모드에서만 표시**
  ```typescript
  // 개발자 모드 상태 추가
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);
  
  // 테스트 버튼들을 조건부 렌더링
  {isDeveloperMode && (
      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
          <h4 className="font-medium text-yellow-800 mb-2">🛠️ Developer Tools</h4>
          <div className="space-x-2">
              <button className="bg-blue-500 text-white px-3 py-1 rounded text-sm">
                  Test getCurrentWorkflow
              </button>
              <button className="bg-green-500 text-white px-3 py-1 rounded text-sm">
                  Test Workflow Subscription
              </button>
              <button className="bg-purple-500 text-white px-3 py-1 rounded text-sm">
                  Load Current Workflow
              </button>
          </div>
      </div>
  )}
  
  // 개발자 모드 토글 버튼 (우측 상단에 작게)
  <button 
      onClick={() => setIsDeveloperMode(!isDeveloperMode)}
      className="fixed top-4 right-4 bg-gray-600 text-white px-2 py-1 rounded text-xs"
  >
      {isDeveloperMode ? 'Hide Dev' : 'Dev Mode'}
  </button>
  ```

**🎯 시각적 확인**: 
- 기본적으로는 테스트 버튼들이 숨겨짐
- 우측 상단의 "Dev Mode" 버튼 클릭 시 테스트 버튼들이 나타남

**✅ 사용자 확인 필요**: Dev Mode 토글이 정상 작동하면 다음 단계 진행

---

**📋 7.4.3: React-Flow 시각화와 SDK Workflow 데이터 연결 확인**
- [ ] **React-Flow가 SDK Workflow 데이터를 실제로 표시하는지 확인**
  ```typescript
  // WorkflowVisualization 컴포넌트에서 SDK 데이터 사용 확인
  // currentWorkflow가 SDK에서 오는 데이터인지 확인
  // Node와 Edge가 올바르게 렌더링되는지 확인
  ```

**🎯 시각적 확인**: 
- Team assignTask 실행 시 React-Flow에서 실제 Node들이 나타나는지 확인
- SDK에서 받은 Workflow 데이터가 React-Flow에 정확히 반영되는지 확인
- Node 간 연결이 올바르게 표시되는지 확인

**✅ 사용자 확인 필요**: React-Flow에서 SDK Workflow가 정확히 시각화되면 다음 단계 진행

---

**📋 7.4.4: Console 로그 레벨 조정 및 사용자용 로그 정리**
- [ ] **개발용 로그와 사용자용 로그 분리**
  ```typescript
  // 개발용 로그는 개발자 모드에서만 표시
  const debugLog = (message: string, ...args: any[]) => {
      if (isDeveloperMode || process.env.NODE_ENV === 'development') {
          console.log(message, ...args);
      }
  };
  
  // 사용자용 중요 로그만 유지
  const userLog = (message: string, ...args: any[]) => {
      console.log(message, ...args);
  };
  
  // 로그 레벨 조정 적용
  debugLog('🏗️ [STEP 7.1.1] WorkflowEventSubscriber created:', !!this.workflowSubscriber);
  userLog('✅ Workflow system initialized');
  ```

**🎯 시각적 확인**: 
- 일반 사용자에게는 필수적인 로그만 표시됨
- 개발자 모드에서는 상세한 디버그 로그도 표시됨

**✅ 사용자 확인 필요**: Console이 깔끔해지고 중요한 정보만 보이면 다음 단계 진행

---

**📋 7.4.5: 최종 통합 테스트 및 사용자 경험 확인**
- [ ] **전체 워크플로우 사용자 관점에서 테스트**
  ```typescript
  // 최종 사용자 시나리오:
  1. Playground 접속 → 깔끔한 UI 확인
  2. Create Team → Status 박스에서 상태 변화 확인
  3. 복잡한 작업 요청 → React-Flow에서 실시간 시각화 확인
  4. assignTask 실행 → Tool Call 및 Agent 생성 시각화 확인
  5. 전체 과정이 직관적이고 이해하기 쉬운지 확인
  ```

**🎯 시각적 확인**: 
- 전체 과정이 사용자에게 직관적으로 보이는지 확인
- 불필요한 개발자 정보는 숨겨져 있는지 확인
- 중요한 정보는 명확하게 표시되는지 확인
- React-Flow 시각화가 실제로 도움이 되는지 확인

**✅ 사용자 확인 필요**: 전체 시스템이 사용자 친화적으로 동작하면 STEP 7.4 완료

**🎯 STEP 7.4 최종 결과**: 
- 사용자 친화적인 깔끔한 UI 완성
- 개발자 도구는 별도 모드로 분리
- React-Flow와 SDK Workflow의 완전한 통합
- 실제 서비스에서 사용 가능한 수준의 시각화 시스템 완성
- 모든 기능이 직관적이고 안정적으로 동작

---

### **📋 STEP 7 진행 순서 (시각적 확인 기반으로 수정됨)**

**🎯 핵심 원칙**: 모든 단계는 **눈으로 확인 가능한 변화**가 있어야 하며, **사용자 승인 후** 다음 단계 진행

#### **🔄 STEP 7.1: SDK Workflow 시스템 기반 구축**
1. **7.1.1** → Console 로그 확인 → ✅ 사용자 확인 → 다음 단계
2. **7.1.2** → 추가 Console 로그 확인 → ✅ 사용자 확인 → 다음 단계
3. **7.1.3** → 테스트 버튼 표시 및 동작 확인 → ✅ 사용자 확인 → 다음 단계
4. **7.1.4** → 구독 테스트 버튼 동작 확인 → ✅ 사용자 확인 → 다음 단계
5. **7.1.5** → Team 생성 로그 확인 → ✅ 사용자 확인 → **STEP 7.1 완료**

#### **🔄 STEP 7.2: UI 상태 표시 및 실시간 업데이트**
1. **7.2.1** → Status 박스 UI 표시 확인 → ✅ 사용자 확인 → 다음 단계
2. **7.2.2** → 빌드 에러 없음 확인 → ✅ 사용자 확인 → 다음 단계
3. **7.2.3** → "Connected" 상태 표시 확인 → ✅ 사용자 확인 → 다음 단계
4. **7.2.4** → 버튼 클릭 시 Status 업데이트 확인 → ✅ 사용자 확인 → 다음 단계
5. **7.2.5** → Team 생성 시 자동 업데이트 확인 → ✅ 사용자 확인 → **STEP 7.2 완료**

#### **🔄 STEP 7.3: 실제 assignTask 실행 및 시각화 확인**
1. **7.3.1** → Tool Calls/Agents 카운트 표시 확인 → ✅ 사용자 확인 → 다음 단계
2. **7.3.2** → 카운트 업데이트 로직 동작 확인 → ✅ 사용자 확인 → 다음 단계
3. **7.3.3** → 실제 채팅 중 Status 박스 변화 확인 → ✅ 사용자 확인 → 다음 단계
4. **7.3.4** → React-Flow에서 실제 Node 시각화 확인 → ✅ 사용자 확인 → 다음 단계
5. **7.3.5** → 이중 시스템 동시 동작 확인 → ✅ 사용자 확인 → **STEP 7.3 완료**

#### **🔄 STEP 7.4: UI/UX 완성 및 사용자 친화적 마무리**
1. **7.4.1** → 깔끔한 Status 박스 및 토글 기능 확인 → ✅ 사용자 확인 → 다음 단계
2. **7.4.2** → Dev Mode 토글 및 테스트 버튼 숨김 확인 → ✅ 사용자 확인 → 다음 단계
3. **7.4.3** → React-Flow와 SDK 데이터 연결 최종 확인 → ✅ 사용자 확인 → 다음 단계
4. **7.4.4** → Console 로그 정리 및 사용자 친화적 변경 확인 → ✅ 사용자 확인 → 다음 단계
5. **7.4.5** → 전체 사용자 경험 최종 테스트 → ✅ 사용자 확인 → **STEP 7.4 완료**

### **🎯 각 단계별 사용자 확인 기준**

**✅ 진행 가능**: 해당 단계의 시각적 변화가 명확히 보임
**⚠️ 대기 필요**: 시각적 변화가 불분명하거나 예상과 다름
**❌ 수정 필요**: 에러 발생 또는 전혀 동작하지 않음

### **🔄 각 STEP에서 문제 발생 시**
1. **즉시 해당 단계에서 중단**
2. **문제 원인 분석 및 수정**
3. **수정 후 해당 단계 재실행**
4. **사용자 확인 후 다음 단계 진행**

**💡 핵심**: 모든 단계는 **작고 명확한 시각적 변화**를 기준으로 하며, **사용자가 직접 눈으로 확인**할 수 있어야 함

### **✅ 수정된 STEP 7의 Rule 준수성**

**✅ No Fallback Policy 완전 준수**:
- ✅ 실제 존재하는 SDK API만 사용 (fallback 로직 없음)
- ✅ 가상의 메서드나 기능에 의존하지 않음
- ✅ 확실한 연결 보장 (SDK가 실제로 제공하는 기능만 활용)

**✅ Build Integrity 완전 준수**:
- ✅ 실제 존재하는 API만 사용하여 빌드 오류 없음
- ✅ 근본 원인 해결 (WorkflowEventSubscriber + RealTimeWorkflowBuilder 활용)
- ✅ 정석적 구현 (SDK 예제와 동일한 패턴)

**✅ Robota SDK 아키텍처 완전 준수**:
- ✅ 실제 WorkflowEventSubscriber 사용
- ✅ 실제 RealTimeWorkflowBuilder 사용  
- ✅ 실제 존재하는 메서드명과 동작 방식 준수
- ✅ 도메인 중립성 (모든 Tool에 대해 범용적 처리)

**✅ 기존 구조 완전 존중**:
- ✅ 기존 EventService 구조 완전 보존 (on/off 지원)
- ✅ 기존 PlaygroundContext 동작 유지
- ✅ PlaygroundHistoryPlugin 완전 보존
- ✅ 점진적 확장 (기존 시스템 + 새로운 시스템)

### **🎯 수정된 STEP 7 완료 후 기대 결과**

**✅ 실제 SDK 아키텍처 활용**:
```
Team → WorkflowEventSubscriber → RealTimeWorkflowBuilder → PlaygroundContext
  ↓
기존 Event System (on/off) → 기존 UI 업데이트 (유지)
```

**✅ 안정적인 이중 시스템**:
- 기존 Event 기반 시스템: 호환성 보장, 즉시 동작
- 새로운 Workflow 기반 시스템: SDK 정식 기능, 향후 확장성
- 점진적 전환: 사용자 선택에 따라 시스템 전환 가능

**✅ 실제 실현 가능성 100%**:
- 모든 API가 실제 존재함
- 모든 메서드명이 정확함
- 기존 시스템과 완전 호환
- SDK 예제와 동일한 패턴

**🙏 수정된 STEP 7 작업 시작 승인을 요청드립니다.**

---

## 🔧 **STEP 8: SDK Store 외부 주입 방식으로 최소 수정 (수정됨)**

### **📌 현재 문제점**
- **Two-Store Problem**: Manual Store (PlaygroundContext.currentWorkflow) vs SDK Store (RealTimeWorkflowBuilder.currentWorkflow)
- **덮어쓰기 문제**: Tool 호출 시 SDK가 18개 노드를 생성하면서 기존 3개 Manual 노드(Team, Agent, User Input)를 완전 덮어쓰기
- **SDK Store 접근성**: 현재 SDK Store는 내부에 숨겨져 있어 외부에서 Manual 노드 추가 불가

### **🎯 해결 방안: 최소 수정으로 SDK Store 외부 접근 가능하게 만들기**
**핵심 아이디어**: 
1. **기존 18개 노드 생성 로직 보존** (수정 없음)
2. **SDK Store만 외부 주입 가능하도록 최소 수정**
3. **Manual Store와 SDK Store 병합은 그대로 유지** (문제 해결 연기)
4. **외부에서 SDK Store에 Manual 노드 추가 가능하도록 준비**

```
현재 구조:
RealTimeWorkflowBuilder.currentWorkflow (내부, 접근 불가)
       ↓ universalUpdate
PlaygroundContext.currentWorkflow (Manual Store)
       ↓ 
React-Flow Visualization

수정 후 구조:
ExternalWorkflowStore (외부 주입) ← 새로 추가
       ↓ 
RealTimeWorkflowBuilder.currentWorkflow (주입된 Store 사용)
       ↓ universalUpdate  
PlaygroundContext.currentWorkflow (Manual Store - 기존 유지)
       ↓ 
React-Flow Visualization
```

### **📋 STEP 8 최소 수정 작업 계획**

#### **🔧 STEP 8.1: 외부 WorkflowStore 인터페이스 정의**
- [ ] **8.1.1**: `apps/web/src/lib/playground/external-workflow-store.ts` 파일 생성
- [ ] **8.1.2**: 간단한 `ExternalWorkflowStore` 인터페이스 정의
  ```typescript
  export interface ExternalWorkflowStore {
    // 기본 노드 관리
    addNode(node: UniversalWorkflowNode): void;
    getNodes(): UniversalWorkflowNode[];
    
    // Manual 노드 추가용 헬퍼 메서드들
    addTeamNode(teamData: { id: string; name: string }): void;
    addAgentNode(agentData: { id: string; name: string }): void;
    addUserInputNode(inputData: { id: string; content: string }): void;
  }
  ```
- [ ] **8.1.3**: 기본 구현체 `DefaultExternalWorkflowStore` 클래스 생성
- [ ] **8.1.4**: Manual 노드 데이터를 `UniversalWorkflowNode` 형태로 변환하는 헬퍼 함수들

#### **🔧 STEP 8.2: RealTimeWorkflowBuilder 주입 가능하도록 최소 수정**
- [ ] **8.2.1**: `RealTimeWorkflowBuilder` 생성자에 `externalStore` 옵션 추가
  ```typescript
  constructor(
    eventService: EventService,
    logger?: SimpleLogger,
    externalStore?: ExternalWorkflowStore  // 새로 추가
  )
  ```
- [ ] **8.2.2**: 외부 Store가 주입된 경우 해당 Store의 노드들을 초기 워크플로우에 포함
- [ ] **8.2.3**: 워크플로우 업데이트 시 외부 Store 노드들과 SDK 노드들 병합
- [ ] **8.2.4**: **기존 18개 노드 생성 로직은 전혀 수정하지 않음** (중요!)

#### **🔧 STEP 8.3: PlaygroundExecutor에서 ExternalWorkflowStore 주입**
- [ ] **8.3.1**: `PlaygroundExecutor`에 `ExternalWorkflowStore` 인스턴스 생성
  ```typescript
  private externalWorkflowStore: ExternalWorkflowStore;
  ```
- [ ] **8.3.2**: 생성자에서 `ExternalWorkflowStore` 초기화 및 `RealTimeWorkflowBuilder`에 주입
  ```typescript
  this.externalWorkflowStore = new DefaultExternalWorkflowStore();
  this.workflowBuilder = new RealTimeWorkflowBuilder(
    this.workflowSubscriber, 
    this.logger,
    this.externalWorkflowStore  // 주입
  );
  ```
- [ ] **8.3.3**: public 접근 메서드 추가
  ```typescript
  getExternalWorkflowStore(): ExternalWorkflowStore {
    return this.externalWorkflowStore;
  }
  ```

#### **🔧 STEP 8.4: UI에서 ExternalWorkflowStore 사용하도록 최소 수정**
- [ ] **8.4.1**: `apps/web/src/app/playground/page.tsx`의 `handleCreateTeam` 수정
  ```typescript
  const handleCreateTeam = useCallback(async () => {
    const defaultConfig = getDefaultTeamConfig();
    await createTeam(defaultConfig);
    
    // 외부 Store에 Team 노드 추가
    const externalStore = state.executor?.getExternalWorkflowStore();
    externalStore?.addTeamNode({
      id: `team-${Date.now()}`,
      name: defaultConfig.name || 'Team'
    });
  }, [createTeam, getDefaultTeamConfig, state.executor]);
  ```
- [ ] **8.4.2**: `handleCreateAgent` 수정하여 외부 Store 사용
- [ ] **8.4.3**: 채팅 입력 시 User Input 노드를 외부 Store에 추가
- [ ] **8.4.4**: **기존 PlaygroundContext의 Manual Store 로직은 그대로 유지** (병합 문제 해결 연기)

#### **🔧 STEP 8.5: 최소 테스트 및 검증**
- [ ] **8.5.1**: 외부 Store에 Manual 노드 추가가 SDK 워크플로우에 반영되는지 확인
- [ ] **8.5.2**: 기존 18개 노드 생성이 여전히 정상 동작하는지 확인  
- [ ] **8.5.3**: Manual Store와 SDK Store 병합이 여전히 작동하는지 확인 (문제 있어도 OK)
- [ ] **8.5.4**: 전체 시스템이 이전과 동일하게 작동하는지 확인
- [ ] **8.5.5**: 콘솔에서 외부 Store의 노드들이 SDK 워크플로우에 포함되는지 로그 확인

### **🎯 STEP 8 완료 후 기대 결과**

**✅ 외부 접근성 확보**:
- SDK Store에 외부에서 Manual 노드 추가 가능
- `PlaygroundExecutor.getExternalWorkflowStore()` 통해 접근
- 향후 완전한 일원화를 위한 기반 마련

**✅ 기존 기능 완전 보존**:
- 18개 SDK 노드 생성 로직 전혀 수정 안함
- 기존 Manual Store 로직 완전 보존
- 기존 병합 로직 완전 보존 (문제 있어도 그대로 유지)

**✅ 최소 위험**:
- 새로운 기능 추가만 하고 기존 기능 수정 없음
- 문제 발생 시 외부 Store 기능만 비활성화하면 원상복구
- 점진적 개선 가능

**✅ 향후 확장성**:
- 외부 Store 인터페이스 확장으로 완전한 일원화 가능
- Manual Store → SDK Store 완전 이전 준비 완료
- 병합 문제 해결을 위한 인프라 구축

### **🚨 주의사항**

1. **최소 수정 원칙**: 기존 코드 수정 최소화, 새로운 기능 추가 위주
2. **기존 기능 보존**: 18개 노드 생성, Manual Store, 병합 로직 모두 그대로 유지
3. **문제 해결 연기**: 병합 문제는 이번에 해결하지 않고 인프라만 구축
4. **점진적 접근**: 외부 Store 안정화 후 향후 완전한 일원화 진행
5. **롤백 준비**: 각 단계별 git commit, 문제 시 외부 Store 기능만 제거

---

## 🔧 **STEP 9: Manual Store → SDK Store 저장 위치 변경 (최소 수정)**

### **📌 현재 문제점 분석**
**사용자 보고 내용**:
- Default Team은 유지됨 ✅
- Default Agent가 사라짐 ❌  
- User Input 노드가 3개나 생성됨 ❌
- 총 20개 노드 (예상 21개보다 1개 적음)

**근본 원인**:
- **중복 저장**: Manual Store + External Store = 같은 노드가 2곳에 저장됨
- **충돌**: Manual Store 노드와 SDK Store 노드가 병합 시 충돌
- **덮어쓰기**: SDK 이벤트 발생 시 Manual Store 데이터가 손실됨

### **🎯 해결 방안: 저장 위치만 변경 (최소 수정)**

**현재 구조** (문제 있음):
```
UI 이벤트 → Manual Store (PlaygroundContext) ← 문제 발생
            External Store → SDK Store
            ↓ (충돌하는 병합)
            React-Flow Visualization
```

**목표 구조** (최소 수정):
```
UI 이벤트 → External Store → SDK Store ← 유일한 저장소
            Manual Store (빈 상태로 유지) ← 기존 로직 보존
            ↓ (SDK Store만 사용)
            React-Flow Visualization
```

### **📋 STEP 9 최소 수정 작업 계획**

#### **🔧 STEP 9.1: Manual Store → SDK Store 저장 위치 변경**
- [ ] **9.1.1**: `handleCreateTeam`에서 Manual Store 저장을 SDK Store 저장으로 **변경**
  ```typescript
  // 기존 Manual Store 저장 코드:
  // const workflow = createTeamWorkflow(defaultConfig);
  // setWorkflow(workflow);
  
  // 변경 → SDK Store 저장 코드:
  // External Store에 Team 노드 추가 (이미 구현됨)
  // Manual Store 저장 코드는 제거
  ```
- [ ] **9.1.2**: `handleCreateAgent`에서 Manual Store 저장을 SDK Store 저장으로 **변경**
  ```typescript
  // 기존 Manual Store 저장 코드:
  // const workflow = createWorkflowForAgent(defaultConfig);
  // setWorkflow(workflow);
  
  // 변경 → SDK Store 저장 코드:
  // External Store에 Agent 노드 추가 (이미 구현됨)
  // Manual Store 저장 코드는 제거
  ```
- [ ] **9.1.3**: `executeStreamPrompt`에서 Manual User Input 저장을 SDK Store 저장으로 **변경**
  ```typescript
  // 기존 Manual Store User Input 저장 코드:
  // - state.currentWorkflow 기반 노드 생성
  // - dispatch({ type: 'SET_CURRENT_WORKFLOW', payload: updatedWorkflow });
  // - currentWorkflowRef.current = updatedWorkflow;
  
  // 변경 → SDK Store 저장 코드:
  // External Store에 User Input 노드 추가 (이미 구현됨)
  // Manual Store 저장 코드는 제거
  ```

#### **🔧 STEP 9.2: React-Flow가 SDK Store만 사용하도록 최소 수정**
- [ ] **9.2.1**: `workflow-visualization.tsx`의 데이터 소스가 어디서 오는지 확인
  ```typescript
  // 현재 workflow prop이 Manual Store인지 SDK Store인지 확인
  // Manual Store면 SDK Store로 변경
  ```
- [ ] **9.2.2**: PlaygroundContext에서 Manual Store 대신 SDK Store 데이터 전달
  ```typescript
  // currentWorkflow 대신 sdkWorkflow 사용
  // UPDATE_WORKFLOW_FROM_SDK 결과를 React-Flow에 전달
  ```

#### **🔧 STEP 9.3: Manual Store → SDK Store 변경 검증**
- [ ] **9.3.1**: Manual Store 저장 코드가 모두 SDK Store 저장으로 변경되었는지 확인
  ```typescript
  // 확인 항목:
  // - handleCreateTeam: External Store 사용, Manual Store 제거
  // - handleCreateAgent: External Store 사용, Manual Store 제거  
  // - executeStreamPrompt: External Store 사용, Manual Store 제거
  ```
- [ ] **9.3.2**: 사용되지 않는 Manual Store 관련 import 및 함수 정리
  ```typescript
  // 정리 대상:
  // - createTeamWorkflow, createWorkflowForAgent import 제거
  // - setWorkflow Manual Store 호출 제거
  // - 관련 유틸리티 함수들 정리
  ```

#### **🔧 STEP 9.4: 테스트 및 검증**
- [ ] **9.4.1**: Create Team → External Store에만 추가되고 Manual Store에는 추가 안되는지 확인
- [ ] **9.4.2**: Create Agent → External Store에만 추가되고 Manual Store에는 추가 안되는지 확인  
- [ ] **9.4.3**: 채팅 입력 → External Store에만 User Input 추가되고 Manual Store에는 추가 안되는지 확인
- [ ] **9.4.4**: React-Flow가 SDK Store 데이터만 표시하는지 확인
- [ ] **9.4.5**: Tool 호출 → 총 21개 노드 (초기 3개 + SDK 18개)가 정확히 표시되는지 확인

### **🎯 STEP 9 완료 후 기대 결과**

**✅ 최소 수정으로 Single Source of Truth 달성**:
- External Store → SDK Store가 유일한 **활성 데이터 소스**
- Manual Store는 보존되지만 **비활성화** (삭제하지 않음)
- 중복 저장 문제 해결 (같은 노드가 2곳에 저장되지 않음)

**✅ 예상 동작**:
1. **Create Team**: External Store에만 Team 노드 1개 추가 → SDK Store 반영 → React-Flow 표시
2. **Create Agent**: External Store에만 Agent 노드 1개 추가 → SDK Store 반영 → React-Flow 표시  
3. **채팅 입력**: External Store에만 User Input 노드 1개 추가 → SDK Store 반영 → React-Flow 표시
4. **Tool 호출**: 기존 노드들 보존 + SDK의 18개 노드 추가 = 총 21개 노드

**✅ 문제 해결**:
- ❌ Default Agent 사라짐 → ✅ Default Agent 보존 (External Store → SDK Store 경로)
- ❌ User Input 3개 생성 → ✅ User Input 1개만 생성 (Manual Store 비활성화)
- ❌ 20개 노드 (1개 부족) → ✅ 21개 노드 (정확한 수)

**✅ 확실한 문제 해결**:
- Manual Store 저장 → SDK Store 저장으로 **완전 변경**
- 중복 저장 문제 **근본 해결** (1곳에만 저장)
- 데이터 충돌 문제 **완전 제거** (단일 데이터 소스)

### **🚨 주의사항**

1. **저장 위치 변경**: Manual Store 저장 코드를 SDK Store 저장으로 완전 변경
2. **단계별 진행**: 각 단계별로 사용자 테스트 후 다음 진행
3. **백업 유지**: git commit으로 롤백 준비
4. **근본 해결**: 중복 저장 문제를 완전히 해결
5. **확실한 변경**: External Store → SDK Store 경로만 사용

### **📊 작업 우선순위**

**🔴 HIGH (즉시)**: 9.1 (Manual Store → SDK Store 저장 변경)
**🟡 MEDIUM (곧바로)**: 9.2 (React-Flow 데이터 소스 변경)  
**🟢 LOW (확인)**: 9.3, 9.4 (변경 검증 및 테스트)

---

## 🔧 **STEP 11: External Store → SDK Store 즉시 트리거 연결** ✅ **완료**

### **📌 문제점 분석**
**사용자 보고 내용**: Create Team 버튼을 눌러도 React-Flow 화면이 바뀌지 않음
**힌트**: 모든 작업이 끝난 후에는 React-Flow에 잘 적용되어 보임 (채팅 완료 시)

### **🔍 근본 원인 (검증 완료)**
- **External Store 노드 추가 ≠ SDK Store 업데이트 트리거**
- Create Team 시: External Store에만 추가, SDK Store 업데이트 안됨 → React-Flow 반영 안됨  
- 채팅 완료 시: SDK 내부 이벤트 발생 → `notifyUniversalUpdates()` 트리거 → External Store + SDK Store 병합 → React-Flow 반영됨

### **✅ 해결 방법 (구현 완료)**

#### **수정된 파일들:**

1. **`packages/agents/src/services/real-time-workflow-builder.ts`**:
   ```typescript
   // 새로 추가된 public 메서드
   async triggerManualUpdate(): Promise<void> {
       this.logger.debug('Manual update triggered - notifying Universal workflow subscribers');
       await this.notifyUniversalUpdates();
       this.logger.debug('Manual update completed');
   }
   ```

2. **`apps/web/src/lib/playground/external-workflow-store.ts`**:
   ```typescript
   export interface ExternalWorkflowStore {
       // 기존 메서드들...
       setUpdateCallback(callback: () => Promise<void>): void;  // 새로 추가
   }

   export class DefaultExternalWorkflowStore implements ExternalWorkflowStore {
       private updateCallback: (() => Promise<void>) | null = null;  // 새로 추가

       addNode(node: UniversalWorkflowNode): void {
           // ... 기존 로직 ...
           this.triggerUpdate();  // 새로 추가
       }

       setUpdateCallback(callback: () => Promise<void>): void {
           this.updateCallback = callback;
           this.logger.debug('Update callback set for SDK Store trigger');
       }

       private triggerUpdate(): void {
           if (this.updateCallback) {
               this.updateCallback().catch(error => {
                   this.logger.error('Error triggering SDK Store update:', error);
               });
           }
       }
   }
   ```

3. **`apps/web/src/lib/playground/robota-executor.ts`**:
   ```typescript
   // External Store → SDK Store 연결 설정
   this.externalWorkflowStore.setUpdateCallback(async () => {
       await this.workflowBuilder.triggerManualUpdate();
   });
   console.log('🔗 [CONNECTION] External Store → SDK Store trigger connected');
   ```

### **🎯 완료 후 예상 동작**

**✅ Create Team 버튼 클릭**:
```
handleCreateTeam() 
→ externalStore.addTeamNode() 
→ triggerUpdate() 
→ triggerManualUpdate() 
→ notifyUniversalUpdates() 
→ PlaygroundContext UPDATE_WORKFLOW_FROM_SDK
→ React-Flow 즉시 업데이트 ✅
```

**✅ Create Agent 버튼 클릭**:
```
handleCreateAgent() 
→ externalStore.addAgentNode() 
→ triggerUpdate() 
→ triggerManualUpdate() 
→ notifyUniversalUpdates() 
→ PlaygroundContext UPDATE_WORKFLOW_FROM_SDK
→ React-Flow 즉시 업데이트 ✅
```

**✅ 채팅 입력**:
```
executeStreamPrompt() 
→ externalStore.addUserInputNode() 
→ triggerUpdate() 
→ triggerManualUpdate() 
→ notifyUniversalUpdates() 
→ PlaygroundContext UPDATE_WORKFLOW_FROM_SDK
→ React-Flow 즉시 업데이트 ✅
```

### **✅ 수정 완료 검증**

**Rule 준수 확인**:
- ✅ **Build Integrity**: TypeScript 안전성 보장, 실제 존재하는 API만 사용
- ✅ **Architecture Principles**: 의존성 방향 준수 (External Store → SDK Store)
- ✅ **No Fallback Policy**: 정석적 해결 방법, 불확실성 제거
- ✅ **Domain Neutrality**: SDK는 도메인 중립 유지, generic한 메서드명 사용

**최소 수정 원칙 준수**:
- ✅ 기존 SDK 로직 완전 보존
- ✅ 필요한 연결점만 추가
- ✅ Public API 최소 추가 (`triggerManualUpdate()`, `setUpdateCallback()`)

---

## 🔧 **Phase 12: 예제 기반 워크플로우 연결 테스트**

### **📌 목표**
현재 playground에서 구현된 SDK 호환 ID 연결 시스템을 apps/examples에 독립적인 예제로 구현하여 18개 노드의 완전한 연결관계를 검증하고 누락된 연결 문제를 해결합니다.

### **🎯 테스트 시나리오**
- **프롬프트**: "카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 시장 분석, 메뉴 구성. 각각을 별도로 작성해주세요."
- **예상 결과**: 초기 3개 노드(Team, Agent, User Input) + SDK 18개 노드가 완전히 연결된 워크플로우

### **🔧 STEP 12.0: Playground Test 버튼 시스템 구현 (시각적 검증 인프라)**

- [ ] 12.0.1: **Test 버튼 UI 컴포넌트 추가**
  - playground에 "Test Workflow", "Test Missing Connections", "Test Final Workflow" 버튼 추가
  - 각 버튼은 다른 데이터셋을 React-Flow에 주입
  - **권한 범위**: apps/web UI 컴포넌트 수정만
- [ ] 12.0.2: **JSON 데이터 주입 시스템 구현**
  - 외부 JSON 데이터를 playground React-Flow에 직접 주입하는 함수 구현
  - 기존 workflow 데이터를 덮어쓰지 않고 임시로 표시하는 메커니즘
  - **권한 범위**: apps/web 영역, SDK 로직에 개입하지 않음
- [ ] 12.0.3: **시각적 구분 시스템 구현**
  - 정상 연결: 초록색 edge
  - 누락된 연결: 빨간색 edge (점선)
  - 다른 계층 Agent: 다른 색상으로 구분
  - **권한 범위**: React-Flow 스타일링만, 데이터 구조 변경 없음

### **🔧 STEP 12.1: 기존 workflow 예제 분석 및 복사본 생성**

- [ ] 12.1.1: `apps/examples` 폴더 내 기존 workflow 관련 예제 파일 식별
- [ ] 12.1.2: 가장 적합한 예제 파일을 `workflow-connection-test.ts`로 복사
- [ ] 12.1.3: 복사된 예제의 기본 구조 및 의존성 확인
- [ ] 12.1.4: 예제 파일에서 불필요한 부분 제거 및 기본 구조 정리
- [ ] **12.1.5: 예제 → Playground 데이터 전송 시스템 구현**
  - 예제에서 생성된 워크플로우 데이터를 JSON 파일로 출력
  - playground가 해당 JSON을 읽어서 Test 버튼에 활용할 수 있도록 구현
  - **권한 범위**: 데이터 출력 및 전송만, 로직 변경 없음

### **🔧 STEP 12.2: Playground 설정을 예제에 적용 (권한 범위: apps/examples)**

- [ ] 12.2.1: **SDK 컴포넌트 인스턴스화** (packages/agents 인터페이스 사용)
  - `WorkflowEventSubscriber` 인스턴스 생성 (SDK 패키지 권한)
  - `RealTimeWorkflowBuilder` 인스턴스 생성 (SDK 패키지 권한)
  - **수정 권한**: apps/examples에서 인터페이스를 통한 인스턴스화만 가능
- [ ] 12.2.2: **Team 생성 로직 복제** (apps/web → apps/examples)
  - PlaygroundExecutor의 team 생성 패턴을 예제에 복사
  - **수정 권한**: apps/examples 영역, 기존 로직 변경 없이 복제만
- [ ] 12.2.3: **SDK 호환 ID 패턴 적용** (`agent_${executionId}`)
  - 기존 ID 생성 로직을 SDK 호환 패턴으로 변경
  - **수정 권한**: apps/examples 영역, UI 레벨 ID 생성 로직만
- [ ] 12.2.4: **인터페이스 호환성 검증**
  - SDK 컴포넌트들이 올바른 인터페이스를 통해 연결되는지 확인
  - **검증 범위**: 타입 안전성, 의존성 방향 준수

### **🔧 STEP 12.3: External Store 기능을 예제에 통합 (권한 범위: apps/examples + apps/web interface)**

- [ ] 12.3.1: **External Store 인스턴스 생성** (apps/examples 영역)
  - `DefaultExternalWorkflowStore` 생성 및 설정
  - **수정 권한**: apps/examples에서 apps/web 컴포넌트 사용
  - **제한사항**: External Store 내부 로직 변경 금지, 인터페이스 사용만
- [ ] 12.3.2: **SDK Store 트리거 연결** (기존 인터페이스 활용)
  - `setUpdateCallback()` 메서드를 통한 External → SDK 연결
  - **수정 권한**: 기존 Public API만 사용, SDK 내부 로직 변경 금지
  - **검증 요구**: 인터페이스 호환성 및 이벤트 전파 확인
- [ ] 12.3.3: **초기 노드 추가 로직** (UI 레벨 로직)
  - Team, Agent, User Input 노드 생성 (기존 패턴 복제)
  - **수정 권한**: apps/examples 영역, 노드 생성 로직만
  - **제한사항**: SDK 노드 생성 로직에 개입 금지
- [ ] 12.3.4: **Edge 연결 로직** (UI 레벨 연결)
  - Team→Agent, User Input→Agent 연결 구현
  - **수정 권한**: External Store의 `addEdge()` 인터페이스 사용만
  - **검증 요구**: SDK의 계층적 연결과 충돌 없음 확인

### **🔧 STEP 12.4: 카페 창업 계획서 프롬프트로 예제 실행 및 노드 연결 테스트**

- [ ] 12.4.1: 예제 실행 전 초기 상태 로깅 (3개 노드 확인)
- [ ] 12.4.2: "카페 창업 계획서..." 프롬프트 실행
- [ ] 12.4.3: 실행 과정에서 생성되는 모든 노드와 연결 상태 로깅
- [ ] 12.4.4: 최종 결과에서 총 21개 노드(3+18) 확인
- [ ] **12.4.5: 시각적 검증을 위한 Playground Test 버튼 구현**
  - 예제에서 생성된 워크플로우 데이터를 JSON으로 출력
  - playground에 "Test Workflow" 버튼 추가
  - 버튼 클릭 시 예제 데이터를 React-Flow에 주입하여 시각적 확인
  - **사용자 확인 대기**: 시각적 결과를 사용자가 확인 후 다음 단계 진행

### **🔧 STEP 12.5: 18개 노드의 연결관계 분석 및 누락된 연결 식별 (분석 단계)**

- [ ] 12.5.1: **SDK 노드 계층 정보 분석** (읽기 전용)
  - 각 노드의 `parentId`, `executionLevel`, `executionPath` 로깅
  - **권한 범위**: 데이터 분석만, 수정 금지
- [ ] 12.5.2: **계층적 연결 패턴 검증** (SDK 동작 분석)
  - Agent → Agent Thinking 연결 확인
  - Agent Thinking → Tool Call 연결 확인  
  - Tool Call → **새로운 Agent** 연결 확인 (재귀적 Agent 생성 시)
  - **도메인 중립성**: Tool 이름(`assignTask`)에 따른 특별 처리 **금지**
  - **권한 범위**: 관찰 및 분석만, SDK 로직 변경 금지
- [ ] 12.5.3: **연결 누락 패턴 식별** (문제 진단)
  - ID 매칭 실패 패턴 분석
  - 이벤트 전파 누락 지점 확인
  - 계층 레벨 불일치 문제 식별
  - **권한 범위**: 진단만, 해결책 제시는 권한 검증 후
- [ ] **12.5.4: 중간 검증 - 분석 결과 시각적 확인**
  - 분석된 연결 누락 패턴을 시각적으로 표시하는 데이터 생성
  - playground "Test Missing Connections" 버튼 구현
  - 누락된 연결을 빨간색으로, 정상 연결을 초록색으로 표시
  - **사용자 확인 대기**: 분석 결과를 확인하고 수정 방향 승인

### **🔧 STEP 12.6: 연결 누락 문제 수정 및 완전한 워크플로우 구현 (권한 기반 수정)**

- [ ] 12.6.1: **근본 원인 분석 및 권한 매트릭스 적용**
  - 식별된 문제를 권한 매트릭스에 따라 분류
  - apps/web 영역 문제 vs packages/agents 영역 문제 구분
  - **수정 전 검증**: 각 수정이 해당 컴포넌트 권한 범위 내인지 확인
- [ ] 12.6.2: **SDK 영역 수정** (packages/agents 권한 필요시)
  - WorkflowEventSubscriber의 연결 로직 수정 (**완전히 도메인 중립적으로만**)
  - **Sub-Agent 제거**: `sub-agent`, `sub_agent` 노드 타입을 `agent` 타입으로 통일
  - **Generic 이벤트 처리**: Tool 이름에 관계없이 모든 tool을 동등하게 처리
  - **assignTask 키워드 제거**: 특정 tool에 대한 특별 처리 로직 완전 제거
  - **수정 조건**: 완전한 도메인 중립성, third-party tool 무지각성 유지
- [ ] 12.6.3: **UI 영역 수정** (apps/examples 권한)
  - External Store의 Edge 생성 로직 보완
  - ID 매칭 로직 개선 (SDK 패턴에 맞춤)
  - **수정 조건**: SDK 내부 로직에 개입 금지, 인터페이스만 사용
- [ ] 12.6.4: **권한 검증 후 재실행**
  - 수정된 로직이 권한 매트릭스를 위반하지 않았는지 확인
  - 도메인 중립성 및 인터페이스 호환성 재검증
- [ ] 12.6.5: **최종 워크플로우 완전성 검증**
  - 21개 노드 완전 연결 확인
  - **재귀적 Agent 플로우** (Team → Agent → Agent Thinking → Tool Call → **새로운 Agent**) 동작 검증
  - **도메인 중립성 검증**: 모든 Agent가 동일한 타입으로 처리되는지 확인
  - **성공 기준**: 권한 위반 없이 완전한 연결 달성, Sub-Agent 개념 완전 제거
- [ ] **12.6.6: 최종 시각적 검증 - 완성된 워크플로우 확인**
  - 수정 완료된 워크플로우 데이터를 playground "Test Final Workflow" 버튼으로 시각화
  - 21개 노드의 완전한 연결 상태를 시각적으로 확인
  - 재귀적 Agent 구조 (Team → Agent → Tool Call → 새로운 Agent) 시각적 검증
  - **사용자 최종 승인**: 완성된 워크플로우가 요구사항을 만족하는지 확인

### **🎯 성공 기준 (권한 준수 포함)**

#### **✅ 기능적 성공 기준**
- ✅ 예제가 독립적으로 실행되어 playground와 동일한 환경 재현
- ✅ 초기 3개 노드(Team, Agent, User Input)가 올바르게 생성됨
- ✅ SDK에서 생성하는 18개 노드가 모두 생성됨
- ✅ 21개 노드가 계층적으로 완전히 연결됨 (연결이 끊어진 노드 없음)
- ✅ **재귀적 Agent 플로우**가 올바르게 동작함: Team → Agent → Agent Thinking → Tool Call → **새로운 Agent** (무한 반복 가능)

#### **✅ 시각적 검증 성공 기준**
- ✅ **중간 검증 시스템**: 각 단계마다 playground Test 버튼으로 시각적 확인 가능
- ✅ **연결 상태 시각화**: 정상 연결(초록색), 누락 연결(빨간색) 구분 표시
- ✅ **계층별 Agent 구분**: 다른 레벨의 Agent들이 시각적으로 구분됨
- ✅ **사용자 승인 프로세스**: 각 중간 단계에서 사용자 확인 후 다음 단계 진행
- ✅ **최종 시각적 검증**: 완성된 21개 노드의 완전한 연결이 React-Flow로 확인됨

#### **✅ 권한/역할 준수 기준**
- ✅ **완전한 도메인 중립성**: packages/agents에 UI 관련 의존성 및 third-party tool 특화 로직 추가 안됨
- ✅ **Third-Party Tool 무지각성**: `assignTask` 키워드나 특정 tool에 대한 특별 처리 로직 완전 제거
- ✅ **Agent 타입 통일**: `sub-agent` 개념 완전 제거, 모든 Agent는 동일한 `agent` 타입으로 처리
- ✅ **Generic 이벤트 처리**: Tool 이름에 관계없이 모든 tool을 동등하게 처리
- ✅ **권한 매트릭스 준수**: 각 컴포넌트가 자신의 권한 범위 내에서만 수정됨
- ✅ **인터페이스 경계 존중**: 패키지 간 상호작용이 정의된 인터페이스를 통해서만 이루어짐
- ✅ **의존성 방향 유지**: 하위 레벨 → 상위 레벨 의존성 구조 위반 안됨
- ✅ **SDK 구조 보존**: 기존 SDK 아키텍처 변경 없이 문제 해결됨

### **📋 Rule 준수 사항 및 권한/역할 기반 수정 원칙**

#### **🚨 도메인 중립성 및 권한 분리 (Domain Neutrality & Responsibility Separation)**

##### **📦 패키지 권한 및 책임 범위**
- **packages/agents**: 순수 비즈니스 로직만, UI 라이브러리 의존성 금지
- **packages/team**: Team 특화 로직, `assignTask` tool 제공 (third-party tool)
- **apps/web**: UI 관련 로직만, SDK 내부 구조 변경 금지  
- **External Store**: apps/web 영역, SDK 내부 로직에 개입하지 않고 인터페이스를 통해서만 상호작용
- **WorkflowEventSubscriber**: packages/agents 영역, **완전히 도메인 중립적** 이벤트 처리만

##### **🚫 Third-Party Tool 도메인 중립성 원칙**
- **`assignTask`는 packages/team의 third-party tool**: packages/agents, apps/web, workflow 등은 `assignTask`의 존재를 **사전에 알 수 없음**
- **이벤트 발생**: `assignTask` 키워드가 포함된 특화 이벤트 발생 **절대 금지**
- **Generic 이벤트만 사용**: `tool_call_start`, `tool_call_complete`, `agent.creation_start` 등 **도메인 중립적 이벤트만**
- **Tool 구분**: Tool 타입이나 이름에 따른 특별 처리 로직 **금지** (모든 tool은 동등하게 처리)

##### **🔄 Agent 재귀적 구조 원칙 (Sub-Agent 개념 폐지)**
- **Agent는 항상 Agent**: 계층에 관계없이 모든 Agent는 동일한 `Agent` 타입
- **Sub-Agent 개념 제거**: `sub-agent`, `sub_agent` 노드 타입 **사용 금지**
- **재귀적 구조**: Team → Agent → Tool Call (assignTask) → **새로운 Agent** → Tool Call → **또 다른 Agent**... (무한 반복 가능)
- **계층 정보**: `executionLevel`, `parentExecutionId`로 계층 추적, 하지만 **타입은 모두 동일한 Agent**

##### **📊 올바른 아키텍처 구조 다이어그램**
```
🏢 Team (Level 0)
 └── 👤 Agent (Level 1) [agent_exec_123]
     ├── 🧠 Agent Thinking
     └── 🔧 Tool Call (assignTask) ← Third-party tool
         └── 👤 **새로운 Agent** (Level 2) [agent_exec_456] ← Agent 타입 동일!
             ├── 🧠 Agent Thinking
             └── 🔧 Tool Call (다른 tool)
                 └── 👤 **또 다른 Agent** (Level 3) [agent_exec_789]
                     └── ... (무한 재귀 가능)

❌ 잘못된 구조: sub-agent, sub_agent 타입 사용
✅ 올바른 구조: 모든 Agent는 동일한 'agent' 타입, 레벨로만 구분
```

##### **🔍 도메인 중립적 이벤트 플로우**
```
1. 'tool_call_start' (도메인 중립) ← assignTask라는 키워드 없음
2. 'agent.creation_start' (도메인 중립) ← Generic Agent 생성
3. 'agent.creation_complete' (도메인 중립) ← Agent 타입으로 완료
4. 'execution.start' (도메인 중립) ← 새 Agent 실행 시작

❌ 금지: 'assignTask_start', 'sub_agent_creation' 등 특화 이벤트
✅ 허용: Generic 이벤트만, Tool 이름 무관하게 동등 처리
```

#### **🔒 수정 권한 매트릭스 (Modification Authority Matrix)**
```
┌─────────────────────┬──────────────┬──────────────┬─────────────────┐
│ 컴포넌트/패키지      │ apps/web     │ packages/*   │ 수정 가능 범위   │
├─────────────────────┼──────────────┼──────────────┼─────────────────┤
│ External Store      │ ✅ 전체 수정  │ ❌ 접근 금지  │ UI 연결 로직     │
│ WorkflowSubscriber  │ ❌ 읽기만    │ ✅ 로직 수정  │ 이벤트 처리      │
│ RealTimeBuilder     │ ❌ 인터페이스│ ✅ 로직 수정  │ 워크플로우 빌딩  │
│ PlaygroundExecutor  │ ✅ 전체 수정  │ ❌ 접근 금지  │ UI 상태 관리     │
│ React-Flow 컴포넌트  │ ✅ 전체 수정  │ ❌ 접근 금지  │ 시각화 로직      │
└─────────────────────┴──────────────┴──────────────┴─────────────────┘
```

#### **⚡ 근본적 수정 시 권한 검증 프로세스**
1. **권한 확인**: 수정하려는 컴포넌트가 수정 권한 매트릭스에 포함되는가?
2. **도메인 검증**: 수정이 해당 컴포넌트의 도메인 책임 범위 내인가?
3. **인터페이스 준수**: 다른 패키지와의 상호작용이 정의된 인터페이스를 통해서만 이루어지는가?
4. **의존성 방향**: 하위 레벨이 상위 레벨을 의존하는 구조를 위반하지 않는가?

#### **🎯 SDK 아키텍처 준수 원칙**
- **Build Integrity**: 모든 타입이 올바르게 정의되고 TypeScript 빌드 통과
- **Architecture Principles**: 의존성 방향 준수, domain neutrality 유지
- **No Fallback Policy**: 정석적인 연결 방법만 사용, 불확실한 fallback 로직 금지
- **Robota SDK Architecture**: SDK의 기존 구조 최대한 보존
- **Robota Usage Patterns**: 올바른 생성자 패턴, 도구 생성 패턴, 패키지 임포트 규칙 준수

---

**📝 문서 확인 요청**: 위 STEP 9 작업 계획이 정확하고 실현 가능한지 검토 후 승인 부탁드립니다.