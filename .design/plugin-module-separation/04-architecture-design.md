# 아키텍처 설계

## Core Module Interface

### BaseModule 클래스 정의

```typescript
export interface ModuleCapabilities {
    [key: string]: any;
}

export interface ModuleConfig {
    [key: string]: any;
}

export abstract class BaseModule<TConfig = ModuleConfig> {
    abstract readonly name: string;
    abstract readonly version: string;
    abstract readonly dependencies: string[];
    
    // 유연한 모듈 타입 시스템 사용
    abstract getModuleType(): ModuleTypeDescriptor;
    
    // 생명주기 메소드
    abstract initialize(config?: TConfig): Promise<void>;
    abstract dispose(): Promise<void>;
    
    // 모듈 메타데이터
    abstract getCapabilities(): ModuleCapabilities;
    abstract validateDependencies(): boolean;
    
    // 모듈 호환성 검사
    isCompatibleWith(otherModule: BaseModule): boolean {
        const myType = this.getModuleType();
        const otherType = otherModule.getModuleType();
        
        // 계층 간 호환성 검사
        return this.checkLayerCompatibility(myType.layer, otherType.layer);
    }
    
    private checkLayerCompatibility(layer1: ModuleLayer, layer2: ModuleLayer): boolean {
        // 도메인 계층은 모든 하위 계층과 호환
        // 애플리케이션 계층은 플랫폼, 인프라와 호환
        // 플랫폼 계층은 인프라와 호환
        const compatibility: Record<ModuleLayer, ModuleLayer[]> = {
            [ModuleLayer.DOMAIN]: [ModuleLayer.APPLICATION, ModuleLayer.PLATFORM, ModuleLayer.INFRASTRUCTURE],
            [ModuleLayer.APPLICATION]: [ModuleLayer.PLATFORM, ModuleLayer.INFRASTRUCTURE],
            [ModuleLayer.PLATFORM]: [ModuleLayer.INFRASTRUCTURE],
            [ModuleLayer.INFRASTRUCTURE]: []
        };
        
        return compatibility[layer1]?.includes(layer2) ?? false;
    }
}
```

### Module 구현 예시

```typescript
// AI Provider Module 예시
export class OpenAIProviderModule extends BaseModule<OpenAIConfig> {
    readonly name = 'openai-provider';
    readonly version = '1.0.0';
    readonly dependencies = ['http-transport'];
    
    private client?: OpenAI;
    
    getModuleType(): ModuleTypeDescriptor {
        return ModuleTypeRegistry.getType('provider')!;
    }
    
    async initialize(config: OpenAIConfig): Promise<void> {
        this.client = new OpenAI({ apiKey: config.apiKey });
    }
    
    async dispose(): Promise<void> {
        this.client = undefined;
    }
    
    getCapabilities(): ModuleCapabilities {
        return {
            textGeneration: true,
            streaming: true,
            models: ['gpt-4', 'gpt-3.5-turbo'],
            maxTokens: 128000
        };
    }
    
    validateDependencies(): boolean {
        return this.dependencies.every(dep => 
            ModuleTypeRegistry.getType(dep) !== undefined
        );
    }
    
    // AI Provider 특화 메소드들
    async generateResponse(messages: Message[]): Promise<string> {
        if (!this.client) throw new Error('Module not initialized');
        // OpenAI API 호출 로직
    }
    
    async generateStream(messages: Message[]): AsyncIterable<string> {
        if (!this.client) throw new Error('Module not initialized');
        // OpenAI streaming API 호출 로직
    }
}

// Memory Module 예시
export class VectorMemoryModule extends BaseModule<VectorMemoryConfig> {
    readonly name = 'vector-memory';
    readonly version = '1.0.0';
    readonly dependencies = ['vector-storage', 'embedding-provider'];
    
    getModuleType(): ModuleTypeDescriptor {
        return ModuleTypeRegistry.getType('memory')!;
    }
    
    async initialize(config: VectorMemoryConfig): Promise<void> {
        // 벡터 스토리지 및 임베딩 프로바이더 초기화
    }
    
    async dispose(): Promise<void> {
        // 리소스 정리
    }
    
    getCapabilities(): ModuleCapabilities {
        return {
            vectorDimension: 1536,
            similaritySearch: true,
            episodicMemory: true,
            semanticSearch: true
        };
    }
    
    validateDependencies(): boolean {
        return this.dependencies.every(dep =>
            ModuleTypeRegistry.getType(dep) !== undefined
        );
    }
    
    // Memory 특화 메소드들
    async store(key: string, value: any, metadata?: any): Promise<void> {
        // 벡터 저장 로직
    }
    
    async retrieve(key: string): Promise<any> {
        // 벡터 검색 로직
    }
    
    async search(query: string, topK: number = 5): Promise<any[]> {
        // 유사도 검색 로직
    }
}
```

## ModuleRegistry 시스템

### ModuleRegistry 클래스

