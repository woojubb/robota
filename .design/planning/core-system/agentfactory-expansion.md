# AgentFactory 확장 전략: 독립성과 확장성을 갖춘 에이전트 생성 엔진

> 이 문서는 [Robota SDK Planning 시스템](./agent-planning.md)에서 핵심 역할을 할 AgentFactory의 확장 방향과 설계 철학을 다룹니다.

## 🎯 설계 철학

AgentFactory는 **"독립성을 유지하면서도 확장 가능한 에이전트 생성 엔진"**을 목표로 설계됩니다:

### 핵심 원칙
1. **독립성 보장**: Planning 시스템에 종속되지 않고 범용적으로 사용 가능
2. **권한 위임**: 에이전트 생성의 모든 권한과 책임을 AgentFactory가 보유
3. **확장성 중심**: 새로운 요구사항에 유연하게 대응 가능한 구조
4. **타입 안전성**: 기존의 Zero any/unknown 정책 유지
5. **호환성 보존**: 기존 사용자의 코드 변경 최소화

### ⚠️ Module 시스템과의 관계 명확화

**AgentFactory는 Module 시스템을 활용하지만 중복 구현하지 않습니다:**

```typescript
// ✅ 올바른 관계: AgentFactory가 Module 시스템을 활용
class AgentFactory {
    async createWithModules(config: AgentConfig, modules: BaseModule[]): Promise<AgentInterface> {
        const agent = new Robota({
            ...config,
            modules: modules  // Module 시스템을 그대로 활용
        });
        
        return agent;
    }
    
    // ❌ 잘못된 관계: AgentFactory가 독자적인 Module 시스템 구현
    // private moduleRegistry = new Map<string, any>();  // 중복 구현
}

// Planning 특화 기능만 AgentFactory에 추가
class AgentFactory {
    // Planning에 특화된 에이전트 생성 기능
    async createFromPrompt(prompt: string, context?: PlanningContext): Promise<AgentInterface>;
    async createWithConditions(conditions: AgentCreationConditions): Promise<AgentInterface>;
    async createBatch(configs: AgentConfig[]): Promise<AgentInterface[]>;
}
```

## 🏗️ 아키텍처 개요

### 현재 vs 확장된 AgentFactory 구조

```
📦 현재 AgentFactory (기본 기능)
├── 🤖 createFromTemplate() - 템플릿 기반 생성
├── 🤖 createAgent() - 직접 설정 생성
├── 📋 registerTemplate() - 템플릿 등록
└── 🔍 findTemplates() - 템플릿 검색

↓ 확장 ↓

🏭 확장된 AgentFactory (Planning 지원)
├── 🤖 기본 생성 기능 (기존 유지)
├── 🔧 조건부 생성 시스템
│   ├── createWithConditions() - 조건 기반 생성
│   ├── createFromPrompt() - 프롬프트 기반 동적 생성
│   └── createBatch() - 배치 생성
├── 🛠️ 템플릿 조작 시스템
│   ├── mergeTemplates() - 템플릿 조합
│   ├── interpolateTemplate() - 변수 보간
│   └── createVariation() - 템플릿 변형
├── 🎛️ 도구 관리 시스템
│   ├── 공통 도구 주입
│   ├── 도구 그룹 관리
│   ├── 접근 레벨 제어
│   └── 충돌 방지 및 최적화
└── 📊 모니터링 및 분석
    ├── 사용량 추적
    ├── 성능 분석
    └── 자동 최적화
```

## 1. 조건부 에이전트 생성 시스템

### 1.1 조건 기반 생성

