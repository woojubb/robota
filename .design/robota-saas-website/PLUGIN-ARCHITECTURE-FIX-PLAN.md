# PlaygroundHistoryPlugin 아키텍처 수정 계획

## 🚨 현재 문제 상황

**핵심 오류**: `TypeError: Cannot read properties of undefined (reading 'calls')`
**원인**: PlaygroundHistoryPlugin이 Robota SDK의 BasePlugin 아키텍처를 올바르게 구현하지 않음

## 🎯 문제 분석

### 1. 아키텍처 규칙 위반
- **문제**: 커스텀 BasePlugin 클래스를 임의로 생성함
- **규칙**: Robota SDK의 공식 BasePlugin을 사용해야 함
- **영향**: stats, incrementCalls 등 필수 메서드 누락

### 2. 의존성 주입 패턴 미준수
- **문제**: logger 초기화가 부정확함  
- **규칙**: SimpleLogger 의존성 주입 패턴 준수
- **영향**: this.logger.error 오류 발생

### 3. 타입 안전성 부족
- **문제**: any 타입 남용, 필수 필드 누락
- **규칙**: 엄격한 타입 정의 및 인터페이스 준수
- **영향**: 런타임 오류 및 예측 불가능한 동작

## 📋 체계적 수정 계획

### ✅ Phase 1: Robota SDK BasePlugin 정확한 구현

#### [x] 1.1 공식 BasePlugin import 및 상속
- [x] `@robota-sdk/agents`에서 공식 BasePlugin import
- [x] 커스텀 BasePlugin 클래스 제거
- [x] PlaygroundHistoryPlugin이 공식 BasePlugin 상속하도록 수정
- [x] **즉시 검증**: import 오류 없이 컴파일 확인

#### [x] 1.2 필수 추상 메서드 구현
- [x] `getStats(): PlaygroundHistoryPluginStats` 구현
- [x] `dispose(): Promise<void>` 구현  
- [x] `onModuleEvent(eventType: string, eventData: any): Promise<void>` 구현
- [x] **즉시 검증**: 모든 추상 메서드 구현 완료

#### [x] 1.3 생성자 의존성 주입 수정
- [x] `constructor(options?: PlaygroundHistoryPluginOptions)` 시그니처 수정
- [x] `super()` 호출로 BasePlugin 초기화
- [x] logger 의존성 주입 패턴 준수
- [x] **즉시 검증**: 생성자 호출 시 오류 없음

### ✅ Phase 2: 타입 안전성 및 인터페이스 정의

#### [x] 2.1 PlaygroundHistoryPluginOptions 인터페이스 정의
- [x] BasePluginOptions 상속
- [x] 필수 옵션들 타입 안전하게 정의
- [x] 선택적 옵션들 명시적 표시
- [x] **즉시 검증**: 타입스크립트 컴파일 오류 없음

#### [x] 2.2 PlaygroundHistoryPluginStats 인터페이스 정의  
- [x] PluginStats 상속
- [x] 플러그인별 통계 필드 정의
- [x] getStats() 메서드와 일치하는 구조
- [x] **즉시 검증**: getStats() 반환 타입 일치

#### [x] 2.3 ConversationEvent 필드 기본값 처리
- [x] childEventIds 기본값 `[]` 설정
- [x] executionLevel 기본값 설정 로직
- [x] executionPath 기본값 설정 로직
- [x] **즉시 검증**: recordEvent 호출 시 모든 필드 정의됨

### ✅ Phase 3: 핵심 기능 메서드 재구현

#### [x] 3.1 recordEvent 메서드 안전성 강화
- [x] 매개변수 타입 엄격하게 정의
- [x] 필수 필드 자동 생성 로직 구현
- [x] null/undefined 안전성 보장
- [x] **즉시 검증**: recordEvent 호출 시 오류 없음

#### [x] 3.2 getVisualizationData 메서드 수정
- [x] 모든 필드 기본값 보장
- [x] mode, agents, currentExecution 안전한 접근
- [x] 빈 배열/객체 기본값 설정
- [x] **즉시 검증**: getVisualizationData 호출 시 오류 없음

#### [x] 3.3 관계 관리 메서드 안전성 강화
- [x] calculateExecutionLevel null 체크
- [x] buildExecutionPath 안전한 문자열 생성
- [x] relationshipTracker Map 초기화 보장
- [x] **즉시 검증**: 모든 관계 관리 메서드 안전 동작

## 📊 현재 상황 요약

**✅ 해결 완료**:
- `TypeError: Cannot read properties of undefined (reading 'calls')` 오류 해결
- 공식 BasePlugin 상속 및 의존성 주입 패턴 적용 완료
- 5개 기본 이벤트 타입으로 단순화 완료
- 계층 구조 UI 표시 로직 구현 완료

**🔄 현재 문제**:
- Team 실행 시 assignTask Hook이 실행되지 않아 계층 구조가 나타나지 않음
- 단순히 Team level의 user_message와 assistant_response만 표시됨

**🎯 해결 방안**: 
TeamOptions에 toolHooks 옵션 추가하여 표준화된 Hook 주입 방법 제공

## 📋 구현 계획

✅ **상세 구현 체크리스트**: [TEAM-HOOKS-IMPLEMENTATION-CHECKLIST.md](./TEAM-HOOKS-IMPLEMENTATION-CHECKLIST.md)

**구현 우선순위**:
1. **Team 패키지 toolHooks 지원 추가** - SDK 레벨 변경
2. **Playground toolHooks 활용** - 웹 앱 연동  
3. **통합 테스트 및 검증** - 동작 확인

**아키텍처 원칙 준수**:
- Robota SDK의 Dependency Injection 패턴 활용
- 기존 ToolHooks 인터페이스 재사용으로 일관성 유지
- 하위 호환성 보장 (toolHooks 미사용 시 기존 동작) 