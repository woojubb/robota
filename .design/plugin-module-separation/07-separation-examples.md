# 구체적 분리 예시

## 현재 Robota에서 Module이 될 수 있는 것들

### 1. 새로운 Module 영역들

#### Vector Search Modules - RAG를 위한 검색 능력 (LLM이 할 수 없는 일)

```typescript
// 벡터 검색 모듈 (RAG용)
interface VectorSearchModule extends BaseModule {
    addDocument(id: string, text: string, metadata?: any): Promise<void>;
    search(query: string, topK: number): Promise<SearchResult[]>;
    embed(text: string): Promise<number[]>;
    deleteDocument(id: string): Promise<boolean>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'vector-search',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['embedding-provider', 'vector-storage'],
            capabilities: ['rag-retrieval', 'semantic-search', 'document-indexing']
        };
    }
}

// 파일 처리 모듈 (LLM이 할 수 없는 일)
interface FileProcessingModule extends BaseModule {
    processPDF(buffer: Buffer): Promise<string>;
    processImage(buffer: Buffer): Promise<string>;
    processAudio(buffer: Buffer): Promise<string>;
    extractMetadata(buffer: Buffer, type: string): Promise<any>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'file-processing',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['ocr-engine', 'audio-transcription'],
            capabilities: ['pdf-extraction', 'image-to-text', 'audio-to-text']
        };
    }
}

// 멀티모달 AI 모듈 (LLM이 할 수 없는 일)
interface MultiModalModule extends BaseModule {
    analyzeImageWithText(image: Buffer, prompt: string): Promise<string>;
    generateImageDescription(image: Buffer): Promise<string>;
    compareImages(image1: Buffer, image2: Buffer): Promise<number>;
    extractTextFromImage(image: Buffer): Promise<string>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'multimodal',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['vision-ai-provider', 'file-processing'],
            capabilities: ['visual-analysis', 'image-text-integration', 'ocr']
        };
    }
}
```

#### Tool Execution Modules - 에이전트의 도구 실행 능력

```typescript
// 함수 도구 모듈 (현재 도구 시스템 확장)
interface FunctionToolModule extends BaseModule {
    registerFunction(schema: ZodSchema, handler: Function): void;
    executeFunction(name: string, params: any): Promise<any>;
    validateParameters(name: string, params: any): boolean;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'function-tool',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['schema-validator'],
            capabilities: ['function-execution', 'parameter-validation', 'schema-management']
        };
    }
}

// API 도구 모듈
interface APIToolModule extends BaseModule {
    registerAPI(spec: OpenAPISpec): void;
    callAPI(endpoint: string, params: any): Promise<any>;
    generateClient(spec: OpenAPISpec): APIClient;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'api-tool',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['http-client', 'schema-parser'],
            capabilities: ['api-integration', 'client-generation', 'endpoint-management']
        };
    }
}

// MCP 도구 모듈
interface MCPToolModule extends BaseModule {
    connectToServer(serverUrl: string): Promise<void>;
    listRemoteTools(): Promise<Tool[]>;
    executeRemoteTool(toolId: string, params: any): Promise<any>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'mcp-tool',
            category: ModuleCategory.INTEGRATION,
            layer: ModuleLayer.PLATFORM,
            dependencies: ['mcp-protocol', 'remote-communication'],
            capabilities: ['remote-tool-execution', 'mcp-integration', 'distributed-computing']
        };
    }
}
```

#### Reasoning Modules - 에이전트의 추론 능력

