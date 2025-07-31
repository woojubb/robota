# 🔄 React-Flow 통합 작업 계획서

## 🚨 **현재 상황 및 가장 시급한 작업들**

### ✅ **완료된 작업 (Phase 1 대부분 완료)**
- **Universal 데이터 구조 설계**: `UniversalWorkflowStructure`, `UniversalWorkflowNode`, `UniversalWorkflowEdge` 완료
- **아키텍처 기반 구조**: `BaseWorkflowConverter`, `BaseLayoutEngine`, `BaseWorkflowValidator` 완료
- **구체 구현체**: `WorkflowToUniversalConverter`, `HierarchicalLayoutEngine`, `UniversalWorkflowValidator` 완료
- **인터페이스 분리**: `WorkflowConverterInterface`, `LayoutEngineInterface`, `WorkflowValidatorInterface` 완료

### ⚠️ **가장 시급한 남은 작업들 (우선순위 순서)**

#### **🔥 1순위: 타입 오류 해결 (127개 → 10개 이하)**
- **현재 상황**: 127개 타입 오류로 빌드 실패
- **근본 원인**: 100+개 파일에서 Record<string, 중복 타입 선언
- **해결 방법**: Phase X.1의 타입 통합 리팩토링 필요

#### **🔥 2순위: Universal 타입 아키텍처 결함 해결**
- **현재 문제**: `UniversalWorkflowNode`에 `mermaid`, `reactFlow` 하드코딩
- **아키텍처 위반**: Universal 타입이 특정 플랫폼에 의존적
- **해결 방법**: Phase X.2의 Platform-agnostic 리팩토링 필요

#### **🔥 3순위: React-Flow 변환기 구현**
- **현재 상황**: Phase 2 아직 시작 안됨
- **필요 작업**: React-Flow v12.8.2 타입 정의 및 변환기 구현
- **의존성**: 1순위, 2순위 완료 후 진행 가능

### 📊 **진행 상황 요약**
- **Phase 1**: 95% 완료 (타입 오류 해결 필요)
- **Phase X (리팩토링)**: 10% 완료 (긴급 진행 필요)
- **Phase 2**: 0% 완료 (Phase X 완료 후 진행)
- **Phase 3**: 0% 완료
- **Phase 4**: 0% 완료

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

#### **1.1 타입 정의 및 인터페이스 분리 (단일 책임 원칙)**
- [x] `UniversalWorkflowNode` 인터페이스 설계 ✅ 완료
  - [x] 모든 워크플로우 노드 타입을 포괄할 수 있는 구조
  - [x] 위치 정보를 포함하되 유연한 레이아웃 지원  
  - [x] 메타데이터 및 상태 정보 포함
- [x] `UniversalWorkflowEdge` 인터페이스 설계 ✅ 완료
  - [x] 노드 간 연결 관계 표현
  - [x] 연결 타입 및 스타일 정보 포함
- [x] `UniversalWorkflowStructure` 컨테이너 인터페이스 설계 ✅ 완료
  - [x] nodes와 edges 배열
  - [x] 메타데이터 (제목, 설명, 생성일 등)
  - [x] 레이아웃 설정 정보

#### **1.2 추상화 계층 설계 (Facade 패턴 적용)** ✅ **완료**
- [x] `BaseWorkflowConverter` 추상 클래스 생성 ✅ **완료**
  - [x] `packages/agents/src/abstracts/base-workflow-converter.ts` ✅
  - [x] 모든 변환기가 상속받을 공통 인터페이스 정의 ✅
  - [x] BaseModule 패턴 적용 (enabled, logger, eventEmitter) ✅
  - [x] 타입 안전성을 위한 제네릭 타입 파라미터 `<TInput, TOutput>` ✅
- [x] `BaseLayoutEngine` 추상 클래스 생성 ✅ **완료**
  - [x] `packages/agents/src/abstracts/base-layout-engine.ts` ✅
  - [x] 레이아웃 알고리즘 추상화 (hierarchical, force, grid 등) ✅
  - [x] 위치 계산 로직 분리 ✅
- [x] `BaseWorkflowValidator` 추상 클래스 생성 ✅ **완료**
  - [x] `packages/agents/src/abstracts/base-workflow-validator.ts` ✅
  - [x] 검증 로직 추상화 ✅
  - [x] 플랫폼별 검증 규칙 확장 가능 ✅

#### **1.3 구체 구현 클래스 (단일 책임 원칙)** ✅ **완료**
- [x] `WorkflowToUniversalConverter` 클래스 구현 ✅ **완료**
  - [x] `packages/agents/src/services/workflow-to-universal-converter.ts` ✅
  - [x] `BaseWorkflowConverter<WorkflowStructure, UniversalWorkflowStructure>` 상속 ✅
  - [x] 기존 `WorkflowStructure`를 `UniversalWorkflowStructure`로 변환 ✅
  - [x] SimpleLogger 의존성 주입 패턴 적용 ✅
- [x] `HierarchicalLayoutEngine` 클래스 구현 ✅ **완료**
  - [x] `packages/agents/src/services/layout/hierarchical-layout-engine.ts` ✅
  - [x] `BaseLayoutEngine` 상속 ✅
  - [x] 계층 기반 노드 위치 자동 계산 알고리즘 ✅
- [x] `UniversalWorkflowValidator` 클래스 구현 ✅ **완료**
  - [x] `packages/agents/src/validators/universal-workflow-validator.ts` ✅
  - [x] `BaseWorkflowValidator` 상속 ✅
  - [x] Universal 구조 유효성 검증 ✅

