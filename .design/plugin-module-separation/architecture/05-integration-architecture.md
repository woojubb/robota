# 통합 아키텍처

## Agent Configuration

### 새로운 AgentConfig 인터페이스

```typescript
export interface AgentConfig {
    // 기존 설정
    name: string;
    aiProviders: Record<string, AIProvider>;
    currentProvider: string;
    currentModel: string;
    
    // 모듈 설정 (compile-time) - 인스턴스 배열로 주입
    modules?: BaseModule[];
    
    // 플러그인 설정 (runtime) - 기존과 동일한 인스턴스 배열
    plugins?: BasePlugin[];
    
    // 새로운 설정 옵션
    moduleInitTimeout?: number; // 모듈 초기화 타임아웃 (ms)
    enableModuleValidation?: boolean; // 모듈 유효성 검사 활성화
    pluginPriority?: 'performance' | 'feature'; // 플러그인 우선순위 정책
}

// 모듈별 설정을 위한 인터페이스
export interface ModuleConfigMap {
    [moduleName: string]: ModuleConfig;
}

// 플러그인별 설정을 위한 인터페이스
export interface PluginConfigMap {
    [pluginName: string]: BasePluginOptions;
}

// 고급 설정을 위한 인터페이스
export interface AdvancedAgentConfig extends AgentConfig {
    moduleConfigs?: ModuleConfigMap;
    pluginConfigs?: PluginConfigMap;
    
    // 성능 설정
    performance?: {
        enableLazyLoading: boolean;
        moduleInitBatchSize: number;
        pluginExecutionTimeout: number;
    };
    
    // 디버깅 설정
    debug?: {
        enableModuleTracing: boolean;
        enablePluginTracing: boolean;
        logLevel: 'debug' | 'info' | 'warn' | 'error';
    };
}
```

## Robota Agent Updates

### 새로운 Robota 클래스