```typescript
// 논리적 추론 모듈
interface LogicalReasoningModule extends BaseModule {
    inferFromFacts(facts: string[]): Promise<string[]>;
    validateLogic(statement: string): Promise<boolean>;
    explainReasoning(conclusion: string): Promise<string>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'logical-reasoning',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.DOMAIN,
            dependencies: ['knowledge-base', 'inference-engine'],
            capabilities: ['logical-inference', 'proof-generation', 'consistency-checking']
        };
    }
}

// 확률적 추론 모듈
interface ProbabilisticReasoningModule extends BaseModule {
    estimateProbability(event: string, evidence: any[]): Promise<number>;
    updateBelief(evidence: any): Promise<void>;
    getMostLikely(alternatives: string[]): Promise<string>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'probabilistic-reasoning',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.DOMAIN,
            dependencies: ['bayesian-network', 'statistical-engine'],
            capabilities: ['probability-estimation', 'belief-updating', 'uncertainty-handling']
        };
    }
}

// 인과관계 추론 모듈
interface CausalReasoningModule extends BaseModule {
    identifyCauses(effect: string, context: any): Promise<string[]>;
    predictEffect(cause: string, context: any): Promise<string>;
    buildCausalGraph(observations: any[]): Promise<CausalGraph>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'causal-reasoning',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.DOMAIN,
            dependencies: ['graph-analysis', 'statistical-inference'],
            capabilities: ['causal-discovery', 'effect-prediction', 'counterfactual-reasoning']
        };
    }
}
```

#### Perception Modules - 에이전트의 감지 능력

```typescript
// 텍스트 인식 모듈
interface TextPerceptionModule extends BaseModule {
    extractEntities(text: string): Promise<Entity[]>;
    detectSentiment(text: string): Promise<Sentiment>;
    classifyIntent(text: string): Promise<Intent>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'text-perception',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['nlp-processor', 'entity-recognizer'],
            capabilities: ['entity-extraction', 'sentiment-analysis', 'intent-classification']
        };
    }
}

// 이미지 인식 모듈
interface ImagePerceptionModule extends BaseModule {
    describeImage(image: Buffer): Promise<string>;
    detectObjects(image: Buffer): Promise<Object[]>;
    extractText(image: Buffer): Promise<string>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'image-perception',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['vision-processor', 'ocr-engine'],
            capabilities: ['image-description', 'object-detection', 'text-extraction']
        };
    }
}

// 컨텍스트 인식 모듈
interface ContextPerceptionModule extends BaseModule {
    analyzeContext(input: any): Promise<Context>;
    detectEmotions(input: any): Promise<Emotion[]>;
    identifyPatterns(data: any[]): Promise<Pattern[]>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'context-perception',
            category: ModuleCategory.ENHANCEMENT,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['pattern-analyzer', 'emotion-detector'],
            capabilities: ['context-analysis', 'emotion-detection', 'pattern-recognition']
        };
    }
}
```

#### Learning Modules - 에이전트의 학습 능력

```typescript
// 패턴 학습 모듈
interface PatternLearningModule extends BaseModule {
    observePattern(input: any, output: any): Promise<void>;
    suggestOptimization(task: string): Promise<Suggestion[]>;
    adaptBehavior(feedback: Feedback): Promise<void>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'pattern-learning',
            category: ModuleCategory.ENHANCEMENT,
            layer: ModuleLayer.DOMAIN,
            dependencies: ['pattern-analyzer', 'feedback-processor'],
            capabilities: ['pattern-recognition', 'behavior-adaptation', 'optimization-suggestion']
        };
    }
}

// 경험 학습 모듈
interface ExperienceLearningModule extends BaseModule {
    recordExperience(experience: Experience): Promise<void>;
    retrieveSimilarExperiences(situation: any): Promise<Experience[]>;
    improveFromFeedback(feedback: Feedback): Promise<void>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'experience-learning',
            category: ModuleCategory.ENHANCEMENT,
            layer: ModuleLayer.DOMAIN,
            dependencies: ['experience-storage', 'similarity-matcher'],
            capabilities: ['experience-recording', 'case-based-reasoning', 'feedback-learning']
        };
    }
}
```

### 2. 기존 AI Provider 시스템의 Module 방식 발전

#### 현재 vs 새로운 접근