#### **1.4 인터페이스 분리 원칙 적용** ✅ **완료**
- [x] `WorkflowConverterInterface` 인터페이스 정의 ✅ **완료**
  - [x] `packages/agents/src/interfaces/workflow-converter.ts` ✅
  - [x] 변환 기능만 담당하는 최소 인터페이스 ✅
- [x] `LayoutEngineInterface` 인터페이스 정의 ✅ **완료**
  - [x] `packages/agents/src/interfaces/layout-engine.ts` ✅
  - [x] 레이아웃 계산만 담당하는 최소 인터페이스 ✅
- [x] `WorkflowValidatorInterface` 인터페이스 정의 ✅ **완료**
  - [x] `packages/agents/src/interfaces/workflow-validator.ts` ✅
  - [x] 검증 기능만 담당하는 최소 인터페이스 ✅

#### **1.5 테스트 코드 및 통합** ⚠️ **필요**
- [ ] 추상 클래스 테스트 작성 ⚠️ **필요**
  - [ ] 각 Base 클래스의 공통 동작 검증 
- [ ] 구체 구현 테스트 작성 ⚠️ **필요**
  - [ ] 기존 24-workflow-structure-test.ts와 연동 테스트
  - [ ] Mock 객체 활용한 단위 테스트

### **Phase 2: React-Flow 변환기 구현 (아키텍처 원칙 준수)** ⚠️ **시작 필요**

#### **2.1 React-Flow v12 타입 정의 및 인터페이스 분리** ⚠️ **시작 필요**
- [ ] `ReactFlowTypes` 인터페이스 파일 생성 ⚠️ **시작 필요**
  - [ ] `packages/agents/src/types/react-flow-types.ts`
  - [ ] React-Flow v12.8.2 호환 Node, Edge 인터페이스 정의
  - [ ] Robota 워크플로우 특화 확장 타입 정의
  - [ ] v12 신규 기능 (SSR, Dark Mode, Reactive Flows) 지원 타입
- [ ] `ReactFlowConverterInterface` 인터페이스 정의 ⚠️ **시작 필요**
  - [ ] `packages/agents/src/interfaces/react-flow-converter.ts`
  - [ ] React-Flow 특화 변환 메서드 정의
  - [ ] 노드/엣지 타입 매핑 인터페이스

#### **2.2 추상화 계층 확장 (기존 Base 클래스 활용)**
- [ ] `BaseReactFlowConverter` 추상 클래스 생성
  - [ ] `packages/agents/src/abstracts/base-react-flow-converter.ts`
  - [ ] `BaseWorkflowConverter<UniversalWorkflowStructure, ReactFlowData>` 상속
  - [ ] React-Flow 특화 공통 로직 (노드 타입 매핑, 스타일링)
  - [ ] v12 호환성 검증 로직
- [ ] `BaseReactFlowLayoutEngine` 추상 클래스 생성
  - [ ] `packages/agents/src/abstracts/base-react-flow-layout-engine.ts`
  - [ ] `BaseLayoutEngine` 상속
  - [ ] React-Flow 특화 레이아웃 로직 (Dagre, Force-directed)
  - [ ] SSR/SSG 지원을 위한 사전 크기 계산

#### **2.3 구체 구현 클래스 (단일 책임 원칙)**
- [ ] `UniversalToReactFlowConverter` 클래스 구현
  - [ ] `packages/agents/src/services/universal-to-react-flow-converter.ts`
  - [ ] `BaseReactFlowConverter` 상속
  - [ ] UniversalWorkflowStructure → React-Flow v12 데이터 변환
  - [ ] SimpleLogger 의존성 주입 패턴 적용
- [ ] `ReactFlowNodeFactory` 클래스 구현 (팩토리 패턴)
  - [ ] `packages/agents/src/services/react-flow/react-flow-node-factory.ts`
  - [ ] 노드 타입별 맞춤 변환 로직 분리
  - [ ] v12 신규 필드 (`measured`, `selectable`, `deletable`) 처리
- [ ] `ReactFlowEdgeFactory` 클래스 구현 (팩토리 패턴)
  - [ ] `packages/agents/src/services/react-flow/react-flow-edge-factory.ts`
  - [ ] 엣지 스타일링 및 애니메이션 설정 분리
  - [ ] 조건부 스타일링 (성공/실패 상태별) 로직
- [ ] `DagreLayoutEngine` 클래스 구현
  - [ ] `packages/agents/src/services/layout/dagre-layout-engine.ts`
  - [ ] `BaseReactFlowLayoutEngine` 상속
  - [ ] Dagre 알고리즘 기반 자동 레이아웃
  - [ ] 충돌 방지 및 가독성 최적화

#### **2.4 React-Flow v12 특화 팩토리 클래스들 (팩토리 패턴)**
- [ ] `ReactFlowNodeTypeFactory` 클래스 구현
  - [ ] `packages/agents/src/services/react-flow/node-types/react-flow-node-type-factory.ts`
  - [ ] 노드 타입별 생성 로직 분리
- [ ] 개별 노드 타입 팩토리들:
  - [ ] `AgentNodeFactory` - Agent 노드 (🤖 아이콘 + 라벨)
  - [ ] `ToolCallNodeFactory` - Tool Call 노드 (⚡ 아이콘 + 도구명)
  - [ ] `UserInputNodeFactory` - User Input 노드 (👤 아이콘 + 입력 내용)
  - [ ] `ResponseNodeFactory` - Response 노드 (💬 아이콘 + 응답 내용)
  - [ ] `GroupNodeFactory` - Group 노드 (Team 실행 그룹화)