```typescript
// 에이전트 생성 조건 타입 (semantic naming 준수)
interface AgentCreationConditions {
  // 역할 및 전문성
  role?: string;
  expertise?: string[];
  qualityLevel?: 'basic' | 'standard' | 'premium';
  
  // 작업 특성
  taskType?: 'research' | 'analysis' | 'writing' | 'review' | 'coordination';
  taskComplexity?: 'simple' | 'moderate' | 'complex';
  timeConstraint?: number; // minutes
  
  // 협업 특성
  collaborationStyle?: 'independent' | 'cooperative' | 'leadership';
  teamSize?: number;
  
  // 컨텍스트 요구사항
  contextRequirements?: string[];
  toolRequirements?: string[];
  domainKnowledge?: string[];
  
  // 품질 및 성능
  accuracyLevel?: number; // 0.0-1.0
  creativityLevel?: number; // 0.0-1.0
  speedRequirement?: 'fast' | 'balanced' | 'thorough';
}

// Planning 컨텍스트 메타데이터 타입
type PlanningContextMetadata = Record<string, string | number | boolean | Date>;

// 에이전트 생성 설정값 타입
type AgentCreationConfigValue = string | number | boolean;

// AgentFactory 확장
class AgentFactory {
  async createWithConditions(conditions: AgentCreationConditions): Promise<AgentInterface> {
    // 1. 조건에 맞는 최적 템플릿 선택
    const optimalTemplate = await this.selectOptimalTemplate(conditions);
    
    if (optimalTemplate) {
      // 2. 기존 템플릿을 조건에 맞게 조정
      const adjustedConfig = this.adjustTemplateForConditions(optimalTemplate, conditions);
      return this.createFromTemplate(optimalTemplate.id, adjustedConfig);
    } else {
      // 3. 조건에 맞는 새로운 에이전트 동적 생성
      return this.createFromConditions(conditions);
    }
  }

  private async selectOptimalTemplate(conditions: AgentCreationConditions): Promise<AgentTemplate | null> {
    // 조건에 가장 적합한 기존 템플릿 찾기
    const candidates = this.findTemplates({
      category: conditions.taskType,
      tags: conditions.expertise,
      qualityLevel: conditions.qualityLevel
    });

    if (candidates.length === 0) return null;

    // 조건별 매칭 점수 계산
    const scored = candidates.map(template => ({
      template,
      score: this.calculateMatchScore(template, conditions)
    }));

    // 임계값 이상의 매칭 점수가 있으면 해당 템플릿 반환
    const best = scored.reduce((prev, curr) => prev.score > curr.score ? prev : curr);
    return best.score >= 0.7 ? best.template : null;
  }

  private async createFromConditions(conditions: AgentCreationConditions): Promise<AgentInterface> {
    // LLM을 사용해 조건에서 AgentConfig 동적 생성
    const dynamicConfig = await this.generateConfigFromConditions(conditions);
    return this.createAgent(dynamicConfig);
  }
}
```

### 1.2 프롬프트 기반 동적 생성

```typescript
// Planning 컨텍스트 정의 (semantic naming 준수)
interface PlanningExecutionContext {
  task: string;
  complexity: 'simple' | 'moderate' | 'complex';
  timeConstraint?: number;
  qualityRequirement?: number;
  collaborationNeeded?: boolean;
  domainExpertise?: string[];
  availableTools?: string[];
}

class AgentFactory {
  async createFromPrompt(prompt: string, context?: PlanningExecutionContext): Promise<AgentInterface> {
    // 1. 프롬프트 분석 및 의도 파악
    const intent = await this.analyzePromptIntent(prompt, context);
    
    // 2. 적절한 AI 모델 선택
    const provider = this.selectOptimalProvider(intent);
    
    // 3. 시스템 메시지 동적 생성
    const systemMessage = this.generateSystemMessage(prompt, context, intent);
    
    // 4. 도구 선택
    const tools = this.selectToolsForIntent(intent, context?.availableTools);
    
    // 5. 설정 조합 및 에이전트 생성
    const config: AgentConfig = {
      name: 'dynamic-agent',
      aiProviders: [provider],
      defaultModel: {
        provider: provider.name,
        model: provider.model,
        temperature: this.calculateOptimalTemperature(intent),
        maxTokens: this.calculateOptimalTokens(intent, context?.complexity),
        systemMessage
      },
      tools
    };

    return this.createAgent(config);
  }

  private async analyzePromptIntent(prompt: string, context?: PlanningExecutionContext): Promise<PromptIntent> {
    // LLM을 사용해 프롬프트의 의도 분석
    const analysis = await this.metaLLM.analyze(`
      Analyze this prompt and context to understand the intent:
      
      Prompt: ${prompt}
      Context: ${JSON.stringify(context, null, 2)}
      
      Classify the intent along these dimensions:
      - Primary purpose (research, analysis, writing, coordination, etc.)
      - Skill requirements (technical depth, creativity, accuracy)
      - Interaction style (autonomous, collaborative, directive)
      - Quality vs Speed tradeoff
    `);

    return this.parseIntentAnalysis(analysis);
  }

  private generateSystemMessage(prompt: string, context?: PlanningExecutionContext, intent?: PromptIntent): string {
    let systemMessage = `You are an AI agent created to handle the following request: ${prompt}`;

    if (context?.domainExpertise?.length) {
      systemMessage += `\n\nYou have specialized knowledge in: ${context.domainExpertise.join(', ')}`;
    }

    if (intent?.skillRequirements) {
      systemMessage += `\n\nFocus on: ${intent.skillRequirements.join(', ')}`;
    }

    if (context?.qualityRequirement) {
      const level = context.qualityRequirement > 0.8 ? 'highest quality' : 
                   context.qualityRequirement > 0.6 ? 'good quality' : 'efficient';
      systemMessage += `\n\nPrioritize ${level} in your responses.`;
    }

    if (context?.timeConstraint) {
      systemMessage += `\n\nWork efficiently - you have approximately ${context.timeConstraint} minutes.`;
    }

    return systemMessage;
  }
}
```