```typescript
export interface ModuleEvent {
    type: 'registered' | 'initialized' | 'disposed';
    module: BaseModule;
    timestamp: number;
}

export class ModuleRegistry {
    private modules = new Map<string, BaseModule>();
    private dependencyGraph = new Map<string, string[]>();
    private typeDescriptors = new Map<string, ModuleTypeDescriptor>();
    private eventHandlers = new Map<string, ((event: ModuleEvent) => void)[]>();
    
    registerModule(module: BaseModule): void {
        const moduleType = module.getModuleType();
        
        // 타입 유효성 검사
        if (!ModuleTypeRegistry.validateDependencies(moduleType.type)) {
            throw new Error(`Invalid module type dependencies: ${moduleType.type}`);
        }
        
        // 호환성 검사
        this.validateModuleCompatibility(module);
        
        this.modules.set(module.name, module);
        this.dependencyGraph.set(module.name, module.dependencies);
        this.typeDescriptors.set(module.name, moduleType);
        
        // 이벤트 발생
        this.emitEvent({
            type: 'registered',
            module: module,
            timestamp: Date.now()
        });
    }
    
    async initializeModules(): Promise<void> {
        // 의존성 순서대로 초기화
        const initOrder = this.topologicalSort();
        await this.initializeInOrder(initOrder);
    }
    
    async disposeModules(): Promise<void> {
        // 초기화 역순으로 정리
        const initOrder = this.topologicalSort();
        await this.disposeInOrder(initOrder.reverse());
    }
    
    validateDependencies(): boolean {
        // 모든 모듈의 의존성이 충족되는지 확인
        for (const [moduleName, deps] of this.dependencyGraph) {
            if (!deps.every(dep => this.modules.has(dep))) {
                return false;
            }
        }
        return true;
    }
    
    getModule<T extends BaseModule>(name: string): T | null {
        return (this.modules.get(name) as T) || null;
    }
    
    getModulesByType(type: string): BaseModule[] {
        return Array.from(this.modules.values()).filter(module => 
            module.getModuleType().type === type
        );
    }
    
    getModulesByCategory(category: ModuleCategory): BaseModule[] {
        return Array.from(this.modules.values()).filter(module =>
            module.getModuleType().category === category
        );
    }
    
    getModulesByLayer(layer: ModuleLayer): BaseModule[] {
        return Array.from(this.modules.values()).filter(module =>
            module.getModuleType().layer === layer
        );
    }
    
    // 이벤트 시스템
    onModuleEvent(eventType: string, handler: (event: ModuleEvent) => void): void {
        if (!this.eventHandlers.has(eventType)) {
            this.eventHandlers.set(eventType, []);
        }
        this.eventHandlers.get(eventType)!.push(handler);
    }
    
    private emitEvent(event: ModuleEvent): void {
        const handlers = this.eventHandlers.get(event.type) || [];
        handlers.forEach(handler => handler(event));
    }
    
    private validateModuleCompatibility(newModule: BaseModule): void {
        const existingModules = Array.from(this.modules.values());
        
        for (const existing of existingModules) {
            if (!newModule.isCompatibleWith(existing)) {
                throw new Error(
                    `Module ${newModule.name} is not compatible with ${existing.name}`
                );
            }
        }
    }
    
    private topologicalSort(): string[] {
        // 의존성 그래프를 기반으로 초기화 순서 결정
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const result: string[] = [];
        
        const visit = (moduleName: string) => {
            if (visiting.has(moduleName)) {
                throw new Error(`Circular dependency detected: ${moduleName}`);
            }
            if (visited.has(moduleName)) return;
            
            visiting.add(moduleName);
            const deps = this.dependencyGraph.get(moduleName) || [];
            
            for (const dep of deps) {
                if (!this.modules.has(dep)) {
                    throw new Error(`Missing dependency: ${dep} for module ${moduleName}`);
                }
                visit(dep);
            }
            
            visiting.delete(moduleName);
            visited.add(moduleName);
            result.push(moduleName);
        };
        
        for (const moduleName of this.modules.keys()) {
            visit(moduleName);
        }
        
        return result;
    }
    
    private async initializeInOrder(order: string[]): Promise<void> {
        for (const moduleName of order) {
            const module = this.modules.get(moduleName);
            if (module) {
                await module.initialize();
                this.emitEvent({
                    type: 'initialized',
                    module: module,
                    timestamp: Date.now()
                });
            }
        }
    }
    
    private async disposeInOrder(order: string[]): Promise<void> {
        for (const moduleName of order) {
            const module = this.modules.get(moduleName);
            if (module) {
                await module.dispose();
                this.emitEvent({
                    type: 'disposed',
                    module: module,
                    timestamp: Date.now()
                });
            }
        }
    }
}
```

## Plugin 시스템 개선

### Enhanced Plugin Interface

