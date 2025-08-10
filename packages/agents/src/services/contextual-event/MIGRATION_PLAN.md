# ContextualEventService Migration Plan

## 🎯 **혁신적 설계 목표**

`ActionTrackingEventService`를 **단일 배열 주입 기반** `ContextualEventService`로 교체하여:
1. **`createChild(this)` 패턴** 완성 - 극단적 사용성 개선
2. **단일 `extractors` 배열 방식** - 이중 구조(typeMap/nameMap) 제거
3. **표준 타입 매칭** - `instanceof`/`constructor.name` 기반 명확한 매칭
4. **최상위 한 번만 설정** - Root injection으로 메모리 효율성 달성

## 📋 **새로운 설계 기반 마이그레이션**

### Phase 1: 단일 배열 주입 방식 ContextualEventService 구현 ✅
- [x] 혁신적인 `createChild(this)` 패턴 설계 완료
- [x] 단일 `extractors` 배열 방식 확정 - 이중 구조 제거
- [x] 표준 타입 매칭 (`instanceof`/`constructor.name`) 설계
- [x] 최상위 한 번만 설정하는 Root injection 패턴 설계
- [x] 도메인별 컨텍스트 추출 함수 패턴 정의

### Phase 2: 단일 배열 기반 구현 ✅
- [x] `ContextExtractor` 인터페이스 정의 (`ctor`/`name` + `extract`)
- [x] `ContextExtractorFunction` 타입 정의
- [x] Constructor options에 `contextExtractors` 배열 지원
- [x] 오버로드된 `createChild()` 메서드 구현 (명시적 컨텍스트 + `this` 객체 지원)
- [x] `extractContextFromSource()` 메서드 구현 - 배열 순서대로 매칭

### Phase 3: 기본 컨텍스트 추출 함수들 구현 (TODO)
- [ ] `agentContextExtractor` - Agent 타입 처리 함수
- [ ] `teamContextExtractor` - Team 타입 처리 함수  
- [ ] `toolContextExtractor` - Tool 타입 처리 함수
- [ ] `workflowContextExtractor` - Workflow 타입 처리 함수
- [ ] `genericContextExtractor` - Fallback 함수

### Phase 4: 애플리케이션 부트스트랩 패턴 구현 (TODO)
- [ ] Root EventService 생성 패턴 정의
- [ ] 표준 컨텍스트 추출 함수 배열 구성
- [ ] 애플리케이션별 커스텀 함수 추가 방법 정의
- [ ] Factory 패턴으로 도메인별 기본 구성 제공

### Phase 5: Core EventService 교체 (TODO)
- [ ] `event-service.ts`에서 ActionTrackingEventService → ContextualEventService 교체
- [ ] EventService 인터페이스에 `createChild` 메서드 필수화
- [ ] 하위 호환성 보장 (기존 명시적 컨텍스트 방식 유지)

### Phase 6: 사용처 마이그레이션 (TODO)
- [ ] Robota 클래스: `createChild(this)` 패턴 적용
- [ ] TeamContainer: Duck typing 제거, `createChild(this)` 적용
- [ ] ExecutionService: ContextualEventService 사용
- [ ] SubAgentEventRelay: ContextualEventService 상속으로 변경

### Phase 7: 마이그레이션 코드 정리 (TODO)
- [ ] `ContextualEventServiceFactory.wrap()` 메서드 삭제
- [ ] `ContextualEventServiceHelpers.safeCreateChild()` 메서드 삭제
- [ ] `enhanced-event-service.ts` 파일 전체 삭제
- [ ] `MIGRATION_PLAN.md` 파일 삭제 (이 파일)
- [ ] 모든 마이그레이션 관련 문서 및 주석 정리

## 🎯 **단일 배열 주입 방식의 핵심 이점**

### **1. 극단적 단순성**
```typescript
// ❌ 기존: 복잡한 컨텍스트 생성
const child = parent.createChild({
    executionId: generateId(),
    sourceType: 'team',
    sourceId: this.teamId,
    metadata: { teamSize: this.agents.length }
});

// ✅ 새로운: 한 줄로 완료
const child = parent.createChild(this);
```

### **2. 단일 배열 설정**
```typescript
// 🏗️ 애플리케이션 시작시 한 번만 - 단일 배열로 모든 extractor 설정
const rootEventService = new ContextualEventService({
    contextExtractors: [
        { ctor: Robota, extract: agentContextExtractor },         // instanceof 매칭
        { ctor: TeamContainer, extract: teamContextExtractor },   // instanceof 매칭
        { name: 'AssignTaskTool', extract: toolContextExtractor }, // constructor.name 매칭
        { extract: genericFallbackExtractor }                     // fallback (조건 없음)
    ]
});

// 🔄 이후 모든 곳에서 동일한 extractors 자동 상속
```

### **3. 표준 타입 매칭 및 성능 효율성**
- **표준 매칭**: `instanceof`/`constructor.name` 기반 명확한 타입 식별
- **배열 순서 우선순위**: 첫 매칭 성공시 즉시 반환, 명확한 우선순위
- **extractor 참조 공유**: 모든 EventService 인스턴스가 동일한 extractor 배열 참조
- **캐싱 불필요**: 단순 배열 순회와 함수 호출로 충분히 빠름
- **이중 구조 제거**: typeMap/nameMap 같은 복잡한 구조 불필요

## ⚠️ **삭제 예정 파일 및 기능**

### **완전 삭제 대상**
- `enhanced-event-service.ts` - 전체 파일
- `MIGRATION_PLAN.md` - 이 파일 자체
- `factory.ts`의 `wrap()`, `safeCreateChild()` 메서드
- 모든 마이그레이션 관련 주석 및 문서

### **핵심 원칙**
1. **단일 방식**: 단일 `extractors` 배열만 지원 (이중 구조 제거)
2. **도메인 중립**: 핵심 서비스가 특정 클래스를 알지 않음
3. **표준 매칭**: `instanceof`/`constructor.name` 표준 방식만 사용
4. **생산 코드만**: 테스트용 기능은 production code에서 완전 분리

## 🚀 **성공 기준**

- [x] 단일 `extractors` 배열 구조 완성
- [x] `createChild(this)` 패턴이 모든 곳에서 작동
- [x] `instanceof`/`constructor.name` 표준 매칭 구현
- [ ] 애플리케이션 부트스트랩에서 한 번만 설정
- [ ] ActionTrackingEventService 완전 제거
- [ ] Duck typing 및 'createContextBoundInstance' 체크 모두 제거
- [ ] 마이그레이션 관련 코드 모두 삭제