```typescript
// 현재는 단순한 Provider 패턴
interface AIProvider {
    generateResponse(messages: Message[]): Promise<string>;
    generateStream(messages: Message[]): AsyncIterable<string>;
}

// Module 방식으로 발전 - 더 풍부한 능력 제공
interface ConversationModule extends BaseModule {
    // 기본 대화 능력
    generateResponse(messages: Message[]): Promise<string>;
    generateStream(messages: Message[]): AsyncIterable<string>;
    
    // 확장된 대화 능력
    maintainPersonality(persona: Persona): void;
    adaptToContext(context: Context): Promise<void>;
    learnFromFeedback(feedback: Feedback): Promise<void>;
    
    // 고급 대화 기능
    detectEmotions(messages: Message[]): Promise<Emotion[]>;
    suggestFollowups(conversation: Message[]): Promise<string[]>;
    evaluateResponseQuality(response: string): Promise<QualityMetrics>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'conversation',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['ai-provider', 'personality-engine', 'emotion-detector'],
            capabilities: ['advanced-conversation', 'personality-adaptation', 'emotional-intelligence']
        };
    }
}

// 구체적 구현 예시
export class OpenAIConversationModule extends BaseModule implements ConversationModule {
    readonly name = 'openai-conversation';
    readonly version = '2.0.0';
    readonly dependencies = ['openai-provider', 'personality-engine'];
    
    private personality?: Persona;
    private context?: Context;
    
    async generateResponse(messages: Message[]): Promise<string> {
        // 개성과 컨텍스트를 반영한 응답 생성
        const enhancedMessages = await this.enhanceMessages(messages);
        return await this.provider.generateResponse(enhancedMessages);
    }
    
    async maintainPersonality(persona: Persona): void {
        this.personality = persona;
        await this.updateSystemPrompt();
    }
    
    async adaptToContext(context: Context): Promise<void> {
        this.context = context;
        await this.adjustResponseStyle(context);
    }
    
    async detectEmotions(messages: Message[]): Promise<Emotion[]> {
        const emotionModule = this.getModule<EmotionDetectionModule>('emotion-detection');
        return await emotionModule.analyzeConversation(messages);
    }
}
```

## Plugin으로 유지되는 항목들 (Cross-cutting Concerns)

### 1. Monitoring & Analytics Plugins  

```typescript
// 사용량 추적 플러그인 - 에이전트 실행 통계 관찰
export class UsagePlugin extends BasePlugin {
    readonly name = 'usage-tracking';
    readonly category = PluginCategory.MONITORING;
    readonly priority = 100;
    
    private metrics = {
        totalRequests: 0,
        totalTokens: 0,
        totalCost: 0,
        averageResponseTime: 0
    };
    
    async beforeRun(input: string): Promise<void> { 
        this.metrics.startTime = Date.now();
        this.metrics.totalRequests++;
    }
    
    async afterRun(input: string, output: string): Promise<void> { 
        const duration = Date.now() - this.metrics.startTime;
        this.metrics.averageResponseTime = (this.metrics.averageResponseTime + duration) / 2;
        this.metrics.totalTokens += this.countTokens(input, output);
        this.metrics.totalCost += this.calculateCost(this.metrics.totalTokens);
    }
    
    getStats(): UsageStats {
        return { ...this.metrics };
    }
}

// 성능 모니터링 플러그인 - 시스템 성능 지표 관찰
export class PerformancePlugin extends BasePlugin {
    readonly name = 'performance-monitoring';
    readonly category = PluginCategory.MONITORING;
    readonly priority = 95;
    
    private performanceData: PerformanceEntry[] = [];
    
    async beforeExecution(): Promise<void> { 
        this.mark('execution-start');
        this.recordMemoryUsage('before');
    }
    
    async afterExecution(): Promise<void> { 
        this.mark('execution-end');
        this.recordMemoryUsage('after');
        this.measure('total-execution-time', 'execution-start', 'execution-end');
    }
    
    getStats(): PerformanceStats {
        return {
            averageExecutionTime: this.calculateAverage('total-execution-time'),
            memoryUsage: this.getMemoryStats(),
            cpuUsage: this.getCPUStats()
        };
    }
}

// 실행 분석 플러그인 - 에이전트 행동 패턴 분석
export class ExecutionAnalyticsPlugin extends BasePlugin {
    readonly name = 'execution-analytics';
    readonly category = PluginCategory.MONITORING;
    readonly priority = 90;
    
    private executionPatterns: ExecutionPattern[] = [];
    
    async afterToolCall(tool: string, params: any, result: any): Promise<void> { 
        this.recordToolUsage(tool, params, result);
        await this.analyzeExecutionPattern();
    }
    
    async onError(error: Error): Promise<void> { 
        this.recordErrorPattern(error);
        await this.suggestImprovements();
    }
    
    getInsights(): AnalyticsInsights {
        return {
            mostUsedTools: this.getMostUsedTools(),
            commonErrorPatterns: this.getCommonErrors(),
            optimizationSuggestions: this.generateOptimizations()
        };
    }
}
```