- [ ] `ReactFlowEdgeTypeFactory` 클래스 구현
  - [ ] `packages/agents/src/services/react-flow/edge-types/react-flow-edge-type-factory.ts`
  - [ ] 엣지 타입별 생성 로직 분리
- [ ] 개별 엣지 타입 팩토리들:
  - [ ] `ExecutionEdgeFactory` - 실행 연결 (→)
  - [ ] `CreationEdgeFactory` - 생성 연결 (⇒)
  - [ ] `ReturnEdgeFactory` - 반환 연결 (↩)
  - [ ] `AnimatedEdgeFactory` - 애니메이션 효과 (`animated: true`)

#### **2.5 테마 및 스타일링 시스템 (전략 패턴)**
- [ ] `ReactFlowThemeStrategy` 인터페이스 정의
  - [ ] `packages/agents/src/interfaces/react-flow-theme-strategy.ts`
  - [ ] 테마 적용 전략 인터페이스
- [ ] `LightThemeStrategy` 클래스 구현
  - [ ] `packages/agents/src/services/react-flow/themes/light-theme-strategy.ts`
  - [ ] 라이트 모드 스타일링 전략
- [ ] `DarkThemeStrategy` 클래스 구현
  - [ ] `packages/agents/src/services/react-flow/themes/dark-theme-strategy.ts`
  - [ ] `colorMode` prop 활용 다크 모드 지원
  - [ ] CSS Variables 기반 테마 설정

### **Phase 3: 실시간 워크플로우 빌더 확장**

#### **3.1 RealTimeWorkflowBuilder 확장**
- [ ] 기존 클래스에 React-Flow 지원 추가
  - [ ] `generateReactFlowData()` 메서드 추가
  - [ ] 실시간 업데이트 시 React-Flow 데이터도 함께 생성
  - [ ] 이벤트 기반 실시간 노드/엣지 추가 및 업데이트
- [ ] 성능 최적화
  - [ ] 변환 과정 캐싱
  - [ ] 증분 업데이트 (변경된 부분만 재계산)

#### **3.2 새로운 React-Flow 제너레이터 구현**
- [ ] `RealTimeReactFlowGenerator` 클래스 생성
  - [ ] `packages/agents/src/services/real-time-react-flow-generator.ts`
  - [ ] Mermaid 제너레이터와 병렬로 동작
  - [ ] 실시간 스타일링 및 애니메이션 적용
- [ ] 로깅 및 디버깅 기능
  - [ ] 변환 과정 추적
  - [ ] 성능 메트릭 수집

### **Phase 4: 데이터 검증 및 품질 보증 (아키텍처 원칙 준수)**

#### **4.1 검증 시스템 추상화 계층 설계**
- [ ] `BaseWorkflowValidator` 추상 클래스 확장
  - [ ] `packages/agents/src/abstracts/base-workflow-validator.ts` (이미 계획됨)
  - [ ] 모든 검증기가 상속받을 공통 인터페이스
  - [ ] BaseModule 패턴 적용 (enabled, logger, eventEmitter)
  - [ ] 제네릭 타입 파라미터 `<TWorkflowData>`
- [ ] `ValidationRuleInterface` 인터페이스 정의
  - [ ] `packages/agents/src/interfaces/validation-rule.ts`
  - [ ] 개별 검증 규칙의 최소 인터페이스
  - [ ] 체인 패턴 지원 (여러 규칙 조합)
- [ ] `ValidationResultInterface` 인터페이스 정의
  - [ ] `packages/agents/src/interfaces/validation-result.ts`
  - [ ] 검증 결과 표준화

#### **4.2 React-Flow 특화 검증 시스템 구현 (전략 패턴)**
- [ ] `ReactFlowDataValidator` 클래스 구현
  - [ ] `packages/agents/src/validators/react-flow-data-validator.ts`
  - [ ] `BaseWorkflowValidator<ReactFlowData>` 상속
  - [ ] v12.8.2 호환성 검증 조정자 역할 (Facade 패턴)
  - [ ] SimpleLogger 의존성 주입 패턴 적용
- [ ] 개별 검증 규칙 클래스들 (단일 책임 원칙):
  - [ ] `NodeStructureValidationRule` - 노드 구조 검증
  - [ ] `EdgeStructureValidationRule` - 엣지 구조 검증
  - [ ] `IdDuplicationValidationRule` - ID 중복 검증
  - [ ] `CircularReferenceValidationRule` - 순환 참조 검증
  - [ ] `ReferenceIntegrityValidationRule` - 참조 무결성 검증
  - [ ] `V12CompatibilityValidationRule` - v12 호환성 검증

#### **4.3 실시간 검증 시스템 (관찰자 패턴)**
- [ ] `RealTimeValidationOrchestrator` 클래스 구현
  - [ ] `packages/agents/src/services/validation/real-time-validation-orchestrator.ts`
  - [ ] 변환 과정 중 실시간 검증 조정
  - [ ] 여러 검증기 관리 및 결과 집계
- [ ] `ValidationEventEmitter` 클래스 구현
  - [ ] `packages/agents/src/services/validation/validation-event-emitter.ts`
  - [ ] 검증 이벤트 발생 및 구독 관리
  - [ ] 오류 발생 시 상세 에러 메시지 제공