### 1.3 배치 생성 시스템

```typescript
// 에이전트 사양 정의 (semantic naming 준수)
interface AgentCreationSpec {
  templateId?: string;
  role: string;
  customConfig?: Partial<AgentConfig>;
  conditions?: AgentCreationConditions;
  tools?: string[];
  priority?: 'high' | 'medium' | 'low';
}

class AgentFactory {
  async createBatch(specs: AgentCreationSpec[]): Promise<AgentInterface[]> {
    // 1. 사양 검증 및 정규화
    const validatedSpecs = this.validateAndNormalizeSpecs(specs);
    
    // 2. 생성 순서 최적화 (우선순위, 의존성 고려)
    const optimizedOrder = this.optimizeCreationOrder(validatedSpecs);
    
    // 3. 병렬 생성 (리소스 제약 고려)
    const maxConcurrency = this.calculateOptimalConcurrency();
    const agents: AgentInterface[] = [];
    
    for (let i = 0; i < optimizedOrder.length; i += maxConcurrency) {
      const batch = optimizedOrder.slice(i, i + maxConcurrency);
      const batchPromises = batch.map(spec => this.createFromSpec(spec));
      const batchResults = await Promise.all(batchPromises);
      agents.push(...batchResults);
    }
    
    // 4. 생성 후 최적화 (메모리, 도구 중복 제거 등)
    return this.optimizeBatchResult(agents);
  }

  private async createFromSpec(spec: AgentCreationSpec): Promise<AgentInterface> {
    if (spec.templateId) {
      // 템플릿 기반 생성
      return this.createFromTemplate(spec.templateId, spec.customConfig);
    } else if (spec.conditions) {
      // 조건 기반 생성
      return this.createWithConditions(spec.conditions);
    } else {
      // 기본 생성
      const defaultConfig = this.generateDefaultConfig(spec.role);
      return this.createAgent({ ...defaultConfig, ...spec.customConfig });
    }
  }

  private calculateOptimalConcurrency(): number {
    // 시스템 리소스, 토큰 제한, 메모리 사용량 고려
    const systemCores = require('os').cpus().length;
    const availableMemory = this.getAvailableMemory();
    const tokenRateLimit = this.getTokenRateLimit();
    
    return Math.min(systemCores, Math.floor(availableMemory / 100), tokenRateLimit);
  }
}
```

## 2. 템플릿 조작 시스템

### 2.1 템플릿 조합 및 변형