### 2. System Enhancement Plugins

```typescript
// 에러 핸들링 플러그인 - 에러 처리 및 복구 전략
export class ErrorHandlingPlugin extends BasePlugin {
    readonly name = 'error-handling';
    readonly category = PluginCategory.LOGGING;
    readonly priority = 100; // 높은 우선순위
    
    private retryStrategies = new Map<string, RetryStrategy>();
    private errorPatterns: ErrorPattern[] = [];
    
    async onError(error: Error, context?: any): Promise<void> {
        // 1. 에러 분류 및 기록
        const errorType = this.classifyError(error);
        this.recordError(errorType, error, context);
        
        // 2. 복구 전략 실행
        const strategy = this.retryStrategies.get(errorType);
        if (strategy && strategy.shouldRetry(error)) {
            await this.executeRetryStrategy(strategy, context);
        }
        
        // 3. 폴백 메커니즘
        if (!strategy || !strategy.canRecover(error)) {
            await this.executeFallbackStrategy(error, context);
        }
    }
    
    private async executeRetryStrategy(strategy: RetryStrategy, context: any): Promise<void> {
        // 지수 백오프, 회로 차단기 등의 재시도 로직
    }
    
    private async executeFallbackStrategy(error: Error, context: any): Promise<void> {
        // 대체 AI Provider 사용, 캐시된 응답 반환 등
    }
}

// 제한 관리 플러그인 - 사용량 제한 및 보안
export class LimitsPlugin extends BasePlugin {
    readonly name = 'limits';
    readonly category = PluginCategory.SECURITY;
    readonly priority = 110; // 가장 높은 우선순위
    
    private limits = {
        requestsPerMinute: 60,
        tokensPerDay: 10000,
        costPerMonth: 100
    };
    
    private usage = {
        requestsThisMinute: 0,
        tokensToday: 0,
        costThisMonth: 0
    };
    
    async beforeRun(input: string): Promise<void> {
        // 1. 요청 빈도 검사
        if (this.usage.requestsThisMinute >= this.limits.requestsPerMinute) {
            throw new LimitExceedError('Rate limit exceeded');
        }
        
        // 2. 일일 토큰 제한 검사
        const estimatedTokens = this.estimateTokens(input);
        if (this.usage.tokensToday + estimatedTokens > this.limits.tokensPerDay) {
            throw new LimitExceedError('Daily token limit exceeded');
        }
        
        // 3. 월간 비용 제한 검사
        const estimatedCost = this.estimateCost(estimatedTokens);
        if (this.usage.costThisMonth + estimatedCost > this.limits.costPerMonth) {
            throw new LimitExceedError('Monthly cost limit exceeded');
        }
        
        this.usage.requestsThisMinute++;
    }
    
    async afterRun(input: string, output: string): Promise<void> {
        const actualTokens = this.countTokens(input, output);
        const actualCost = this.calculateCost(actualTokens);
        
        this.usage.tokensToday += actualTokens;
        this.usage.costThisMonth += actualCost;
    }
}

// 로깅 플러그인 - 모든 활동 로깅
export class LoggingPlugin extends BasePlugin {
    readonly name = 'logging';
    readonly category = PluginCategory.LOGGING;
    readonly priority = 85;
    
    private loggers: Map<string, Logger> = new Map();
    
    async beforeRun(input: string): Promise<void> { 
        this.log('info', 'Conversation started', { input: this.sanitizeInput(input) });
    }
    
    async afterRun(input: string, output: string): Promise<void> { 
        this.log('info', 'Conversation completed', { 
            input: this.sanitizeInput(input),
            output: this.sanitizeOutput(output),
            duration: this.getExecutionTime()
        });
    }
    
    async onError(error: Error): Promise<void> {
        this.log('error', 'Conversation failed', {
            error: error.message,
            stack: error.stack,
            context: this.getCurrentContext()
        });
    }
    
    async onToolCall(tool: string, params: any): Promise<void> {
        this.log('debug', 'Tool executed', { tool, params });
    }
    
    private log(level: LogLevel, message: string, data?: any): void {
        const logger = this.loggers.get(level) || this.defaultLogger;
        logger.log({
            timestamp: new Date().toISOString(),
            level,
            message,
            agentId: this.getAgentId(),
            sessionId: this.getSessionId(),
            data
        });
    }
}
```