- [ ] `AutoRecoveryStrategy` 인터페이스 및 구현
  - [ ] `packages/agents/src/interfaces/auto-recovery-strategy.ts`
  - [ ] `packages/agents/src/services/validation/auto-recovery-strategy.ts`
  - [ ] 검증 실패 시 자동 복구 시도 전략
- [ ] `ValidationLogger` 클래스 구현
  - [ ] `packages/agents/src/services/validation/validation-logger.ts`
  - [ ] 검증 결과 로깅 및 디버깅 정보 전문 관리

#### **4.2 검증 테스트 슈트 구현**
- [ ] 포괄적 검증 테스트 케이스 작성
  - [ ] 올바른 데이터 구조 검증 테스트
  - [ ] 잘못된 데이터 구조 거부 테스트
  - [ ] 경계값 테스트 (빈 배열, null, undefined)
  - [ ] 대용량 워크플로우 검증 테스트 (500+ 노드)
- [ ] `24-workflow-structure-test.ts` 확장
  - [ ] React-Flow 데이터 생성 테스트 추가
  - [ ] Mermaid와 React-Flow 동시 생성 검증
  - [ ] 데이터 일관성 검증 (동일 워크플로우에서 양쪽 결과 비교)
- [ ] Export 기능 추가
  - [ ] React-Flow 데이터를 JSON으로 출력
  - [ ] 검증된 데이터만 출력 보장
  - [ ] 파일 저장 기능

#### **4.3 예제 애플리케이션 생성**
- [ ] React-Flow 시각화 예제 개발
  - [ ] `apps/examples/25-react-flow-visualization.ts`
  - [ ] 실제 React-Flow 컴포넌트와 연동
  - [ ] 실시간 업데이트 데모
  - [ ] 검증 과정 시각화 (성공/실패 표시)
- [ ] 성능 비교 테스트
  - [ ] Mermaid vs React-Flow 렌더링 성능
  - [ ] 대규모 워크플로우 처리 성능
  - [ ] 검증 과정 성능 오버헤드 측정

### **Phase 5: Playground 실시간 통합 및 배포**

#### **5.1 React-Flow 라이브러리 설치 및 설정**
- [ ] `@xyflow/react` v12.8.2 설치
  - [ ] `apps/web/package.json`에 의존성 추가
  - [ ] `npm install @xyflow/react@12.8.2`
  - [ ] TypeScript 타입 지원 확인
- [ ] CSS 스타일시트 통합
  - [ ] `@xyflow/react/dist/style.css` 임포트
  - [ ] 기존 Tailwind CSS와 호환성 확인
  - [ ] Dark Mode CSS 변수 설정

#### **5.2 Playground React-Flow 컴포넌트 개발**
- [ ] `WorkflowReactFlowVisualizer` 컴포넌트 생성
  - [ ] `apps/web/src/components/playground/workflow-react-flow-visualizer.tsx`
  - [ ] 실시간 워크플로우 데이터 수신 및 변환
  - [ ] React-Flow 렌더링 및 상호작용 처리
  - [ ] 노드/엣지 클릭 이벤트 처리
- [ ] 커스텀 노드/엣지 컴포넌트 구현
  - [ ] `apps/web/src/components/playground/react-flow-nodes/`
  - [ ] Agent, ToolCall, UserInput, Response 노드
  - [ ] 실행 상태별 스타일링 (pending, running, completed, error)
  - [ ] 실시간 애니메이션 효과

#### **5.3 Playground UI 통합**
- [ ] 기존 Playground 페이지 확장
  - [ ] `apps/web/src/app/playground/page.tsx` 수정
  - [ ] React-Flow 시각화 패널 추가 (기존 Execution Tree와 병렬)
  - [ ] 탭 전환 UI (Execution Tree ↔ React-Flow 뷰)
- [ ] 실시간 데이터 연동
  - [ ] `usePlayground` 훅에서 React-Flow 데이터 제공
  - [ ] WorkflowEventSubscriber → React-Flow 데이터 실시간 변환
  - [ ] 기존 BlockCollector와 연동

#### **5.4 성능 최적화 및 안정성**
- [ ] 렌더링 성능 최적화
  - [ ] 대량 노드 처리 시 가상화 적용
  - [ ] React.memo, useMemo를 활용한 불필요한 리렌더링 방지
  - [ ] 실시간 업데이트 디바운싱
- [ ] 에러 처리 및 폴백
  - [ ] React-Flow 렌더링 실패 시 Execution Tree로 폴백
  - [ ] 데이터 검증 실패 시 사용자 친화적 에러 메시지
  - [ ] 브라우저 호환성 체크

#### **5.5 문서화 및 API 정리**
- [ ] API 문서화
  - [ ] 새로운 인터페이스 및 클래스 문서화
  - [ ] React-Flow 통합 사용법 가이드 작성
  - [ ] TypeScript 타입 정의 완성
- [ ] 사용자 가이드 작성
  - [ ] Playground에서 React-Flow 사용법
  - [ ] 실시간 시각화 기능 설명
  - [ ] 문제 해결 가이드

#### **5.6 Export 및 배포**
- [ ] SDK 기능 Export
  - [ ] `packages/agents/src/index.ts`에 새로운 기능 export 추가
  - [ ] React-Flow 변환기 및 검증기 공개 API
- [ ] Playground 기능 배포
  - [ ] 개발 환경 테스트
  - [ ] 프로덕션 빌드 검증
  - [ ] 버전 관리 및 변경 로그 작성