```typescript
export class Robota extends BaseAgent {
    private moduleRegistry: ModuleRegistry;
    private pluginManager: PluginManager;
    private eventEmitter: EventEmitterPlugin; // ✅ 중앙 이벤트 허브
    private config: AdvancedAgentConfig;
    
    constructor(config: AdvancedAgentConfig) {
        super(config);
        this.config = config;
        
        // ✅ 중앙 EventEmitter 생성 (모든 컴포넌트가 공유)
        this.eventEmitter = new EventEmitterPlugin();
        
        // ✅ EventEmitter와 함께 매니저들 초기화 (서로 직접 참조 없음)
        this.moduleRegistry = new ModuleRegistry(this.eventEmitter);
        this.pluginManager = new PluginManager(this.eventEmitter);
        
        // ✅ Bridge 클래스 제거 - EventEmitter가 모든 통신 담당
        
        // 모듈 초기화 (EventEmitter와 함께)
        this.initializeModules(config.modules);
        
        // 플러그인 등록 (EventEmitter와 함께)
        this.registerPlugins(config.plugins);
    }
    
    // === 모듈 관리 API ===
    
    registerModule(module: BaseModule): void {
        this.moduleRegistry.registerModule(module);
    }
    
    getModule<T extends BaseModule>(moduleNameOrType: string): T | null {
        // 이름으로 먼저 찾고, 없으면 타입으로 찾기
        return this.moduleRegistry.getModule<T>(moduleNameOrType) ||
               this.moduleRegistry.getModulesByType(moduleNameOrType)[0] as T || null;
    }
    
    hasModule(moduleNameOrType: string): boolean {
        return this.getModule(moduleNameOrType) !== null;
    }
    
    getCapabilities(): string[] {
        // 모든 모듈이 제공하는 능력 목록
        const modules = this.moduleRegistry.getModulesByCategory(ModuleCategory.CAPABILITY);
        return modules.reduce((capabilities, module) => {
            const moduleCapabilities = Object.keys(module.getCapabilities());
            return [...capabilities, ...moduleCapabilities];
        }, [] as string[]);
    }
    
    listModules(): BaseModule[] {
        return Array.from(this.moduleRegistry['modules'].values());
    }
    
    // 모듈 타입별 조회 (확장된 API)
    getModulesByCategory(category: ModuleCategory): BaseModule[] {
        return this.moduleRegistry.getModulesByCategory(category);
    }
    
    getModulesByLayer(layer: ModuleLayer): BaseModule[] {
        return this.moduleRegistry.getModulesByLayer(layer);
    }
    
    validateModuleCompatibility(): boolean {
        return this.moduleRegistry.validateDependencies();
    }
    
    // === 플러그인 관리 API (기존 유지, 개선) ===
    
    addPlugin(plugin: BasePlugin): void {
        this.pluginManager.addPlugin(plugin);
    }
    
    removePlugin(pluginName: string): boolean {
        return this.pluginManager.removePlugin(pluginName);
    }
    
    getPlugin<T extends BasePlugin>(pluginName: string): T | null {
        return this.pluginManager.getPlugin<T>(pluginName);
    }
    
    hasPlugin(pluginName: string): boolean {
        return this.pluginManager.hasPlugin(pluginName);
    }
    
    listPlugins(): BasePlugin[] {
        return this.pluginManager.getActivePlugins();
    }
    
    // 플러그인 카테고리별 조회
    getPluginsByCategory(category: PluginCategory): BasePlugin[] {
        return this.pluginManager.getPluginsByCategory(category);
    }
    
    // === 에이전트 실행 API ===
    
    async run(input: string, options?: RunOptions): Promise<string> {
        // 모듈 준비 상태 확인
        if (!this.validateModuleCompatibility()) {
            throw new Error('Module dependencies not satisfied');
        }
        
        // 플러그인 라이프사이클 실행
        await this.executePluginHooks('beforeRun', input);
        
        try {
            // 핵심 AI 처리 로직
            const result = await this.processWithModules(input, options);
            
            await this.executePluginHooks('afterRun', input, result);
            return result;
        } catch (error) {
            await this.executePluginHooks('onError', error);
            throw error;
        }
    }
    
    async runStream(input: string, options?: RunOptions): AsyncIterable<string> {
        // ✅ AI Provider는 Module이 아닌 내부 핵심 클래스
        // (AI Provider 없으면 대화 자체가 불가능하므로 Module이 될 수 없음)
        const aiProvider = this.getAIProvider(); // 내부 핵심 클래스에서 가져옴
        if (!aiProvider) {
            throw new Error('No AI provider configured');
        }
        
        await this.executePluginHooks('beforeRun', input);
        
        try {
            for await (const chunk of aiProvider.generateStream([{ role: 'user', content: input }])) {
                await this.executePluginHooks('onStreamChunk', chunk);
                yield chunk;
            }
            await this.executePluginHooks('afterRun', input);
        } catch (error) {
            await this.executePluginHooks('onError', error);
            throw error;
        }
    }
    
    // === 내부 구현 메소드 ===
    
    private async initializeModules(modules?: BaseModule[]): Promise<void> {
        if (!modules || modules.length === 0) return;
        
        // 모듈 등록
        for (const module of modules) {
            this.registerModule(module);
        }
        
        // 의존성 검증
        if (!this.moduleRegistry.validateDependencies()) {
            throw new Error('Module dependencies validation failed');
        }
        
        // 모듈 초기화 (의존성 순서대로)
        await this.moduleRegistry.initializeModules();
    }
    
    private async registerPlugins(plugins?: BasePlugin[]): Promise<void> {
        if (!plugins || plugins.length === 0) return;
        
        for (const plugin of plugins) {
            this.addPlugin(plugin);
        }
        
        // 플러그인 초기화
        await this.pluginManager.initializePlugins();
    }
    
    private async processWithModules(input: string, options?: RunOptions): Promise<string> {
        // 1. 입력 전처리 (Perception Module)
        const perceptionModule = this.getModule<PerceptionModule>('perception');
        const processedInput = perceptionModule 
            ? await perceptionModule.processInput(input)
            : input;
        
        // 2. 메모리 조회 (Memory Module)
        const memoryModule = this.getModule<MemoryModule>('memory');
        const context = memoryModule
            ? await memoryModule.retrieveContext(processedInput)
            : undefined;
        
        // 3. 계획 수립 (Planning Module)
        const planningModule = this.getModule<PlanningModule>('planning');
        const plan = planningModule
            ? await planningModule.createPlan(processedInput, context)
            : undefined;
        
        // 4. AI 응답 생성 (Provider Module)
        const providerModule = this.getModule<AIProviderModule>('provider');
        if (!providerModule) {
            throw new Error('No AI provider module found');
        }
        
        const messages = this.buildMessages(processedInput, context, plan);
        const response = await providerModule.generateResponse(messages);
        
        // 5. 메모리 저장
        if (memoryModule) {
            await memoryModule.store('conversation', {
                input: processedInput,
                output: response,
                context,
                plan
            });
        }
        
        return response;
    }
    
    private async executePluginHooks(hook: string, ...args: any[]): Promise<void> {
        const plugins = this.listPlugins().filter(p => p.enabled);
        
        for (const plugin of plugins) {
            try {
                const method = (plugin as any)[hook];
                if (typeof method === 'function') {
                    await method.apply(plugin, args);
                }
            } catch (error) {
                console.error(`Plugin ${plugin.name} failed on ${hook}:`, error);
                // 플러그인 오류는 전파하지 않음
            }
        }
    }
    
    private buildMessages(input: string, context?: any, plan?: any): Message[] {
        const messages: Message[] = [];
        
        // 시스템 메시지 추가
        if (context) {
            messages.push({
                role: 'system',
                content: `Context: ${JSON.stringify(context)}`
            });
        }
        
        if (plan) {
            messages.push({
                role: 'system',
                content: `Plan: ${JSON.stringify(plan)}`
            });
        }
        
        // 사용자 입력 추가
        messages.push({
            role: 'user',
            content: input
        });
        
        return messages;
    }
}
```

