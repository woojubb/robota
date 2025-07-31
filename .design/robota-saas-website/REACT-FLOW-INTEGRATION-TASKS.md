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

### 🚨 **현재 상황: 핵심 기능 완료, 빌드 오류 해결 시급**

### 📊 **현재 빌드 상태 (2024-12-20)**
- **🚨 빌드 오류**: 26개 타입 오류 (주로 테스트 파일 및 layout-engine.ts)
- **핵심 비즈니스 로직**: 대부분 완료 및 정상 작동
- **테스트 파일**: integration-test.ts에서 다수 타입 호환성 오류
- **우선순위**: **빌드 무결성 복구가 최우선**

### 📊 **진행 상황 요약 (업데이트됨)**
- **Phase 1**: ✅ **100% 완료** (Universal 데이터 구조)
- **Phase X.1**: ⚠️ **75% 완료** (타입 시스템 리팩토링 - 빌드 오류 26개 남음)
- **Phase 2**: ⚠️ **90% 완료** (React-Flow 변환기 - 테스트 파일 오류)
- **Phase 3**: ⚠️ **95% 완료** (실시간 시스템 - 통합 오류)
- **Phase 4**: ⚠️ **빌드 무결성 복구 필요**

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

## 🚀 **다음 단계**

**즉시 수행**: Phase 4.6.0 빌드 오류 26개 해결
1. layout-engine.ts 수정 (2개 오류)
2. integration-test.ts 수정 (24개 오류)

**이후 계획**: 
- Playground UI 통합 
- 성능 최적화
- 검증 시스템 완성

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

## 📋 **Phase 4.6: packages/agents 빌드 무결성 복구 작업**

### **🚨 현재 빌드 오류 현황 (2024-12-20)**

**빌드 오류 26개 발견** - 즉시 해결 필요:

#### **4.6.0 URGENT: 빌드 오류 수정 우선** 🚨 **최우선**
- [ ] **layout-engine.ts 수정 (2개 오류)**
  - [ ] Line 72: `override` modifier 추가 필요
  - [ ] Line 124: `LayoutCalculationResult`에 `warnings` property 누락
- [ ] **integration-test.ts 수정 (24개 오류)**
  - [ ] `MetadataMappingConfig` export 누락 문제
  - [ ] `UniversalPosition`에 `level`, `order` 속성 누락 (다수)
  - [ ] `UniversalVisualState`에 `selected` 속성 존재하지 않음 (다수)
  - [ ] Universal 노드 data에 `label` 속성 누락 (다수)
  - [ ] 메타데이터 타입에 `createdAt`, `updatedAt` 누락 (다수)

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