```typescript
export abstract class BasePlugin<TOptions extends BasePluginOptions = BasePluginOptions, TStats = PluginStats> {
    // 기존 필드 유지
    abstract readonly name: string;
    abstract readonly version: string;
    public enabled = true;
    
    // 새로운 분류 필드
    abstract readonly category: PluginCategory;
    abstract readonly priority: number;
    readonly requiredModules?: string[];
    
    // 기존 생명주기 메소드
    abstract initialize(options?: TOptions): Promise<void>;
    cleanup?(): Promise<void>;
    getData?(): PluginData;
    getStats?(): TStats;
    
    // 새로운 생명주기 메소드
    canActivate?(): Promise<boolean>;
    onModuleChange?(moduleEvent: ModuleEvent): Promise<void>;
}

export enum PluginCategory {
    MONITORING = 'monitoring',     // 모니터링 (Usage, Performance)
    LOGGING = 'logging',          // 로깅 (Logging, ErrorHandling)
    NOTIFICATION = 'notification', // 알림 (Webhook, EventEmitter)
    SECURITY = 'security',        // 보안 (Limits, Authentication)
    STORAGE = 'storage',          // 저장소 (ConversationHistory)
    UTILITY = 'utility'           // 유틸리티 (기타 도구)
}
```

### Enhanced Plugin 구현 예시

```typescript
// Usage Plugin with enhanced features
export class UsagePlugin extends BasePlugin<UsagePluginOptions, UsageStats> {
    readonly name = 'usage-tracking';
    readonly version = '2.0.0';
    readonly category = PluginCategory.MONITORING;
    readonly priority = 100;
    readonly requiredModules = ['provider'];
    
    private startTime = 0;
    private moduleRegistry?: ModuleRegistry;
    
    async initialize(options: UsagePluginOptions): Promise<void> {
        // 기존 초기화 로직
    }
    
    async canActivate(): Promise<boolean> {
        // 필요한 모듈들이 등록되어 있는지 확인
        return this.requiredModules?.every(moduleName =>
            this.moduleRegistry?.getModule(moduleName) !== null
        ) ?? true;
    }
    
    async onModuleChange(moduleEvent: ModuleEvent): Promise<void> {
        if (moduleEvent.type === 'initialized' && 
            moduleEvent.module.getModuleType().type === 'provider') {
            // AI Provider가 초기화되면 토큰 카운팅 준비
            this.setupTokenCounting(moduleEvent.module);
        }
    }
    
    // 기존 lifecycle hooks
    async beforeRun(input: string): Promise<void> {
        this.startTime = Date.now();
    }
    
    async afterRun(input: string, output: string): Promise<void> {
        this.recordUsage({
            duration: Date.now() - this.startTime,
            inputTokens: this.countTokens(input),
            outputTokens: this.countTokens(output)
        });
    }
    
    private setupTokenCounting(providerModule: BaseModule): void {
        // Provider 모듈의 capabilities를 기반으로 토큰 카운팅 설정
        const capabilities = providerModule.getCapabilities();
        if (capabilities.tokenCounting) {
            // 토큰 카운팅 로직 설정
        }
    }
}

// Enhanced ConversationHistory Plugin
export class ConversationHistoryPlugin extends BasePlugin<ConversationHistoryOptions, ConversationHistoryStats> {
    readonly name = 'conversation-history';
    readonly version = '2.0.0';
    readonly category = PluginCategory.STORAGE;
    readonly priority = 90;
    readonly requiredModules = ['storage'];
    
    private storageModule?: BaseModule;
    
    async initialize(options: ConversationHistoryOptions): Promise<void> {
        // 기존 초기화 로직
    }
    
    async onModuleChange(moduleEvent: ModuleEvent): Promise<void> {
        if (moduleEvent.type === 'initialized' && 
            moduleEvent.module.getModuleType().type === 'storage') {
            this.storageModule = moduleEvent.module;
            this.setupStorageHooks();
        }
    }
    
    async afterRun(input: string, output: string): Promise<void> {
        if (this.storageModule) {
            await this.saveConversation({ input, output, timestamp: Date.now() });
        }
    }
    
    private setupStorageHooks(): void {
        // Storage 모듈과의 연동 설정
    }
}
```

## 모듈과 플러그인 연동

### 상호작용 메커니즘

```typescript
export class ModulePluginBridge {
    constructor(
        private moduleRegistry: ModuleRegistry,
        private pluginManager: PluginManager
    ) {
        // 모듈 이벤트를 플러그인에 전파
        this.moduleRegistry.onModuleEvent('*', (event) => {
            this.notifyPlugins(event);
        });
    }
    
    private async notifyPlugins(moduleEvent: ModuleEvent): Promise<void> {
        const plugins = this.pluginManager.getActivePlugins();
        
        for (const plugin of plugins) {
            if (plugin.onModuleChange && this.isRelevantModule(plugin, moduleEvent.module)) {
                try {
                    await plugin.onModuleChange(moduleEvent);
                } catch (error) {
                    console.error(`Plugin ${plugin.name} failed to handle module event:`, error);
                }
            }
        }
    }
    
    private isRelevantModule(plugin: BasePlugin, module: BaseModule): boolean {
        // 플러그인이 해당 모듈에 관심이 있는지 확인
        const requiredModules = plugin.requiredModules || [];
        const moduleType = module.getModuleType().type;
        
        return requiredModules.includes(module.name) || 
               requiredModules.includes(moduleType);
    }
}
```

이러한 아키텍처 설계를 통해 모듈과 플러그인이 명확히 분리되면서도 효율적으로 상호작용할 수 있는 시스템을 구축할 수 있습니다. 