## API 설계

### 새로운 Factory 패턴

```typescript
// Agent Builder 패턴
export class RobotaBuilder {
    private config: Partial<AdvancedAgentConfig> = {};
    private modules: BaseModule[] = [];
    private plugins: BasePlugin[] = [];
    
    setName(name: string): RobotaBuilder {
        this.config.name = name;
        return this;
    }
    
    // 모듈 추가 메소드들
    addAIProvider(provider: AIProviderModule): RobotaBuilder {
        this.modules.push(provider);
        return this;
    }
    
    addMemory(memory: MemoryModule): RobotaBuilder {
        this.modules.push(memory);
        return this;
    }
    
    addReasoning(reasoning: ReasoningModule): RobotaBuilder {
        this.modules.push(reasoning);
        return this;
    }
    
    addTool(tool: ToolModule): RobotaBuilder {
        this.modules.push(tool);
        return this;
    }
    
    // 플러그인 추가 메소드들
    enableUsageTracking(options?: UsagePluginOptions): RobotaBuilder {
        this.plugins.push(new UsagePlugin(options));
        return this;
    }
    
    enableLogging(options?: LoggingPluginOptions): RobotaBuilder {
        this.plugins.push(new LoggingPlugin(options));
        return this;
    }
    
    enablePerformanceMonitoring(options?: PerformancePluginOptions): RobotaBuilder {
        this.plugins.push(new PerformancePlugin(options));
        return this;
    }
    
    // 설정 메소드들
    setDebugMode(enabled: boolean): RobotaBuilder {
        this.config.debug = {
            enableModuleTracing: enabled,
            enablePluginTracing: enabled,
            logLevel: enabled ? 'debug' : 'info'
        };
        return this;
    }
    
    setPerformanceMode(mode: 'memory' | 'speed'): RobotaBuilder {
        this.config.performance = {
            enableLazyLoading: mode === 'memory',
            moduleInitBatchSize: mode === 'speed' ? 10 : 3,
            pluginExecutionTimeout: mode === 'speed' ? 100 : 1000
        };
        return this;
    }
    
    build(): Robota {
        const finalConfig: AdvancedAgentConfig = {
            name: this.config.name || 'robota-agent',
            aiProviders: {}, // Builder에서 자동 구성
            currentProvider: 'auto', // 첫 번째 provider 사용
            currentModel: 'auto', // 기본 모델 사용
            modules: this.modules,
            plugins: this.plugins,
            ...this.config
        };
        
        return new Robota(finalConfig);
    }
}

// 편의 메소드들
export class RobotaFactory {
    // 사전 정의된 에이전트 구성
    static createBasicAgent(): Robota {
        return new RobotaBuilder()
            .setName('basic-agent')
            .addAIProvider(new OpenAIProviderModule())
            .enableLogging()
            .build();
    }
    
    static createSmartAgent(): Robota {
        return new RobotaBuilder()
            .setName('smart-agent')
            .addAIProvider(new OpenAIProviderModule())
            .addMemory(new VectorMemoryModule())
            .addReasoning(new LogicalReasoningModule())
            .enableUsageTracking()
            .enablePerformanceMonitoring()
            .enableLogging()
            .build();
    }
    
    static createAnalyticsAgent(): Robota {
        return new RobotaBuilder()
            .setName('analytics-agent')
            .addAIProvider(new OpenAIProviderModule())
            .addMemory(new VectorMemoryModule())
            .addTool(new DataAnalysisToolModule())
            .enableUsageTracking({ detailed: true })
            .enablePerformanceMonitoring({ metrics: 'all' })
            .setDebugMode(true)
            .build();
    }
    
    // 도메인별 에이전트
    static createFinancialAgent(): Robota {
        // 금융 도메인에 특화된 모듈과 플러그인 구성
        ModuleTypeRegistry.registerType('financial-analysis', {
            type: 'financial-analysis',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.DOMAIN,
            dependencies: ['reasoning', 'memory'],
            capabilities: ['market-analysis', 'risk-assessment']
        });
        
        return new RobotaBuilder()
            .setName('financial-agent')
            .addAIProvider(new OpenAIProviderModule())
            .addMemory(new FinancialMemoryModule())
            .addReasoning(new FinancialReasoningModule())
            .addTool(new MarketDataToolModule())
            .enableUsageTracking()
            .build();
    }
}
```