## 📁 예상 파일 구조 (아키텍처 원칙 준수)

```
packages/agents/src/
├── types/
│   ├── react-flow-types.ts          # React-Flow v12 타입 정의
│   └── universal-workflow-types.ts   # 범용 워크플로우 타입
├── interfaces/                       # 인터페이스 분리 원칙
│   ├── workflow-converter.ts         # 변환기 인터페이스
│   ├── layout-engine.ts              # 레이아웃 엔진 인터페이스
│   ├── workflow-validator.ts         # 검증기 인터페이스
│   ├── react-flow-converter.ts       # React-Flow 변환기 인터페이스
│   ├── react-flow-theme-strategy.ts  # 테마 전략 인터페이스
│   ├── validation-rule.ts            # 검증 규칙 인터페이스
│   ├── validation-result.ts          # 검증 결과 인터페이스
│   └── auto-recovery-strategy.ts     # 자동 복구 전략 인터페이스
├── abstracts/                        # 추상 클래스 계층
│   ├── base-workflow-converter.ts    # 변환기 베이스 클래스
│   ├── base-layout-engine.ts         # 레이아웃 엔진 베이스 클래스
│   ├── base-workflow-validator.ts    # 검증기 베이스 클래스
│   ├── base-react-flow-converter.ts  # React-Flow 변환기 베이스
│   └── base-react-flow-layout-engine.ts # React-Flow 레이아웃 베이스
├── services/                         # 구체 구현 클래스들
│   ├── workflow-to-universal-converter.ts    # 기존 → 범용 변환
│   ├── universal-to-react-flow-converter.ts  # 범용 → React-Flow 변환
│   ├── real-time-react-flow-generator.ts     # 실시간 React-Flow 생성기
│   ├── layout/                       # 레이아웃 알고리즘들
│   │   ├── hierarchical-layout-engine.ts     # 계층 레이아웃
│   │   └── dagre-layout-engine.ts            # Dagre 레이아웃
│   ├── react-flow/                   # React-Flow 특화 서비스들
│   │   ├── react-flow-node-factory.ts        # 노드 팩토리
│   │   ├── react-flow-edge-factory.ts        # 엣지 팩토리
│   │   ├── node-types/               # 노드 타입 팩토리들
│   │   │   ├── react-flow-node-type-factory.ts
│   │   │   ├── agent-node-factory.ts
│   │   │   ├── tool-call-node-factory.ts
│   │   │   ├── user-input-node-factory.ts
│   │   │   ├── response-node-factory.ts
│   │   │   └── group-node-factory.ts
│   │   ├── edge-types/               # 엣지 타입 팩토리들
│   │   │   ├── react-flow-edge-type-factory.ts
│   │   │   ├── execution-edge-factory.ts
│   │   │   ├── creation-edge-factory.ts
│   │   │   ├── return-edge-factory.ts
│   │   │   └── animated-edge-factory.ts
│   │   └── themes/                   # 테마 전략들
│   │       ├── light-theme-strategy.ts
│   │       └── dark-theme-strategy.ts
│   ├── validation/                   # 검증 시스템
│   │   ├── real-time-validation-orchestrator.ts
│   │   ├── validation-event-emitter.ts
│   │   ├── auto-recovery-strategy.ts
│   │   └── validation-logger.ts
│   └── (기존 파일들...)
├── validators/                       # 검증기들
│   ├── universal-workflow-validator.ts       # Universal 구조 검증
│   ├── react-flow-data-validator.ts          # React-Flow 데이터 검증
│   └── rules/                        # 개별 검증 규칙들
│       ├── node-structure-validation-rule.ts
│       ├── edge-structure-validation-rule.ts
│       ├── id-duplication-validation-rule.ts
│       ├── circular-reference-validation-rule.ts
│       ├── reference-integrity-validation-rule.ts
│       └── v12-compatibility-validation-rule.ts
└── index.ts                         # 새로운 exports 추가

apps/web/src/components/playground/
├── workflow-react-flow-visualizer.tsx  # 메인 React-Flow 컴포넌트
├── react-flow-nodes/                   # 커스텀 노드 컴포넌트들
│   ├── agent-node.tsx
│   ├── tool-call-node.tsx
│   ├── user-input-node.tsx
│   ├── response-node.tsx
│   └── group-node.tsx
└── (기존 파일들...)

apps/examples/
├── 25-react-flow-visualization.ts   # React-Flow 예제
└── (기존 파일들...)
```

## 🎯 성공 기준

### **기능적 요구사항**
- [ ] 기존 Mermaid 기능 100% 유지
- [ ] React-Flow v12.8.2 호환 데이터 정확한 생성
- [ ] 실시간 업데이트 동작 (Playground 통합)
- [ ] 모든 워크플로우 노드 타입 지원
- [ ] **데이터 검증 100% 성공**: 모든 생성된 React-Flow 데이터가 유효성 검증 통과

### **Playground 통합 요구사항**
- [ ] **실시간 시각화**: 워크플로우 실행 중 React-Flow 그래프가 실시간 업데이트
- [ ] **상호작용**: 노드/엣지 클릭, 줌, 팬 등 모든 React-Flow 기본 기능 동작
- [ ] **탭 전환**: Execution Tree ↔ React-Flow 뷰 간 매끄러운 전환
- [ ] **반응형 디자인**: 다양한 화면 크기에서 올바른 렌더링
- [ ] **Dark Mode 지원**: 기존 Playground 테마와 일관성 유지

