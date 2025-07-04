# 도구(Tool) 분배 전략: 에이전트별 도구 관리 방법론

> 이 문서는 [Robota SDK 기반 Agentic AI 플래닝 설계 문서](./agent-planning.md)의 일부입니다.

## 🛠️ **도구 분배의 3가지 접근법**

각 플래닝 기법과 에이전트의 특성에 따라 최적의 도구 분배 전략이 다릅니다:

### **1) 템플릿 기반 전용 도구 (Template-Specific Tools)**

**적용 상황**: CAMEL/Team 방식에서 역할이 명확한 경우
```typescript
// 예시: 전문화된 에이전트별 도구 세트
const researcherTemplate = {
    id: 'domain_researcher',
    tools: ['web_search', 'arxiv_search', 'pubmed_search', 'citation_analyzer'],
    reason: '연구 전문가는 정보 수집 도구만 집중적으로 사용'
};

const analyzerTemplate = {
    id: 'data_analyzer', 
    tools: ['statistical_analysis', 'chart_generator', 'data_visualization'],
    reason: '데이터 분석가는 분석 도구에만 집중'
};
```

**장점**: 
- 역할에 최적화된 도구만 제공으로 혼란 최소화
- 보안상 최소 권한 원칙 적용
- 도구 사용 패턴이 예측 가능

**단점**: 
- 유연성 부족 (상황 변화 시 적응 어려움)
- 도구 중복 설정 필요

### **2) LLM 동적 도구 분배 (LLM-Driven Tool Allocation)**

**적용 상황**: ReAct/Reflection 방식에서 탐색적 문제해결이 필요한 경우
```typescript
// 예시: LLM이 상황에 따라 도구를 동적 선택
const dynamicAgent = {
    availableTools: ['web_search', 'calculator', 'file_reader', 'email_sender', 'calendar'],
    toolSelector: async (task: string, context: any) => {
        // LLM이 작업 내용을 분석해서 필요한 도구만 활성화
        const selectedTools = await llm.analyze(`
            작업: ${task}
            상황: ${context}
            위 도구 중에서 이 작업에 필요한 도구들만 선택하세요.
        `);
        return selectedTools;
    }
};
```

**장점**:
- 상황에 최적화된 도구 조합
- 유연성과 적응성 극대화
- 새로운 상황에 창의적 대응

**단점**:
- 예측 불가능성 (도구 선택 실수 가능)
- 토큰 비용 증가
- 도구 학습 시간 필요

### **3) 하이브리드 접근법 (Hybrid Approach) - 권장**

**적용 상황**: 대부분의 실무 환경에서 권장되는 방식
```typescript
// 예시: 기본 도구셋 + 상황별 확장
const hybridAgent = {
    coreTools: ['web_search', 'calculator', 'text_processor'], // 모든 에이전트 공통
    specializedTools: {
        'research': ['arxiv_search', 'citation_analyzer'],
        'analysis': ['statistical_analysis', 'chart_generator'],
        'communication': ['email_sender', 'calendar', 'slack_api']
    },
    toolSelector: (agentRole: string, taskType: string) => {
        const tools = [...coreTools];
        
        // 역할별 기본 도구 추가
        if (specializedTools[agentRole]) {
            tools.push(...specializedTools[agentRole]);
        }
        
        // 작업 유형별 도구 추가 (LLM 판단)
        const additionalTools = llm.selectAdditionalTools(taskType, availableTools);
        tools.push(...additionalTools);
        
        return tools;
    }
};
```

## 🎯 **플래닝 기법별 권장 도구 전략**

| 플래닝 기법 | 권장 도구 전략 | 이유 |
|------------|---------------|------|
| **CAMEL** | 템플릿 기반 전용 | 역할 분담이 명확하므로 전문화된 도구셋이 효율적 |
| **ReAct** | LLM 동적 분배 | 탐색적 특성상 상황별 유연한 도구 조합 필요 |
| **Reflection** | 하이브리드 | 기본 작업 + 개선을 위한 추가 도구 동적 선택 |
| **Hierarchical** | 계층별 차등 | 상위 에이전트는 많은 도구, 하위는 전문 도구만 |

## 🔄 **MCP(Model Context Protocol) 통합 전략**

현재 Team 시스템에서는 **모든 에이전트가 동일한 기본 도구셋을 공유**하는 패턴을 사용:

```typescript
// 현재 Team 시스템 방식
temporaryAgent = new Robota({
    ...baseRobotaOptions,
    tools: [...delegationTools, ...(baseRobotaOptions.tools || [])]
    // 모든 에이전트가 동일한 tools 배열 사용
});
```

**Planning 시스템에서의 개선된 MCP 전략**:
```typescript
// 제안: 동적 MCP 서버 할당
const planningAgent = {
    mcpStrategy: 'dynamic', // 'fixed' | 'dynamic' | 'hybrid'
    
    mcpServerAllocation: async (agentRole: string, taskContext: any) => {
        const coreMcpServers = ['filesystem', 'web_search']; // 기본 MCP 서버
        
        // 역할별 전문 MCP 서버 추가
        const specializedServers = {
            'researcher': ['arxiv_mcp', 'pubmed_mcp'],
            'analyst': ['data_viz_mcp', 'statistical_mcp'],
            'writer': ['grammar_check_mcp', 'style_guide_mcp']
        };
        
        // LLM이 작업 맥락에 따라 추가 MCP 서버 결정
        const additionalServers = await llm.selectMcpServers(taskContext);
        
        return [
            ...coreMcpServers,
            ...(specializedServers[agentRole] || []),
            ...additionalServers
        ];
    }
};
```

## 💡 **실무 권장사항**

**개발자 관점에서의 도구 총량 제어**:
```typescript
// 개발자가 사전에 정의한 안전한 도구 풀
const AVAILABLE_TOOL_POOL = {
    safe: ['web_search', 'calculator', 'text_processor'],
    restricted: ['email_sender', 'file_writer'], // 권한 검증 필요
    dangerous: ['system_command', 'database_delete'] // 특별 승인 필요
};

// 에이전트별 도구 할당 시 안전성 검증
const allocateTools = (agentRole: string, requestedTools: string[]) => {
    const allowedTools = requestedTools.filter(tool => {
        return AVAILABLE_TOOL_POOL.safe.includes(tool) || 
               (AVAILABLE_TOOL_POOL.restricted.includes(tool) && hasPermission(agentRole, tool));
    });
    
    return allowedTools;
};
```

**결론**: **하이브리드 접근법**이 가장 실무적으로 유용하며, 기본 도구셋은 공통으로 제공하되 LLM이 상황에 따라 추가 도구를 선택할 수 있도록 하는 것이 최적입니다.

---

**관련 문서:**
- [메인 플래닝 설계](./agent-planning.md)
- [AgentFactory 확장 전략](./agentfactory-expansion-strategy.md)
- [템플릿 vs 동적 생성 전략](./template-vs-dynamic-strategies.md)
- [도구 주입 전략](./tool-injection-strategies.md)
- [플래너별 템플릿 전략](./planner-template-strategies.md) 