### 사용법 예시

```typescript
// 1. Builder 패턴 사용
const agent = new RobotaBuilder()
    .setName('my-agent')
    .addAIProvider(new OpenAIProviderModule())
    .addMemory(new VectorMemoryModule())
    .enableUsageTracking()
    .enableLogging()
    .build();

// 2. Factory 메소드 사용
const smartAgent = RobotaFactory.createSmartAgent();

// 3. 직접 구성
const customAgent = new Robota({
    name: 'custom-agent',
    modules: [
        new OpenAIProviderModule(),
        new VectorMemoryModule(),
        new PlanningModule()
    ],
    plugins: [
        new UsagePlugin(),
        new PerformancePlugin()
    ]
});

// 4. 런타임 모듈/플러그인 추가
agent.registerModule(new ReasoningModule());
agent.addPlugin(new WebhookPlugin());

// 5. 에이전트 사용
const response = await agent.run('What is machine learning?');

// 6. 스트리밍 사용
for await (const chunk of agent.runStream('Explain quantum computing')) {
    console.log(chunk);
}

// 7. 모듈 조회 및 활용
const memory = agent.getModule<MemoryModule>('memory');
if (memory) {
    const savedData = await memory.retrieve('previous-conversation');
}

// 8. 플러그인 제어
agent.getPlugin<UsagePlugin>('usage-tracking')?.getStats();
```

### 고급 설정 예시

```typescript
// 고성능 설정
const performanceAgent = new RobotaBuilder()
    .addAIProvider(new OpenAIProviderModule())
    .setPerformanceMode('speed')
    .build();

// 디버깅 설정
const debugAgent = new RobotaBuilder()
    .addAIProvider(new OpenAIProviderModule())
    .setDebugMode(true)
    .build();

// 모듈별 세부 설정
const advancedAgent = new Robota({
    name: 'advanced-agent',
    modules: [new OpenAIProviderModule(), new VectorMemoryModule()],
    moduleConfigs: {
        'openai-provider': { apiKey: 'custom-key', timeout: 30000 },
        'vector-memory': { dimension: 1536, batchSize: 100 }
    },
    pluginConfigs: {
        'usage-tracking': { trackCosts: true, saveInterval: 5000 }
    }
});
```

이러한 통합 아키텍처를 통해 개발자는 필요에 따라 모듈과 플러그인을 조합하여 다양한 목적의 AI 에이전트를 구축할 수 있습니다. 