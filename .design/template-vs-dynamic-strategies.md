# 템플릿 vs 동적 생성: Planning 전략별 최적 접근법

> 이 문서는 [Robota SDK 기반 Agentic AI 플래닝 설계 문서](./agent-planning.md)의 일부입니다.

## 🎯 **플래닝 기법별 에이전트 생성 전략**

각 플래닝 알고리즘은 서로 다른 철학과 실행 방식을 가지므로, 에이전트 생성 방식도 달라야 한다:

### **1. CAMEL Planner - 템플릿 기반 접근이 최적**
**이유**: 역할 기반 협업 구조
- **명확한 전문성**: 각 에이전트가 특정 역할 (연구자, 검토자, 요약자 등)
- **구조화된 워크플로우**: 예측 가능한 상호작용 패턴
- **안정적 협업**: 역할 분담이 명확해 일관된 결과 보장

```typescript
// CAMEL에서 템플릿이 효과적인 이유
const camelPlanner = new CAMELPlanner({
    templates: [
        'domain_researcher',  // "너는 전문 연구자야"
        'ethical_reviewer',   // "너는 윤리 검토 전문가야"
        'creative_ideator'    // "너는 창의적 아이디어 담당이야"
    ],
    // 각자의 명확한 역할로 예측 가능한 협업
});
```

### **2. ReAct Planner - 완전 동적 생성이 최적**
**이유**: 상황적 추론과 도구 중심 접근
- **상황적 판단**: 매 순간 "지금 뭘 해야 할까?" 스스로 결정
- **도구 기반 행동**: 필요에 따라 다른 도구/API 선택
- **탐색적 문제해결**: 미리 정의할 수 없는 창발적 해결책

```typescript
// ReAct에서 동적 생성이 필요한 이유
const reactPlanner = new ReActPlanner({
    tools: ['web_search', 'calculator', 'file_system'],
    // 템플릿 없음! 상황에 맞게 스스로 추론하고 행동
    allowDynamicReasoning: true,
    maxSteps: 15
});
```

### **3. Reflection Planner - 자기 개선 중심 동적 접근**
**이유**: 메타 인지와 반복적 개선
- **자기 비판**: 자신의 결과를 스스로 평가
- **반복 개선**: 피드백 기반 지속적 향상
- **품질 중심**: "더 나은 결과"를 위한 동적 조정

```typescript
// Reflection에서 동적 개선이 핵심
const reflectionPlanner = new ReflectionPlanner({
    reflectionCycles: 3,
    // 결과를 스스로 평가하고 동적으로 개선
    qualityThreshold: 0.8,
    selfCritiqueEnabled: true
});
```

## 🔄 **하이브리드 접근: 최고의 양쪽 장점 활용**

### **템플릿으로 시작 → 필요시 동적 확장**
```typescript
const hybridCAMELPlanner = new CAMELPlanner({
    // 1단계: 안정적 기본 템플릿으로 시작
    coreTemplates: ['general', 'domain_researcher', 'summarizer'],
    
    // 2단계: 필요시 동적 에이전트 생성 허용
    allowDynamicAgents: true,
    dynamicAgentCreationPrompt: `
        현재 작업에 기존 템플릿 에이전트들로 부족한 전문성이 있다면,
        새로운 전문가 에이전트를 동적으로 생성해서 활용해라.
        예: 법률 검토가 필요하면 '법률 전문가' 에이전트 생성
    `,
    
    // 3단계: LLM이 상황 판단해서 최적 전략 선택
    agentSelectionStrategy: 'llm-guided'
});
```

## 📊 **플래닝 기법별 비교표**

| 플래닝 기법 | 에이전트 생성 방식 | LLM 활용도 | 적합한 상황 | 장점 |
|------------|------------------|------------|-------------|------|
| **CAMEL** | 템플릿 기반 (+ 동적 확장) | ⭐⭐⭐⭐ | 구조화된 협업 프로젝트 | 안정성, 예측가능성 |
| **ReAct** | 완전 동적 생성 | ⭐⭐⭐⭐⭐ | 탐색적 문제해결 | 유연성, 창의적 해결책 |
| **Reflection** | 동적 개선 중심 | ⭐⭐⭐⭐⭐ | 품질 중요한 작업 | 지속적 개선, 높은 품질 |
| **Sequential** | 미리 정의된 단계 | ⭐⭐⭐ | 명확한 절차적 작업 | 효율성, 일관성 |
| **Parallel** | 병렬 분산 처리 | ⭐⭐⭐⭐ | 대규모 복합 작업 | 속도, 동시 처리 |

## 💡 **LLM 역량 최대 활용 전략**

### **상황별 최적 플래너 자동 선택**
```typescript
const intelligentPlanner = createPlanner({
    planners: [
        camelPlanner,     // 안정적 협업이 필요한 경우
        reactPlanner,     // 탐색적 문제 해결이 필요한 경우
        reflectionPlanner // 품질 개선이 중요한 경우
    ],
    
    // LLM이 작업 특성 분석해서 최적 플래너 선택
    selectionStrategy: 'llm-guided',
    selectionPrompt: `
        주어진 작업의 특성을 분석해서 최적의 플래닝 전략을 선택해라:
        - 구조화된 협업이 필요하면 → CAMEL
        - 탐색적 문제해결이 필요하면 → ReAct  
        - 높은 품질이 중요하면 → Reflection
    `
});
```

### **결론: 획일적 접근을 피하고 상황별 최적화**
- ✅ **CAMEL**: 템플릿 기반으로 안정적 협업 구조 제공
- ✅ **ReAct**: 완전 동적으로 LLM의 추론 능력 최대 활용
- ✅ **Reflection**: 자기 개선으로 품질 향상에 LLM 역량 집중
- ✅ **하이브리드**: 상황에 맞는 최적 전략 자동 선택

이렇게 설계하면 각 플래닝 기법의 고유한 장점을 살리면서 LLM의 능력을 최대한 활용할 수 있다.

---

**관련 문서:**
- [메인 플래닝 설계](./agent-planning.md)
- [AgentFactory 확장 전략](./agentfactory-expansion-strategy.md)
- [도구 분배 전략](./tool-distribution-strategies.md)
- [도구 주입 전략](./tool-injection-strategies.md)
- [플래너별 템플릿 전략](./planner-template-strategies.md) 