### 3. Integration & Storage Plugins

```typescript
// 웹훅 플러그인 - 외부 시스템 알림
export class WebhookPlugin extends BasePlugin {
    readonly name = 'webhook';
    readonly category = PluginCategory.NOTIFICATION;
    readonly priority = 70;
    
    private webhooks: WebhookConfig[] = [];
    private retryQueue: WebhookPayload[] = [];
    
    async afterRun(input: string, output: string): Promise<void> {
        const payload = {
            event: 'conversation_completed',
            timestamp: Date.now(),
            data: { input, output },
            agentId: this.getAgentId()
        };
        
        // 조건에 따른 웹훅 발송
        const relevantWebhooks = this.webhooks.filter(webhook => 
            this.shouldTrigger(webhook, payload)
        );
        
        for (const webhook of relevantWebhooks) {
            await this.sendWebhook(webhook, payload);
        }
    }
    
    async onError(error: Error): Promise<void> {
        const payload = {
            event: 'conversation_error',
            timestamp: Date.now(),
            data: { error: error.message },
            agentId: this.getAgentId()
        };
        
        // 에러 알림 웹훅
        const errorWebhooks = this.webhooks.filter(w => w.events.includes('error'));
        for (const webhook of errorWebhooks) {
            await this.sendWebhook(webhook, payload);
        }
    }
    
    private async sendWebhook(webhook: WebhookConfig, payload: WebhookPayload): Promise<void> {
        try {
            await this.httpClient.post(webhook.url, payload, {
                headers: webhook.headers,
                timeout: webhook.timeout || 5000
            });
        } catch (error) {
            // 실패 시 재시도 큐에 추가
            this.retryQueue.push({ webhook, payload, retryCount: 0 });
        }
    }
}

// 이벤트 방출 플러그인 - 이벤트 기반 아키텍처 지원
export class EventEmitterPlugin extends BasePlugin {
    readonly name = 'event-emitter';
    readonly category = PluginCategory.NOTIFICATION;
    readonly priority = 75;
    
    private eventBus: EventEmitter = new EventEmitter();
    private subscribers: Map<string, EventHandler[]> = new Map();
    
    async beforeRun(input: string): Promise<void> {
        this.emit('conversation:started', { input, timestamp: Date.now() });
    }
    
    async afterRun(input: string, output: string): Promise<void> {
        this.emit('conversation:completed', { input, output, timestamp: Date.now() });
    }
    
    async afterToolCall(tool: string, result: any): Promise<void> {
        this.emit('tool:executed', { tool, result, timestamp: Date.now() });
    }
    
    async onModuleChange(moduleEvent: ModuleEvent): Promise<void> {
        this.emit('module:changed', moduleEvent);
    }
    
    // 외부에서 이벤트 구독 가능
    subscribe(event: string, handler: EventHandler): void {
        if (!this.subscribers.has(event)) {
            this.subscribers.set(event, []);
        }
        this.subscribers.get(event)!.push(handler);
    }
    
    private emit(event: string, data: any): void {
        // 내부 이벤트 버스에 발송
        this.eventBus.emit(event, data);
        
        // 외부 구독자들에게 발송
        const handlers = this.subscribers.get(event) || [];
        handlers.forEach(handler => {
            try {
                handler(data);
            } catch (error) {
                console.error(`Event handler failed for ${event}:`, error);
            }
        });
    }
}

// 대화 히스토리 플러그인 - 대화 내용 저장 및 관리
export class ConversationHistoryPlugin extends BasePlugin {
    readonly name = 'conversation-history';
    readonly category = PluginCategory.STORAGE;
    readonly priority = 80;
    readonly requiredModules = ['storage'];
    
    private storageModule?: BaseModule;
    private compressionEnabled = true;
    private retentionPeriod = 30 * 24 * 60 * 60 * 1000; // 30일
    
    async initialize(options: ConversationHistoryOptions): Promise<void> {
        this.compressionEnabled = options.compression ?? true;
        this.retentionPeriod = options.retentionDays ? options.retentionDays * 24 * 60 * 60 * 1000 : this.retentionPeriod;
    }
    
    async onModuleChange(moduleEvent: ModuleEvent): Promise<void> {
        if (moduleEvent.type === 'initialized' && 
            moduleEvent.module.getModuleType().type === 'storage') {
            this.storageModule = moduleEvent.module;
        }
    }
    
    async afterRun(input: string, output: string): Promise<void> {
        if (!this.storageModule) return;
        
        const conversation = {
            id: this.generateConversationId(),
            input: this.compressionEnabled ? this.compress(input) : input,
            output: this.compressionEnabled ? this.compress(output) : output,
            timestamp: Date.now(),
            agentId: this.getAgentId(),
            sessionId: this.getSessionId()
        };
        
        try {
            await this.saveConversation(conversation);
            await this.cleanupOldConversations();
        } catch (error) {
            console.error('Failed to save conversation history:', error);
            // 저장 실패는 메인 플로우에 영향 주지 않음
        }
    }
    
    // 외부에서 히스토리 조회 가능
    async getHistory(sessionId?: string, limit: number = 50): Promise<Conversation[]> {
        if (!this.storageModule) return [];
        
        return await this.retrieveConversations(sessionId, limit);
    }
    
    private async cleanupOldConversations(): Promise<void> {
        const cutoffTime = Date.now() - this.retentionPeriod;
        await this.deleteConversationsBefore(cutoffTime);
    }
}
```