### **데이터 검증 요구사항**
- [ ] **구조 검증**: 모든 노드/엣지가 React-Flow v12 스키마 준수
- [ ] **참조 무결성**: 모든 엣지가 존재하는 노드만 참조
- [ ] **순환 참조 방지**: 무한 루프를 일으킬 수 있는 연결 사전 차단
- [ ] **중복 방지**: 동일한 ID를 가진 노드/엣지 존재하지 않음
- [ ] **실시간 검증**: 데이터 생성/업데이트 시점에 즉시 검증 수행

### **성능 요구사항**
- [ ] 변환 시간 < 100ms (100개 노드 기준)
- [ ] 검증 시간 < 50ms (100개 노드 기준)
- [ ] 메모리 사용량 증가 < 20%
- [ ] 빌드 시간 영향 최소화
- [ ] Playground 렌더링 시간 < 500ms (200개 노드 기준)

### **품질 요구사항**
- [ ] TypeScript 타입 안전성 100%
- [ ] 테스트 커버리지 > 90% (검증 기능 포함)
- [ ] ESLint 규칙 준수
- [ ] Robota SDK 아키텍처 원칙 준수
- [ ] **에러 복구**: 검증 실패 시 사용자 친화적 오류 메시지 및 자동 복구 시도

## ⚠️ 주의사항

### **호환성 유지**
- 기존 API 변경 금지
- 기존 테스트 전체 통과 필수
- 기존 문서와의 일관성 유지

### **성능 고려사항**
- 대규모 워크플로우 지원 (200+ 노드)
- 실시간 업데이트 성능 최적화
- 메모리 누수 방지

### **확장성 고려사항**
- 추후 다른 시각화 라이브러리 지원 가능한 구조
- 커스텀 노드/엣지 타입 쉽게 추가 가능
- 레이아웃 알고리즘 교체 가능

## 🚀 다음 단계

이 계획서 승인 후:
1. **Phase 1** 작업 시작 (중간 데이터 구조 설계)
2. **Phase 2** React-Flow v12.8.2 변환기 구현
3. **Phase 3** 실시간 빌더 확장  
4. **Phase 4** 포괄적 데이터 검증 시스템 구축
5. **Phase 5** Playground 실시간 통합 완료
6. 지속적인 피드백 반영 및 최적화

### **🎯 최종 목표 달성 시**
모든 체크리스트 항목을 완료하면:
- **Robota SDK의 워크플로우 시각화 시스템이 React-Flow v12를 완전히 지원**
- **apps/web Playground에서 실시간 React-Flow 시각화 가능** 
- **100% 데이터 검증을 통한 안정성 보장**
- **기존 Mermaid 시스템과 완벽한 호환성 유지**

## 🚨 **중대한 아키텍처 개선 작업 (롤백 방지를 위한 필수 리팩토링)**

### **Phase X.1: 타입 선언 남발 문제 해결** ⚠️ **최우선**
- [ ] **근본 문제**: 49개 파일에서 `Record<string,` 타입 중복 선언으로 호환성 파괴
- [ ] **진단 결과**: 
  - [ ] 72개 인터페이스가 interfaces 폴더에만 존재 (과도한 타입 선언)
  - [ ] 동일한 개념의 타입이 여러 곳에서 다르게 정의됨
  - [ ] 타입 재사용 없이 무분별한 중복 선언

#### **X.1.1: 기능별 타입 정리 및 중복 제거 (기능 기반 접근)**
- [x] **현재 구조 유지** ✅ **올바른 접근**
  - [x] 각 기능 폴더가 자체 타입 관리 (workflow/, execution/, services/)
  - [x] `interfaces/` 폴더는 진짜 공유 계약만 (workflow-converter.ts 등)
  - [x] 과도한 중앙집권화 방지 (❌ src/types/common/ 강제 생성 안함)
- [x] **베이스 타입 기반 구조 설정** ✅ **부분 완료**
  - [x] `WorkflowConfig`, `WorkflowMetadata` 정의 (workflow-converter.ts에 구현됨)
  - [x] `WorkflowData` 제약 인터페이스 정의
  - [ ] **중복 제거에만 집중** ⚠️ **진행 필요**
    - [ ] 동일 개념의 Record 타입들 찾아서 통합
    - [ ] `primitive`, `ConfigValue` 같은 최소한의 공통 타입만 interfaces/에 추가
    - [ ] 각 기능 폴더의 타입은 그대로 유지하되 중복만 제거

#### **X.1.2: 의존성 주입 지원 설계 패턴 구현**
- [x] **Strategy 패턴 기반 구조** ✅ **완료**
  - [x] `WorkflowConverterInterface<TInput, TOutput>` 인터페이스 정의됨
  - [x] `BaseWorkflowConverter` 추상 클래스로 공통 기능 구현
  - [x] `WorkflowToUniversalConverter` 구체적 구현체 완료
- [ ] **Builder 패턴 타입 제약** ⚠️ **필요**
  - [ ] `Builder<T, TConfig = BaseConfig>`, `ValidatedBuilder<T, TConfig>` 정의
  - [ ] WorkflowBuilder 등을 타입 안전한 Builder로 변경
- [x] **Plugin 아키텍처 타입 안전성** ✅ **기본 완료**
  - [x] BaseModule 패턴으로 enabled, logger, config 의존성 주입 지원
  - [x] 모든 Base 클래스들이 공통 타입 기반 사용 중
  - [ ] 최종 정리 및 통합 필요