```typescript
// 템플릿 변형 사양 (semantic naming 준수)
interface AgentTemplateVariation {
  property: keyof AgentConfig;
  value: AgentCreationConfigValue;
  reason?: string;
}

class AgentFactory {
  mergeTemplates(templates: AgentTemplate[]): AgentTemplate {
    // 여러 템플릿의 장점을 조합한 새로운 템플릿 생성
    const mergedConfig = this.combineConfigs(templates.map(t => t.config));
    
    return {
      id: `merged_${Date.now()}`,
      name: `Merged Specialist`,
      description: `Combined expertise from ${templates.length} templates`,
      config: mergedConfig,
      category: 'dynamic',
      tags: templates.flatMap(t => t.tags || []),
      metadata: {
        sourceTemplates: templates.map(t => t.id),
        createdAt: new Date().toISOString(),
        mergeStrategy: 'intelligent_combination'
      }
    };
  }

  interpolateTemplate(template: AgentTemplate, variables: Record<string, any>): AgentTemplate {
    // 템플릿에 변수를 보간하여 맞춤형 템플릿 생성
    const interpolatedConfig = { ...template.config };
    
    // systemMessage에서 변수 치환
    if (interpolatedConfig.systemMessage) {
      interpolatedConfig.systemMessage = this.interpolateString(
        interpolatedConfig.systemMessage, 
        variables
      );
    }
    
    // 기타 문자열 필드들도 보간
    if (interpolatedConfig.instructions) {
      interpolatedConfig.instructions = this.interpolateString(
        interpolatedConfig.instructions,
        variables
      );
    }
    
    return {
      ...template,
      id: `${template.id}_interpolated_${Date.now()}`,
      config: interpolatedConfig,
      metadata: {
        ...template.metadata,
        baseTemplate: template.id,
        interpolatedVariables: Object.keys(variables),
        createdAt: new Date().toISOString()
      }
    };
  }

  async createVariation(baseTemplate: AgentTemplate, variations: AgentTemplateVariation[]): Promise<AgentInterface> {
    // 기존 템플릿을 기반으로 변형된 에이전트 생성
    const variatedConfig = { ...baseTemplate.config };
    
    for (const variation of variations) {
      variatedConfig[variation.property] = variation.value;
    }
    
    // 변형의 일관성 검증
    const isConsistent = this.validateConfigConsistency(variatedConfig);
    if (!isConsistent) {
      throw new Error('Template variation resulted in inconsistent configuration');
    }
    
    return this.createAgent(variatedConfig);
  }

  private combineConfigs(configs: AgentConfig[]): AgentConfig {
    // 지능적인 설정 조합 로직
    const combined: AgentConfig = {
      name: 'combined-agent',
      aiProviders: [this.selectBestProvider(configs)],
      defaultModel: {
        provider: this.selectBestProvider(configs).name,
        model: this.selectBestModel(configs),
        temperature: this.averageTemperature(configs),
        maxTokens: Math.max(...configs.map(c => c.defaultModel?.maxTokens || 1000)),
        systemMessage: this.combineSytemMessages(configs)
      },
      tools: this.combineTools(configs)
    };
    
    return combined;
  }

  private combineSytemMessages(configs: AgentConfig[]): string {
    const messages = configs.map(c => c.defaultModel?.systemMessage).filter(Boolean);
    
    // LLM을 사용해 시스템 메시지들을 지능적으로 결합
    return `You are an AI agent combining the expertise of multiple specialists:
    
${messages.map((msg, i) => `Expertise ${i + 1}: ${msg}`).join('\n\n')}

Integrate these capabilities thoughtfully to provide comprehensive assistance.`;
  }
}
```

## 3. 독립성 보장 전략

### 3.1 인터페이스 분리

