# 구체적 분리 예시

## 현재 Robota에서 실제 Module이 될 수 있는 것들

### ⚠️ 중요: Module 조건
1. **선택적 확장**: 없어도 Robota가 기본 텍스트 대화를 정상적으로 할 수 있어야 함
2. **LLM 한계**: LLM이 직접 할 수 없는 일이어야 함 (파일 처리, 네트워크 접근, 실시간 데이터 등)

### 1. 실제로 필요한 Module들 (LLM이 할 수 없는 선택적 확장 기능)

**우선순위 1: 즉시 필요한 핵심 Module들**

```typescript
// 1. RAG Module - 가장 중요하고 실용적
interface RAGModule extends BaseModule {
    addDocument(id: string, content: string, metadata?: any): Promise<void>;
    searchRelevant(query: string, topK?: number): Promise<string[]>;
    generateWithContext(query: string): Promise<string>;
    
    readonly name = 'rag';
    readonly version = '1.0.0';
}

// 2. File Processing Module - 실용적이고 자주 사용됨
interface FileProcessingModule extends BaseModule {
    processPDF(buffer: Buffer): Promise<string>;
    processImage(buffer: Buffer): Promise<string>;
    processText(buffer: Buffer, encoding?: string): Promise<string>;
    
    readonly name = 'file-processing';
    readonly version = '1.0.0';
}

// 3. Speech Processing Module - 멀티모달 지원
interface SpeechModule extends BaseModule {
    speechToText(audio: Buffer): Promise<string>;
    textToSpeech(text: string): Promise<Buffer>;
    
    readonly name = 'speech';
    readonly version = '1.0.0';
}
```

**우선순위 2: 유용하지만 나중에 구현해도 되는 Module들**

```typescript
// 4. Web Scraping Module
interface WebScrapingModule extends BaseModule {
    scrapeURL(url: string): Promise<string>;
    extractLinks(url: string): Promise<string[]>;
    
    readonly name = 'web-scraping';
    readonly version = '1.0.0';
}

// 5. Database Module
interface DatabaseModule extends BaseModule {
    query(sql: string, params?: any[]): Promise<any[]>;
    execute(sql: string, params?: any[]): Promise<void>;
    
    readonly name = 'database';
    readonly version = '1.0.0';
}
```

**❌ 제거할 Module들 (불필요하거나 너무 복잡함)**

```typescript
// ❌ 제거: 너무 복잡하고 실용성 낮음
// - MultiModalModule (너무 범용적, 구체적인 용도별로 분리)
// - APIIntegrationModule (너무 범용적, Tool로 충분)
// - VectorStorageModule (RAG Module에 포함)
// - CacheStorageModule (내부 구현으로 충분)
// - TransportModule (내부 구현으로 충분)

// ❌ 제거: LLM이 이미 잘 하는 일들
// - ReasoningModule
// - PlanningModule  
// - LearningModule
// - MemoryModule (ConversationHistory Plugin으로 충분)
// - KnowledgeModule
```

#### ❌ Module이 될 수 없는 것들 (LLM이 이미 잘 하는 일들)

```typescript
// ✅ 대신 이런 것들이 진짜 Module이 되어야 함:
// - RAG: LLM이 실시간 문서 검색 불가
// - File Processing: LLM이 파일 파싱 불가  
// - Database: LLM이 실시간 DB 접근 불가
// - API Integration: LLM이 외부 API 호출 불가
// - Speech Processing: LLM이 오디오 처리 불가
```

#### Storage Modules - 다양한 저장소 구현체 (선택적 확장)