#### **X.1.3: 워크플로우 타입 계층 재설계**
- [x] **WorkflowData 타입 재구성 (SSOT 원칙)** ✅ **기본 완료**
  - [x] `WorkflowData` 인터페이스 단순화 완료
    - [x] `readonly __workflowType?: string` 브랜딩 구현됨
    - [x] `[key: string]: unknown` index signature 적용
  - [x] 타입 브랜딩 적용 완료
    - [x] `UniversalWorkflowStructure`에 `'UniversalWorkflowStructure'` 브랜딩
    - [x] `WorkflowStructure`에 `'RobotaWorkflowStructure'` 브랜딩
  - [ ] 컴포지션 기반 확장 구조 적용 ⚠️ **필요**
    - [ ] `BaseWorkflowEntity extends Identifiable, Timestamped`
    - [ ] `WorkflowNode extends BaseWorkflowEntity, Configurable<NodeConfig>`

#### **X.1.4: 중복 Record 타입 통합 (기능 자율성 유지)** ⚠️ **현재 상황: 100+개 Record 타입 발견**
- [ ] **1차: 동일 개념 중복 제거** ⚠️ **진행 중**
  - [x] `WorkflowConfig` 기본 타입 정의 완료
  - [ ] 각 기능 폴더에서 동일 개념 Config 타입들 찾아서 extends 방식으로 변경 ⚠️ **필요**
  - [ ] `WorkflowConverterOptions`, `LayoutCalculationOptions` 등은 각자 폴더에서 관리하되 공통 부분만 extends ⚠️ **필요**
  - [x] `BaseModuleOptions` 확장 패턴 부분 적용됨
- [ ] **2차: 메타데이터 중복 제거** ⚠️ **진행 중**
  - [x] `WorkflowMetadata` 기본 타입 정의 완료
  - [ ] 각 기능별 메타데이터는 각자 폴더에서 관리, 공통 부분만 extends ⚠️ **필요**
  - [ ] `ConversionResult.metadata`, `ValidationResult.metadata`는 각자 위치에서 공통 베이스 extends ⚠️ **필요**
  - [ ] `ExecutionMetadata`, `ResponseMetadata`는 execution/ 폴더에서 자체 관리 ⚠️ **필요**
- [ ] **3차: 공통 유틸리티 타입만 최소 공유** ⚠️ **필요**
  - [ ] `primitive`, `ConfigValue` 같은 정말 공통 타입만 interfaces/에 추가
  - [ ] 기능별 Options, Results는 각자 폴더에서 관리

#### **X.1.5: Abstract 클래스 타입 안전성 개선** ✅ **대부분 완료**
- [x] **BaseWorkflowConverter 리팩토링** ✅ **완료**
  - [x] 제네릭 제약을 `extends WorkflowData` 기반으로 강화 완료
  - [x] `getDataStats` 메서드 구현 완료 (Record<string, unknown> 타입 사용)
  - [x] `createConversionResult` 메서드 타입 일관성 확보 완료
- [x] **BaseLayoutEngine 리팩토링** ✅ **완료**
  - [x] 설정 타입을 `WorkflowConfig` 기반으로 통합 완료
  - [x] LayoutCalculationResult 타입 구현 완료
- [x] **BaseWorkflowValidator 리팩토링** ✅ **완료**
  - [x] `ValidationResult` 타입 구현 완료
  - [x] `ValidationOptions` 타입 `WorkflowConfig` 기반으로 변경 완료
  - [x] 제네릭 제약을 `extends WorkflowData` 기반으로 강화 완료

#### **X.1.6: 점진적 타입 강화 적용**
- [ ] **Universal 타입 플랫폼 독립성 확보** ⚠️ **중요한 아키텍처 결함 발견**
  - [ ] `UniversalWorkflowNode`에서 `mermaid`, `reactFlow` 하드코딩 제거 ⚠️ **긴급 필요**
  - [ ] `extensions?: GenericConfig` 형태로 동적 확장 지원 ⚠️ **긴급 필요**
  - [ ] Platform-agnostic 설계 원칙 적용 ⚠️ **긴급 필요**
- [x] **타입 호환성 검증** ✅ **부분 완료**
  - [x] `WorkflowData` 기반 제네릭 제약으로 타입 호환성 확보
  - [x] 기존 구현체들이 새로운 타입과 호환됨 확인
  - [ ] 컴파일 오류 해결 진행 중 (127개 → 줄여야 함)
- [x] **Backward Compatibility 보장** ✅ **완료**
  - [x] 기존 인터페이스 유지하면서 확장 구조 적용
  - [x] Type alias 및 extends 활용한 점진적 전환 구조 구현

#### **X.1.7: 타입 오류 체계적 해결** ⚠️ **현재 진행중**
- [ ] **Build 오류 우선 해결** ⚠️ **진행중**
  - [x] `Date` 타입 호환성 문제 부분 해결 (WorkflowMetadata에서 Date 허용)
  - [x] Index signature 충돌 문제 부분 해결 (`[key: string]: unknown` 적용)
  - [x] Generic 제약 조건 충돌 해결 (`extends WorkflowData` 기반 통합 완료)
  - [ ] 남은 127개 타입 오류 체계적 해결 ⚠️ **진행중**