```typescript
// AgentFactory 공개 인터페이스 (Provider 불가지론 준수)
interface AgentFactoryInterface {
  // 기본 생성 메서드 (Planning 시스템과 무관)
  createAgent(config: AgentConfig): Promise<AgentInterface>;
  createFromTemplate(templateId: string, overrides?: Partial<AgentConfig>): Promise<AgentInterface>;
  
  // 확장 메서드 (Planning 시스템 지원)
  createWithConditions(conditions: AgentCreationConditions): Promise<AgentInterface>;
  createFromPrompt(prompt: string, context?: PlanningExecutionContext): Promise<AgentInterface>;
  createBatch(specs: AgentCreationSpec[]): Promise<AgentInterface[]>;
  
  // 템플릿 관리 (독립적)
  registerTemplate(template: AgentTemplate): void;
  findTemplates(criteria: AgentTemplateCriteria): AgentTemplate[];
  
  // 메타 기능 (선택적)
  analyze(): Promise<AgentFactoryAnalysis>;
  optimize(): Promise<AgentFactoryOptimizationReport>;
}

// 에이전트 템플릿 검색 조건
type AgentTemplateCriteria = Record<string, string | number | boolean>;

// Factory 분석 결과 타입
type AgentFactoryAnalysis = Record<string, string | number | boolean | Date>;

// Factory 최적화 보고서 타입
type AgentFactoryOptimizationReport = Record<string, string | number | boolean | Date>;

// Planning 시스템은 AgentFactory를 사용하지만 제어하지 않음
class CAMELPlanner {
  constructor(private agentFactory: AgentFactoryInterface) {
    // AgentFactory의 기능을 활용하지만 내부 구현에 의존하지 않음
  }
  
  async execute(task: string): Promise<any> {
    // AgentFactory의 공개 인터페이스만 사용
    const team = await this.agentFactory.createBatch([
      { templateId: 'researcher', role: 'research' },
      { templateId: 'writer', role: 'writing' },
      { templateId: 'reviewer', role: 'review' }
    ]);
    
    return this.orchestrateTeam(team, task);
  }
}
```

### 3.2 확장 포인트 설계

```typescript
// 확장 가능한 플러그인 시스템
interface AgentFactoryPlugin {
  name: string;
  version: string;
  
  // 생명주기 훅
  beforeCreate?(config: AgentConfig): Promise<AgentConfig>;
  afterCreate?(agent: AgentInterface): Promise<AgentInterface>;
  
  // 기능 확장
  customCreationMethods?: Record<string, Function>;
  templateTransformers?: TemplateTransformer[];
  optimizationStrategies?: OptimizationStrategy[];
}

class AgentFactory {
  private plugins: AgentFactoryPlugin[] = [];

  registerPlugin(plugin: AgentFactoryPlugin): void {
    // 플러그인 검증
    this.validatePlugin(plugin);
    
    // 플러그인 등록
    this.plugins.push(plugin);
    
    // 커스텀 메서드 등록
    if (plugin.customCreationMethods) {
      Object.entries(plugin.customCreationMethods).forEach(([name, method]) => {
        (this as any)[name] = method.bind(this);
      });
    }
  }

  async createAgent(config: AgentConfig): Promise<AgentInterface> {
    let processedConfig = config;
    
    // 플러그인의 beforeCreate 훅 실행
    for (const plugin of this.plugins) {
      if (plugin.beforeCreate) {
        processedConfig = await plugin.beforeCreate(processedConfig);
      }
    }
    
    // 에이전트 생성
    let agent = await this.doCreateAgent(processedConfig);
    
    // 플러그인의 afterCreate 훅 실행
    for (const plugin of this.plugins) {
      if (plugin.afterCreate) {
        agent = await plugin.afterCreate(agent);
      }
    }
    
    return agent;
  }
}

// Planning 전용 플러그인 예시
class PlanningEnhancementPlugin implements AgentFactoryPlugin {
  name = 'planning-enhancement';
  version = '1.0.0';

  async beforeCreate(config: AgentConfig): Promise<AgentConfig> {
    // Planning 컨텍스트에서 추가 최적화
    if (config.planningContext) {
      return this.optimizeForPlanning(config);
    }
    return config;
  }

  customCreationMethods = {
    createForCAMEL: this.createForCAMEL.bind(this),
    createForReAct: this.createForReAct.bind(this)
  };

  private createForCAMEL(role: string, expertise: string[]): Promise<AgentInterface> {
    // CAMEL 전용 최적화된 생성 로직
    const conditions: AgentCreationConditions = {
      role,
      expertise,
      collaborationStyle: 'cooperative',
      qualityLevel: 'standard'
    };
    
    return this.createWithConditions(conditions);
  }
}
```

