# 플래너별 템플릿 전략: 각 플래닝 기법의 특성에 맞는 템플릿 활용

> 이 문서는 [Robota SDK 기반 Agentic AI 플래닝 설계 문서](./agent-planning.md)의 일부입니다.

## 🎯 **플래너별 템플릿 주입 및 사용 전략**

각 플래닝 기법 클래스에 템플릿을 주입할 때, 그 사용 방식을 다르게 설정할 수 있습니다:

### **1) CAMEL Planner: 템플릿 직접 사용 전략**

**철학**: 역할 기반 협업에서는 명확한 전문성이 핵심
```typescript
// CAMEL Planner: AgentFactory의 템플릿 기능을 직접 활용
class CAMELPlanner {
    constructor(private agentFactory: AgentFactory) {
        // 기본 템플릿들을 AgentFactory에 등록
        this.setupTemplates();
    }
    
    async execute(task: string): Promise<any> {
        // CAMEL 방식: 역할별 전문 에이전트 팀 구성
        const team = await this.agentFactory.createBatch([
            { templateId: 'domain_researcher', role: 'researcher' },
            { templateId: 'summarizer', role: 'writer' },
            { templateId: 'ethical_reviewer', role: 'reviewer' }
        ]);
        
        return this.executeCollaboration(team, task);
    }
}
```

### **2) ReAct Planner: 동적 생성 중심 전략**

**철학**: 탐색적 문제해결에서는 유연성이 더 중요
```typescript
class ReActPlanner {
    async execute(task: string, availableTools: string[]): Promise<any> {
        const steps = await this.planSteps(task);
        const results = [];
        
        for (const step of steps) {
            // 각 단계마다 최적화된 에이전트 동적 생성
            const agent = await this.agentFactory.createFromPrompt(`
                You are an AI agent using ReAct methodology.
                Current task step: ${step}
                Available tools: ${availableTools.join(', ')}
            `);
            
            const stepResult = await agent.process(step);
            results.push(stepResult);
        }
        
        return this.synthesizeResults(results);
    }
}
```

### **3) Reflection Planner: 하이브리드 접근 전략**

**철학**: 기본 구조 + 반복적 개선
```typescript
class ReflectionPlanner {
    async execute(task: string): Promise<any> {
        let currentResult = null;
        let cycle = 0;
        const maxCycles = 3;
        
        while (cycle < maxCycles) {
            // 1단계: 작업 수행 (첫 번째는 템플릿, 이후는 개선된 버전)
            const worker = cycle === 0 
                ? await this.createInitialWorker(task)
                : await this.createImprovedWorker(task, currentResult);
            
            currentResult = await worker.process(task);
            
            // 2단계: 품질 검토
            const reviewer = await this.createQualityReviewer(task, currentResult);
            const review = await reviewer.evaluate(currentResult);
            
            if (review.qualityScore >= 0.8) {
                break;
            }
            
            cycle++;
        }
        
        return currentResult;
    }
}
```

---

**관련 문서:**
- [메인 플래닝 설계](./agent-planning.md)
- [AgentFactory 확장 전략](./agentfactory-expansion-strategy.md)
- [템플릿 vs 동적 생성 전략](./template-vs-dynamic-strategies.md)
- [도구 분배 전략](./tool-distribution-strategies.md)
- [도구 주입 전략](./tool-injection-strategies.md)
- [현재 시스템 분석](./current-system-analysis.md)