- [x] **Lint 오류 단계적 해결** ✅ **대부분 완료**
  - [x] `any` 타입 -> `unknown` + ESLint 주석으로 변경 완료
  - [x] `unknown` 사용 시 3단계 검증 과정 규칙 적용
  - [ ] 중복 타입 선언 제거 및 기존 타입 재사용 ⚠️ **100+개 Record 타입 정리 필요**

- [ ] **성공 기준**: 타입 오류 127개 → 10개 이하로 감소 ⚠️ **진행중 (현재 127개)**
- [ ] **우선순위**: **즉시 착수 필요** (롤백 방지)

### **Phase X.2: Universal 타입 의존성 해결** 
- [ ] **문제**: UniversalWorkflowNode가 특정 플랫폼(mermaid, reactFlow)에 의존적
- [ ] **해결**: Platform-agnostic extensions 구조로 리팩토링
- [ ] **설계**: `extensions?: GenericConfig` 형태로 변경 (X.1 완료 후)

#### **X.2.1: Platform 하드코딩 제거**
- [ ] **UniversalWorkflowNode 리팩토링**
  - [ ] `mermaid?: Record<string, unknown>` 제거
  - [ ] `reactFlow?: Record<string, unknown>` 제거
  - [ ] `extensions?: GenericConfig` 동적 확장 구조로 변경
- [ ] **UniversalWorkflowStructure 리팩토링**
  - [ ] `platforms.mermaid`, `platforms.reactFlow` 하드코딩 제거
  - [ ] `platformConfigs?: Record<string, GenericConfig>` 동적 구조로 변경

#### **X.2.2: 어댑터 패턴 도입**
- [ ] **PlatformAdapter 인터페이스 정의**
  - [ ] `PlatformAdapter<TConfig = GenericConfig, TOutput = GenericConfig>` 인터페이스
  - [ ] `adaptToUniversal()`, `adaptFromUniversal()` 메서드 정의
- [ ] **구체적 어댑터 구현**
  - [ ] `MermaidAdapter implements PlatformAdapter<MermaidConfig, MermaidOutput>`
  - [ ] `ReactFlowAdapter implements PlatformAdapter<ReactFlowConfig, ReactFlowOutput>`
- [ ] **어댑터 레지스트리 구축**
  - [ ] `PlatformAdapterRegistry` 클래스로 동적 어댑터 관리
  - [ ] 런타임에 플랫폼 어댑터 등록 및 해제 지원

#### **X.2.3: 타입 안전한 동적 확장**
- [ ] **Extension 타입 시스템**
  - [ ] `PlatformExtension<T = GenericConfig>` 베이스 타입 정의
  - [ ] `VisualizationExtension`, `ConfigurationExtension` 등 도메인별 확장
- [ ] **Extension 검증 시스템**
  - [ ] Extension 타입 검증 및 런타임 체크
  - [ ] 잘못된 Extension 설정 시 명확한 오류 메시지
- [ ] **Extension 호환성 보장**
  - [ ] 기존 플랫폼들이 Extension 시스템으로 자연스럽게 이관
  - [ ] Backward compatibility를 위한 마이그레이션 가이드

#### **X.2.4: Universal 원칙 재확립**
- [ ] **진정한 Platform-agnostic 달성**
  - [ ] Universal 타입이 어떤 플랫폼 이름도 직접 참조하지 않음
  - [ ] 모든 플랫폼별 정보가 Extension 시스템을 통해 처리
- [ ] **확장성 검증**
  - [ ] 새로운 플랫폼 추가 시 Universal 타입 변경 불필요 확인
  - [ ] Extension 시스템만으로 새 플랫폼 지원 가능 검증
- [ ] **타입 일관성 보장**
  - [ ] 모든 Extension이 GenericConfig 기반으로 일관성 유지
  - [ ] Platform-specific 타입들이 Universal 타입과 호환성 유지

- [ ] **우선순위**: Phase X.1 완료 후 즉시 착수

### **🔍 검증 완료 기준**

#### **타입 안전성 및 아키텍처 기준** ⚠️ **NEW**
- [ ] **타입 오류 해결**: 현재 127개 → 10개 이하로 감소
- [ ] **타입 재사용 달성**: 49개 Record 파일 → 5-10개 기본 타입으로 통합
- [ ] **빌드 성공**: `pnpm run build` 오류 없이 완료
- [ ] **Lint 성공**: `pnpm run lint` 심각한 오류 없이 완료
- [ ] **타입 규칙 준수**: 새로운 Cursor Rules 100% 준수
  - [ ] Type Reuse Architecture 원칙 적용
  - [ ] Unknown 타입 3단계 검증 과정 준수
  - [ ] 타입 선언 남발 방지 확인

#### **기능 및 성능 기준**
- [ ] 모든 생성된 React-Flow 데이터가 검증기를 통과
- [ ] Playground에서 실시간 워크플로우 시각화 정상 동작
- [ ] 성능 기준 만족 (변환 < 100ms, 검증 < 50ms, 렌더링 < 500ms)
- [ ] 모든 테스트 케이스 통과 (커버리지 > 90%)

#### **아키텍처 호환성 기준**
- [ ] **Platform-agnostic 원칙**: Universal 타입이 특정 플랫폼에 의존하지 않음
- [ ] **확장성 보장**: 새로운 플랫폼 추가 시 기존 타입 변경 불필요
- [ ] **Backward Compatibility**: 기존 코드가 새로운 타입 시스템과 호환
- [ ] **Type Safety**: 런타임 타입 오류 없이 안전한 타입 변환