## 4. 권한과 책임 위임

### 4.1 에이전트 생명주기 관리

```typescript
// AgentFactory가 에이전트의 전체 생명주기를 책임
class AgentFactory {
  private activeAgents: Map<string, AgentInterface> = new Map();
  private agentMetrics: Map<string, AgentMetrics> = new Map();

  async createAgent(config: AgentConfig): Promise<AgentInterface> {
    // 1. 에이전트 생성
    const agent = await this.doCreateAgent(config);
    
    // 2. 생명주기 관리 설정
    const managedAgent = this.wrapWithLifecycleManagement(agent);
    
    // 3. 등록 및 추적
    this.registerAgent(managedAgent);
    
    return managedAgent;
  }

  private wrapWithLifecycleManagement(agent: AgentInterface): AgentInterface {
    const agentId = this.generateAgentId();
    
    return new Proxy(agent, {
      get: (target, prop) => {
        // 메서드 호출 추적
        if (typeof target[prop] === 'function') {
          return (...args: any[]) => {
            // 사용량 추적
            this.trackUsage(agentId, prop as string);
            
            // 실제 메서드 실행
            const result = target[prop](...args);
            
            // 성능 메트릭 수집
            if (result instanceof Promise) {
              return result.then(res => {
                this.recordPerformance(agentId, prop as string, 'success');
                return res;
              }).catch(err => {
                this.recordPerformance(agentId, prop as string, 'error');
                throw err;
              });
            }
            
            return result;
          };
        }
        
        return target[prop];
      }
    });
  }

  // 에이전트 상태 모니터링
  getAgentStatus(agentId: string): AgentStatus {
    const agent = this.activeAgents.get(agentId);
    const metrics = this.agentMetrics.get(agentId);
    
    if (!agent || !metrics) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    return {
      id: agentId,
      status: this.determineAgentStatus(agent, metrics),
      performance: this.calculatePerformanceScore(metrics),
      resourceUsage: this.getResourceUsage(agentId),
      lastActivity: metrics.lastActivity
    };
  }

  // 에이전트 최적화
  async optimizeAgent(agentId: string): Promise<void> {
    const agent = this.activeAgents.get(agentId);
    const metrics = this.agentMetrics.get(agentId);
    
    if (!agent || !metrics) return;
    
    // 사용 패턴 분석
    const usagePattern = this.analyzeUsagePattern(metrics);
    
    // 최적화 적용
    if (usagePattern.toolUsageOptimizable) {
      await this.optimizeAgentTools(agent, usagePattern);
    }
    
    if (usagePattern.memoryOptimizable) {
      this.optimizeAgentMemory(agent);
    }
    
    if (usagePattern.configOptimizable) {
      await this.optimizeAgentConfig(agent, usagePattern);
    }
  }

  // 에이전트 정리
  async disposeAgent(agentId: string): Promise<void> {
    const agent = this.activeAgents.get(agentId);
    
    if (agent) {
      // 리소스 정리
      await this.cleanupAgentResources(agent);
      
      // 등록 해제
      this.activeAgents.delete(agentId);
      
      // 메트릭 아카이브
      const metrics = this.agentMetrics.get(agentId);
      if (metrics) {
        await this.archiveMetrics(agentId, metrics);
        this.agentMetrics.delete(agentId);
      }
    }
  }
}
```

### 4.2 리소스 관리 권한