## 분류 결과 요약

### Module이 된 항목들
| 항목 | 이유 | 카테고리 | 계층 |
|------|------|----------|------|
| **Vector Search** | RAG용 임베딩 검색 | CAPABILITY | APPLICATION |
| **File Processing** | PDF/이미지/오디오 처리 | CAPABILITY | APPLICATION |
| **MultiModal** | 이미지+텍스트 AI | CAPABILITY | APPLICATION |
| **Tool Execution** | 도구 실행 능력 | CAPABILITY | APPLICATION |
| **Reasoning** | 추론 능력 제공 | CAPABILITY | DOMAIN |
| **Perception** | 감지 능력 제공 | CAPABILITY | APPLICATION |
| **Learning** | 학습 능력 제공 | ENHANCEMENT | DOMAIN |
| **AI Providers** | 대화 능력 기반 | FOUNDATION | PLATFORM |

### Plugin으로 유지되는 항목들
| 항목 | 이유 | 카테고리 | 우선순위 |
|------|------|----------|----------|
| **Usage Tracking** | 실행 통계 관찰 | MONITORING | 100 |
| **Performance** | 성능 지표 관찰 | MONITORING | 95 |
| **Error Handling** | 에러 처리 보강 | LOGGING | 100 |
| **Limits** | 보안 제어 보강 | SECURITY | 110 |
| **Logging** | 활동 기록 관찰 | LOGGING | 85 |
| **Webhook** | 외부 알림 전송 | NOTIFICATION | 70 |
| **Event Emitter** | 이벤트 전파 | NOTIFICATION | 75 |
| **Conversation History** | 대화 내용 저장 | STORAGE | 80 |

### 핵심 차이점 재확인

- **Module**: "에이전트가 무엇을 할 수 있는가?" (능력 확장)
- **Plugin**: "에이전트 실행을 어떻게 관찰/보강할 것인가?" (횡단 관심사)

이러한 분류를 통해 각 컴포넌트의 역할이 명확해지고, 개발자가 새로운 기능을 어떤 방식으로 구현할지 쉽게 결정할 수 있습니다. 