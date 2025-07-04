# 현재 시스템 분석 결과 및 마이그레이션 계획

> 이 문서는 [Robota SDK 기반 Agentic AI 플래닝 설계 문서](./agent-planning.md)의 일부입니다.

## ✅ 완성된 부분
1. **BaseAgent 아키텍처**: 완전한 타입 안전 시스템 구축됨
2. **AgentFactory**: 동적 에이전트 생성 및 템플릿 시스템 완성
3. **Team 시스템**: CAMEL 기법의 초기 구현체 (단순화된 버전)
4. **플러그인 시스템**: BasePlugin 기반 통합 플러그인 아키텍처
5. **타입 시스템**: Zero any/unknown 정책 달성
6. **템플릿 생태계**: 7개 빌트인 템플릿 및 확장 가능한 구조

## 🔄 마이그레이션 요소
1. **Team → CAMELPlanner**: 기존 Team 로직을 CAMELPlanner로 발전
2. **템플릿 시스템**: Planning 시스템에 통합
3. **사용자 마이그레이션**: Team 사용자를 Planning으로 순차 이전
4. **Deprecation 계획**: Planning 시스템 안정화 후 Team 패키지 단계적 제거

## Team과 Planning의 관계 (마이그레이션 관점)

| 측면 | Team (현재, 곧 deprecated) | Planning (새로운 표준) |
|------|-------------|------------------|
| **본질** | CAMEL 기법의 초기 구현체 | 종합적 플래닝 알고리즘 플랫폼 |
| **실행 방식** | 템플릿 기반 즉시 델리게이션 | 전략별 플래너 선택 → 계획 수립 → 실행 |
| **에이전트 사용** | 7개 빌트인 템플릿 전문가 | 플래너별 최적화된 에이전트 |
| **적용 분야** | 일반적인 작업 분배 | 다양한 플래닝 전략 (CAMEL, ReAct, Reflection 등) |
| **확장성** | 제한적 (템플릿 추가만 가능) | 무제한 (새로운 플래너 알고리즘 추가) |
| **미래** | Deprecated 예정 | 장기 지원 및 발전 |

## Planning 시스템의 장점

### 1. **통합된 플래닝 플랫폼**
- 기존 Team의 CAMEL 기능을 포함한 종합적 플래닝
- 다양한 플래닝 알고리즘을 하나의 인터페이스로 사용

### 2. **향상된 전략적 접근**
- 작업별 최적 플래너 자동 선택
- 실패 시 자동 폴백 및 대안 실행
- 플래너 조합을 통한 복합적 문제 해결

### 3. **확장성과 미래 보장**
- 새로운 플래너 알고리즘 쉽게 추가
- 도메인별 특화 플래너 개발 가능
- 장기 지원 및 지속적 발전

### 4. **향상된 모니터링**
- 실시간 플래닝 과정 추적
- 플래너별 성능 분석 및 최적화
- 세션 기반 상세 분석

### 5. **마이그레이션 지원**
- 기존 Team 사용자의 점진적 전환 지원
- 하위 호환성 보장
- 기존 템플릿 시스템 완전 활용

## Team에서 Planning으로의 마이그레이션 계획

### Phase 1: Planning 시스템 구축
- CAMELPlanner에 기존 Team 로직 완전 이관
- 기존 7개 템플릿 완전 호환
- 성능 및 기능 개선

### Phase 2: 마이그레이션 지원
- Team → Planning 마이그레이션 가이드 제공
- 호환성 레이어 제공 (필요시)
- 사용자 피드백 수집 및 개선

### Phase 3: Team 패키지 Deprecation
- Team 패키지에 deprecation 경고 추가
- Planning 시스템 안정화 확인
- 문서에서 Team 사용법 제거

### Phase 4: Team 패키지 제거
- 충분한 마이그레이션 기간 후 Team 패키지 제거
- Planning이 유일한 다중 에이전트 솔루션으로 정착

## 시나리오 4: Team에서 Planning으로 마이그레이션 예제

**상황**: 기존 Team 사용자가 Planning 시스템으로 점진적 마이그레이션

```typescript
// 기존 Team 코드 (deprecated 예정)
import { createTeam } from '@robota-sdk/team';

const team = createTeam({
    aiProviders: { openai: openaiProvider },
    maxMembers: 3,
    debug: true
});

// 기존 방식
const legacyResult = await team.execute("시장 조사 보고서를 작성해줘");

// ↓ 마이그레이션 ↓

// 새로운 Planning 코드 (권장)
import { createPlanner } from '@robota-sdk/planning';
import { CAMELPlanner } from '@robota-sdk/planning-camel';

// 기존 Team의 로직을 발전시킨 CAMELPlanner 사용
const camelPlanner = new CAMELPlanner({
    aiProviders: { openai: openaiProvider },
    maxAgents: 3,
    // 기존 Team과 동일한 템플릿 사용으로 호환성 보장
    templates: ['domain_researcher', 'summarizer', 'general'],
    debug: true
});

const planner = createPlanner({
    planners: [camelPlanner],
    defaultStrategy: 'best-first'
});

// 동일한 결과, 향상된 기능
const modernResult = await planner.execute("시장 조사 보고서를 작성해줘");

console.log('마이그레이션 완료 - 동일한 기능, 더 나은 성능:', modernResult);
```

## 결론

이러한 Planning 시스템은 기존 Team의 모든 기능을 포함하면서도 훨씬 강력하고 확장 가능한 플래닝 플랫폼을 제공할 것입니다. 사용자들은 점진적으로 마이그레이션할 수 있으며, 기존 투자(템플릿, 설정 등)를 그대로 활용할 수 있습니다.

---

**관련 문서:**
- [메인 플래닝 설계](./agent-planning.md)
- [템플릿 vs 동적 생성 전략](./template-vs-dynamic-strategies.md)
- [도구 분배 전략](./tool-distribution-strategies.md)
- [도구 주입 전략](./tool-injection-strategies.md)
- [사용 시나리오 및 예제](./usage-scenarios-examples.md) 