```typescript
// AgentFactory가 시스템 리소스를 총괄 관리
class AgentFactory {
  private resourceManager: ResourceManager;
  private concurrencyLimiter: ConcurrencyLimiter;

  constructor(options: AgentFactoryOptions) {
    this.resourceManager = new ResourceManager(options.resourceLimits);
    this.concurrencyLimiter = new ConcurrencyLimiter(options.concurrencyLimits);
  }

  async createAgent(config: AgentConfig): Promise<AgentInterface> {
    // 1. 리소스 가용성 확인
    const resourceCheck = await this.resourceManager.checkAvailability(config);
    if (!resourceCheck.available) {
      throw new ResourceExhaustionError(resourceCheck.reason);
    }
    
    // 2. 동시성 제한 확인
    await this.concurrencyLimiter.acquire();
    
    try {
      // 3. 리소스 예약
      const reservation = await this.resourceManager.reserve(config);
      
      // 4. 에이전트 생성
      const agent = await this.doCreateAgent(config);
      
      // 5. 리소스 할당 완료
      this.resourceManager.commit(reservation, agent);
      
      return agent;
      
    } catch (error) {
      // 실패시 리소스 해제
      this.concurrencyLimiter.release();
      throw error;
    }
  }

  // 시스템 전체 리소스 상태
  getSystemResourceStatus(): SystemResourceStatus {
    return {
      memory: this.resourceManager.getMemoryUsage(),
      tokens: this.resourceManager.getTokenUsage(),
      activeAgents: this.activeAgents.size,
      maxConcurrency: this.concurrencyLimiter.getLimit(),
      availableConcurrency: this.concurrencyLimiter.getAvailable()
    };
  }

  // 자동 리소스 최적화
  async autoOptimizeResources(): Promise<OptimizationResult> {
    const status = this.getSystemResourceStatus();
    const optimizations: ResourceOptimization[] = [];
    
    // 메모리 사용량이 높은 경우
    if (status.memory.usagePercentage > 80) {
      const memoryOpt = await this.optimizeMemoryUsage();
      optimizations.push(memoryOpt);
    }
    
    // 토큰 사용량이 제한에 근접한 경우
    if (status.tokens.remainingPercentage < 20) {
      const tokenOpt = await this.optimizeTokenUsage();
      optimizations.push(tokenOpt);
    }
    
    // 동시성 제한에 근접한 경우
    if (status.availableConcurrency < 2) {
      const concurrencyOpt = await this.optimizeConcurrency();
      optimizations.push(concurrencyOpt);
    }
    
    return {
      optimizations,
      newStatus: this.getSystemResourceStatus(),
      improvementMetrics: this.calculateImprovement(status)
    };
  }
}

class ResourceManager {
  private memoryTracker: MemoryTracker;
  private tokenTracker: TokenTracker;

  async checkAvailability(config: AgentConfig): Promise<ResourceAvailability> {
    const estimatedMemory = this.estimateMemoryUsage(config);
    const estimatedTokens = this.estimateTokenUsage(config);
    
    return {
      available: this.hasEnoughMemory(estimatedMemory) && 
                this.hasEnoughTokens(estimatedTokens),
      estimatedUsage: { memory: estimatedMemory, tokens: estimatedTokens },
      reason: this.getUnavailabilityReason(estimatedMemory, estimatedTokens)
    };
  }

  async reserve(config: AgentConfig): Promise<ResourceReservation> {
    const reservation = {
      id: this.generateReservationId(),
      memory: this.estimateMemoryUsage(config),
      tokens: this.estimateTokenUsage(config),
      timestamp: Date.now()
    };
    
    // 리소스 예약 처리
    this.memoryTracker.reserve(reservation.memory);
    this.tokenTracker.reserve(reservation.tokens);
    
    return reservation;
  }

  commit(reservation: ResourceReservation, agent: AgentInterface): void {
    // 예약을 실제 사용으로 전환
    this.memoryTracker.commit(reservation.id, agent);
    this.tokenTracker.commit(reservation.id, agent);
  }
}
```

## 5. 실제 사용 시나리오

### 5.1 Planning 시스템과의 통합

