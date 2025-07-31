# 🔄 React-Flow 통합 작업 계획서

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

### **Phase 1: 중간 데이터 구조 설계 및 구현**

#### **1.1 범용 워크플로우 데이터 구조 정의**
- [ ] `UniversalWorkflowNode` 인터페이스 설계
  - [ ] 모든 워크플로우 노드 타입을 포괄할 수 있는 구조
  - [ ] 위치 정보를 포함하되 유연한 레이아웃 지원
  - [ ] 메타데이터 및 상태 정보 포함
- [ ] `UniversalWorkflowEdge` 인터페이스 설계
  - [ ] 노드 간 연결 관계 표현
  - [ ] 연결 타입 및 스타일 정보 포함
- [ ] `UniversalWorkflowStructure` 컨테이너 인터페이스 설계
  - [ ] nodes와 edges 배열
  - [ ] 메타데이터 (제목, 설명, 생성일 등)
  - [ ] 레이아웃 설정 정보

#### **1.2 기존 WorkflowStructure → Universal 변환기 구현**
- [ ] `WorkflowToUniversalConverter` 클래스 생성
  - [ ] `packages/agents/src/services/workflow-to-universal-converter.ts`
  - [ ] 기존 `WorkflowStructure`를 `UniversalWorkflowStructure`로 변환
  - [ ] 노드 위치 자동 계산 알고리즘 구현 (계층 기반 레이아웃)
- [ ] 변환기 테스트 코드 작성
  - [ ] 기존 24-workflow-structure-test.ts와 연동 테스트

### **Phase 2: React-Flow 변환기 구현**

#### **2.1 React-Flow v12 타입 정의**
- [ ] `ReactFlowTypes` 인터페이스 파일 생성
  - [ ] `packages/agents/src/types/react-flow-types.ts`
  - [ ] React-Flow v12.8.2 호환 Node, Edge 인터페이스 정의
  - [ ] Robota 워크플로우 특화 확장 타입 정의
  - [ ] v12 신규 기능 (SSR, Dark Mode, Reactive Flows) 지원 타입

#### **2.2 Universal → React-Flow 변환기 구현**
- [ ] `UniversalToReactFlowConverter` 클래스 생성
  - [ ] `packages/agents/src/services/universal-to-react-flow-converter.ts`
  - [ ] UniversalWorkflowStructure → React-Flow v12 데이터 변환
  - [ ] 노드 타입별 맞춤 변환 로직
  - [ ] 엣지 스타일링 및 애니메이션 설정
  - [ ] v12 신규 필드 (`measured`, `selectable`, `deletable`) 처리
- [ ] 노드 위치 최적화 알고리즘 구현
  - [ ] 자동 레이아웃 (Dagre, Force-directed 등 고려)
  - [ ] 충돌 방지 및 가독성 최적화
  - [ ] 반응형 크기 조정
  - [ ] SSR/SSG 지원을 위한 `width`, `height` 사전 계산

#### **2.3 React-Flow v12 특화 기능 구현**
- [ ] 커스텀 노드 타입 정의 (v12 호환)
  - [ ] Agent 노드 (🤖 아이콘 + 라벨)
  - [ ] Tool Call 노드 (⚡ 아이콘 + 도구명)
  - [ ] User Input 노드 (👤 아이콘 + 입력 내용)
  - [ ] Response 노드 (💬 아이콘 + 응답 내용)
  - [ ] Group 노드 (Team 실행 그룹화)
- [ ] 커스텀 엣지 타입 정의 (v12 호환)
  - [ ] 실행 연결 (→)
  - [ ] 생성 연결 (⇒)
  - [ ] 반환 연결 (↩)
  - [ ] 애니메이션 효과 (`animated: true`)
  - [ ] 조건부 스타일링 (성공/실패 상태별)
- [ ] Dark Mode 지원
  - [ ] `colorMode` prop 활용
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

### **Phase 4: 데이터 검증 및 품질 보증**

#### **4.1 React-Flow 데이터 검증 시스템 구현**
- [ ] `ReactFlowDataValidator` 클래스 생성
  - [ ] `packages/agents/src/validators/react-flow-data-validator.ts`
  - [ ] v12.8.2 호환성 검증 (필수 필드, 타입 체크)
  - [ ] 노드/엣지 ID 중복 검증
  - [ ] 순환 참조 검증 (무한 루프 방지)
  - [ ] 연결 유효성 검증 (존재하지 않는 노드 참조 체크)
- [ ] 실시간 검증 시스템
  - [ ] 변환 과정 중 실시간 검증
  - [ ] 오류 발생 시 상세 에러 메시지 제공
  - [ ] 검증 실패 시 자동 복구 시도
  - [ ] 검증 결과 로깅 및 디버깅 정보

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

## 📁 예상 파일 구조

```
packages/agents/src/
├── types/
│   ├── react-flow-types.ts          # React-Flow v12 타입 정의
│   └── universal-workflow-types.ts   # 범용 워크플로우 타입
├── services/
│   ├── workflow-to-universal-converter.ts    # 기존 → 범용 변환
│   ├── universal-to-react-flow-converter.ts  # 범용 → React-Flow 변환
│   ├── real-time-react-flow-generator.ts     # 실시간 React-Flow 생성기
│   └── (기존 파일들...)
├── validators/
│   └── react-flow-data-validator.ts  # React-Flow 데이터 검증기
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

### **🔍 검증 완료 기준**
- [ ] 모든 생성된 React-Flow 데이터가 검증기를 통과
- [ ] Playground에서 실시간 워크플로우 시각화 정상 동작
- [ ] 성능 기준 만족 (변환 < 100ms, 검증 < 50ms, 렌더링 < 500ms)
- [ ] 모든 테스트 케이스 통과 (커버리지 > 90%)