```typescript
// 벡터 저장소 모듈 (RAG를 위한 선택적 확장)
interface VectorStorageModule extends BaseModule {
    connect(config: VectorStorageConfig): Promise<void>;
    store(id: string, vector: number[], metadata?: any): Promise<void>;
    search(query: number[], topK: number): Promise<SearchResult[]>;
    delete(id: string): Promise<boolean>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'vector-storage',
            category: ModuleCategory.FOUNDATION,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['transport'],
            capabilities: ['vector-indexing', 'similarity-search', 'metadata-filtering']
        };
    }
}

// 파일 저장소 모듈 (로컬/클라우드 파일 시스템 접근)
interface FileStorageModule extends BaseModule {
    saveFile(path: string, content: Buffer): Promise<void>;
    loadFile(path: string): Promise<Buffer>;
    listFiles(directory: string): Promise<string[]>;
    deleteFile(path: string): Promise<boolean>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'file-storage',
            category: ModuleCategory.FOUNDATION,
            layer: ModuleLayer.APPLICATION,
            dependencies: [],
            capabilities: ['file-persistence', 'directory-management', 'cloud-sync']
        };
    }
}

// 캐시 저장소 모듈 (Redis, Memcached 등)
interface CacheStorageModule extends BaseModule {
    set(key: string, value: any, ttl?: number): Promise<void>;
    get(key: string): Promise<any>;
    delete(key: string): Promise<boolean>;
    clear(): Promise<void>;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'cache-storage',
            category: ModuleCategory.FOUNDATION,
            layer: ModuleLayer.APPLICATION,
            dependencies: ['transport'],
            capabilities: ['memory-caching', 'ttl-management', 'distributed-cache']
        };
    }
}
```

### 2. ❌ Module이 될 수 없는 것들 정리

#### 필수 구성요소들 (내부 핵심 클래스로 유지)
```typescript
// ❌ 이런 것들은 Module 불가 - 없으면 Robota가 동작하지 않음

// AI Provider - 대화 자체가 불가능
interface AIProvider {
    generateResponse(messages: Message[]): Promise<string>;
    generateStream(messages: Message[]): AsyncIterable<string>;
}

// Tool Execution - 함수 호출 로직이 깨짐
interface ToolExecutor {
    executeFunction(name: string, params: any): Promise<any>;
    registerTool(tool: Tool): void;
}

// Message Processing - 메시지 변환이 안됨  
interface MessageProcessor {
    formatMessages(messages: Message[]): string;
    parseResponse(response: string): Message;
}

// Session Management - 세션 관리가 안됨
interface SessionManager {
    createSession(id: string): Session;
    getSession(id: string): Session | null;
}
```

#### LLM이 이미 잘 하는 일들 (불필요한 Module)
```typescript
// ❌ 이런 것들은 Module로 만들 필요 없음 - LLM이 이미 잘 함

// Reasoning - LLM이 추론을 매우 잘 함
// Planning - LLM이 계획 수립을 잘 함  
// Learning - LLM이 맥락에서 학습함
// Perception - LLM이 텍스트 이해를 잘 함
// Memory - LLM이 대화 맥락을 기억함
// Knowledge - LLM이 광범위한 지식을 가짐
// Conversation - LLM이 대화를 매우 잘 함
// Analysis - LLM이 분석을 잘 함
```

### 3. ❌ 잘못된 설계 예시 (AI Provider를 Module로 만드는 경우)

#### 왜 AI Provider는 Module이 될 수 없는가

```typescript
// ❌ 잘못된 접근: AI Provider를 Module로 만들기
// 문제점: AI Provider 없이는 Robota가 기본 대화도 할 수 없음

interface ConversationModule extends BaseModule {
    // 이런 식으로 만들면 안됨
    generateResponse(messages: Message[]): Promise<string>;
    generateStream(messages: Message[]): AsyncIterable<string>;
    // 이미 LLM이 잘 하는 일들을 중복 구현
    maintainPersonality(persona: Persona): void;
    adaptToContext(context: Context): Promise<void>;
    detectEmotions(messages: Message[]): Promise<Emotion[]>;
}

// ✅ 올바른 접근: AI Provider는 내부 핵심 클래스로 유지
interface AIProvider {
    generateResponse(messages: Message[]): Promise<string>;
    generateStream(messages: Message[]): AsyncIterable<string>;
}

// 실제 구현
export class OpenAIProvider implements AIProvider {
    constructor(private config: OpenAIConfig) {}
    
    async generateResponse(messages: Message[]): Promise<string> {
        // OpenAI API 호출 로직
        return await this.client.chat.completions.create({
            model: this.config.model,
            messages: messages
        });
    }
}

// Robota에서 사용 (Module이 아닌 내부 클래스로)
const agent = new RobotaBuilder()
    .setAIProvider(new OpenAIProvider(config)) // ← 필수 구성요소
    .addModule(new RAGModule())                // ← 선택적 확장
    .addPlugin(new LoggingPlugin())            // ← 관찰/보강
    .build();
```

## 4. Plugin으로 유지되는 항목들 (Cross-cutting Concerns)

#### ✅ 이미 올바르게 구현된 Plugin들 (선택적이고 관찰/보강 기능)  

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