```typescript
// Planning 시스템에서 AgentFactory 활용
import { AgentFactory } from '@robota-sdk/agents';
import { CAMELPlanner } from '@robota-sdk/planning-camel';

// 1. 기본 AgentFactory 설정 (Provider 불가지론 준수)
const agentFactory = new AgentFactory({
  // 동적 Provider 등록 (런타임에 결정)
  aiProviders: {
    'primary': primaryProvider,     // BaseAIProvider 구현체
    'secondary': secondaryProvider  // BaseAIProvider 구현체
  },
  currentProvider: 'primary',
  
  // 도구 관리 전략
  toolManagementStrategy: {
    commonTools: ['web_search', 'calculator', 'file_manager'],
    autoInjectCommonTools: true,
    toolGroups: {
      'research': ['academic_db', 'citation_manager'],
      'writing': ['grammar_checker', 'style_guide'],
      'analysis': ['statistical_analyzer', 'visualizer']
    }
  },
  
  // 성능 모니터링
  enableMetrics: true,
  autoOptimization: true
});

// 2. Planning 전용 플러그인 등록
agentFactory.registerPlugin(new PlanningEnhancementPlugin());

// 3. CAMEL Planner 생성 (AgentFactory 주입)
const camelPlanner = new CAMELPlanner(agentFactory, {
  maxAgents: 5,
  roleBasedToolMapping: true
});

// 4. 독립적 사용 (Planning 없이도 동작)
const independentAgent = await agentFactory.createWithConditions({
  role: 'data_scientist',
  expertise: ['machine_learning', 'statistics'],
  qualityLevel: 'premium'
});

// 5. Planning 통합 사용
const planningResult = await camelPlanner.execute("AI 윤리 가이드라인 연구");
```

### 5.2 점진적 확장 시나리오

```typescript
// 1단계: 기존 사용자 (변경 없음)
const basicFactory = new AgentFactory();
const basicAgent = await basicFactory.createFromTemplate('researcher');

// 2단계: 새로운 기능 활용
const enhancedFactory = new AgentFactory({
  enableAdvancedFeatures: true,
  aiProviders: {
    'default': defaultProvider
  },
  currentProvider: 'default'
});
const conditionalAgent = await enhancedFactory.createWithConditions({
  role: 'analyst',
  taskType: 'analysis'
});

// 3단계: 완전한 Planning 통합
const planningFactory = new AgentFactory({
  enableAdvancedFeatures: true,
  aiProviders: {
    'primary': primaryProvider,
    'secondary': secondaryProvider
  },
  currentProvider: 'primary',
  toolManagementStrategy: {
    commonTools: ['web_search', 'calculator'],
    autoInjectCommonTools: true
  },
  enableMetrics: true
});

const planning = new ReActPlanner(planningFactory);
const planningResult = await planning.execute("복잡한 문제 해결");
```

## 결론

AgentFactory는 Planning 시스템의 핵심 엔진으로서, 독립성을 유지하면서도 강력한 확장성을 제공합니다:

### 🎯 핵심 가치
- **독립적 운영**: Planning 없이도 완전한 기능 제공
- **권한 위임**: 에이전트 생성의 모든 권한과 책임 보유
- **확장성**: 새로운 요구사항에 유연하게 대응
- **호환성**: 기존 사용자 코드 변경 최소화

### 🚀 향후 발전 방향
1. **AI 기반 최적화**: LLM을 활용한 자동 설정 최적화
2. **예측적 생성**: 사용 패턴 학습을 통한 예측적 에이전트 생성
3. **분산 처리**: 클러스터 환경에서의 분산 에이전트 관리
4. **실시간 적응**: 실행 중 동적 설정 변경 및 최적화

## 📚 관련 문서

### 코어 시스템
- [Planning System Overview](./planning-overview.md) - 전체 시스템 개요
- [Planning Container](./planning-container.md) - 플래너 통합 관리

### 플래너별 문서
- [CAMEL Planner](../planners/camel-planner.md) - 역할 기반 협업
- [ReAct Planner](../planners/react-planner.md) - 추론+행동 반복
- [Reflection Planner](../planners/reflection-planner.md) - 품질 개선 중심
- [Sequential Planner](../planners/sequential-planner.md) - 단계별 처리

### 도구 관리
- [도구 아키텍처](../tool-management/tool-architecture.md) - 도구 관리 전략
- [도구 구현](../tool-management/tool-implementation.md) - 구체적 구현 방법

### 구현 가이드
- [구현 로드맵](../implementation/implementation-roadmap.md) - 개발 계획
- [마이그레이션 가이드](../implementation/migration-guide.md) - Team → Planning 전환
- [사용 예제](../implementation/usage-examples.md) - 실제 사용 사례 