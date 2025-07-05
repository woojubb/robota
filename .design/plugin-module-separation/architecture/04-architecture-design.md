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
// ❌ 잘못된 예시: AI Provider를 Module로 만들기
// AI Provider는 필수 구성요소이므로 Module이 될 수 없음

// ✅ 올바른 예시: RAG Module (LLM이 할 수 없는 선택적 확장)
export class RAGModule extends BaseModule<RAGConfig> {
    readonly name = 'rag-search';
    readonly version = '1.0.0';
    readonly dependencies = ['vector-storage', 'transport'];
    
    private vectorStorage?: VectorStorageModule;
    private embedder?: EmbeddingService;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'rag-search',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: this.dependencies,
            capabilities: ['document-search', 'context-retrieval', 'rag-generation']
        };
    }
    
    async initialize(config: RAGConfig): Promise<void> {
        this.vectorStorage = await this.getModule<VectorStorageModule>('vector-storage');
        this.embedder = new EmbeddingService(config.embeddingProvider);
    }
    
    async dispose(): Promise<void> {
        await this.vectorStorage?.dispose();
        this.embedder = undefined;
    }
    
    getCapabilities(): ModuleCapabilities {
        return {
            documentIndexing: true,
            semanticSearch: true,
            contextRetrieval: true,
            maxDocuments: 10000
        };
    }
    
    validateDependencies(): boolean {
        return this.dependencies.every(dep => 
            ModuleTypeRegistry.getType(dep) !== undefined
        );
    }
    
    // RAG 특화 메소드들 (LLM이 할 수 없는 일)
    async addDocument(id: string, content: string, metadata?: any): Promise<void> {
        if (!this.vectorStorage) throw new Error('Vector storage not initialized');
        const embedding = await this.embedder!.embed(content);
        await this.vectorStorage.store(id, embedding, { content, metadata });
    }
    
    async searchRelevant(query: string, topK: number = 5): Promise<string[]> {
        if (!this.vectorStorage) throw new Error('Vector storage not initialized');
        const queryEmbedding = await this.embedder!.embed(query);
        const results = await this.vectorStorage.search(queryEmbedding, topK);
        return results.map(r => r.metadata.content);
    }
}

// ✅ 올바른 예시: File Processing Module (LLM이 할 수 없는 선택적 확장)
export class FileProcessingModule extends BaseModule<FileProcessingConfig> {
    readonly name = 'file-processing';
    readonly version = '1.0.0';
    readonly dependencies = ['storage'];
    
    private ocrService?: OCRService;
    private pdfParser?: PDFParser;
    private audioTranscriber?: AudioTranscriber;
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'file-processing',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: this.dependencies,
            capabilities: ['pdf-parsing', 'image-ocr', 'audio-transcription']
        };
    }
    
    async initialize(config: FileProcessingConfig): Promise<void> {
        this.ocrService = new OCRService(config.ocrProvider);
        this.pdfParser = new PDFParser();
        this.audioTranscriber = new AudioTranscriber(config.speechProvider);
    }
    
    async dispose(): Promise<void> {
        await this.ocrService?.dispose();
        await this.audioTranscriber?.dispose();
    }
    
    getCapabilities(): ModuleCapabilities {
        return {
            supportedFormats: ['pdf', 'png', 'jpg', 'mp3', 'wav'],
            maxFileSize: '100MB',
            ocrLanguages: ['en', 'ko', 'ja'],
            audioFormats: ['mp3', 'wav', 'flac']
        };
    }
    
    validateDependencies(): boolean {
        return this.dependencies.every(dep =>
            ModuleTypeRegistry.getType(dep) !== undefined
        );
    }
    
    // File Processing 특화 메소드들 (LLM이 할 수 없는 일)
    async processPDF(buffer: Buffer): Promise<string> {
        if (!this.pdfParser) throw new Error('PDF parser not initialized');
        return await this.pdfParser.extractText(buffer);
    }
    
    async processImage(buffer: Buffer): Promise<string> {
        if (!this.ocrService) throw new Error('OCR service not initialized');
        return await this.ocrService.extractText(buffer);
    }
    
    async processAudio(buffer: Buffer): Promise<string> {
        if (!this.audioTranscriber) throw new Error('Audio transcriber not initialized');
        return await this.audioTranscriber.transcribe(buffer);
    }
    
    async processFile(buffer: Buffer, type: string): Promise<string> {
        switch (type.toLowerCase()) {
            case 'pdf':
                return await this.processPDF(buffer);
            case 'png':
            case 'jpg':
            case 'jpeg':
                return await this.processImage(buffer);
            case 'mp3':
            case 'wav':
                return await this.processAudio(buffer);
            default:
                throw new Error(`Unsupported file type: ${type}`);
        }
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

## Event-Driven 상호작용 시스템

### 표준 이벤트 타입 정의

```typescript
// Module에서 발생하는 표준 이벤트들
export type ModuleEventType = 
    | 'module.registered'
    | 'module.initialized' 
    | 'module.disposing'
    | 'module.disposed'
    | 'module.operation.start'
    | 'module.operation.complete'
    | 'module.operation.error'
    | 'module.capability.changed';

// Plugin에서 발생하는 표준 이벤트들  
export type PluginEventType =
    | 'plugin.registered'
    | 'plugin.initialized'
    | 'plugin.disposing'
    | 'plugin.disposed';

// 상호작용 이벤트들
export type InteractionEventType =
    | 'storage.request'
    | 'storage.save'
    | 'storage.load'
    | 'search.request'
    | 'search.result'
    | 'processing.request'
    | 'processing.result';

### Event-Driven 상호작용 메커니즘

```typescript
// ✅ Module이 이벤트 발생 (Plugin 존재 모름)
export class RAGModule extends BaseModule<RAGModuleConfig> {
    async searchDocuments(query: string): Promise<SearchResult[]> {
        // 검색 시작 이벤트 발생
        this.emitEvent('module.operation.start', {
            moduleName: this.name,
            operation: 'search',
            operationId: this.generateOperationId(),
            query: query.substring(0, 100) // 로깅용으로 일부만
        });
        
        try {
            const results = await this.performSearch(query);
            
            // 검색 완료 이벤트 발생
            this.emitEvent('module.operation.complete', {
                moduleName: this.name,
                operation: 'search',
                operationId: this.currentOperationId,
                resultCount: results.length,
                duration: this.getOperationDuration()
            });
            
            return results;
        } catch (error) {
            // 에러 이벤트 발생
            this.emitEvent('module.operation.error', {
                moduleName: this.name,
                operation: 'search',
                operationId: this.currentOperationId,
                error: error.message
            });
            throw error;
        }
    }
}

// ✅ Plugin이 이벤트 수신 (Module 존재 모름)
export class LoggingPlugin extends BasePlugin<LoggingPluginOptions, LoggingStats> {
    protected setupModuleEventListeners(): void {
        if (!this.eventEmitter) return;
        
        // Module 작업 시작 이벤트 구독
        this.eventEmitter.on('module.operation.start', (event) => {
            this.logger.info(`Module operation started`, {
                module: event.data.moduleName,
                operation: event.data.operation,
                operationId: event.data.operationId
            });
        });
        
        // Module 작업 완료 이벤트 구독
        this.eventEmitter.on('module.operation.complete', (event) => {
            this.logger.info(`Module operation completed`, {
                module: event.data.moduleName,
                operation: event.data.operation,
                duration: event.data.duration,
                success: true
            });
        });
        
        // Module 에러 이벤트 구독
        this.eventEmitter.on('module.operation.error', (event) => {
            this.logger.error(`Module operation failed`, {
                module: event.data.moduleName,
                operation: event.data.operation,
                error: event.data.error
            });
        });
    }
}
```

## Robota 클래스 아키텍처 (선택적 확장 원칙 적용)

### Robota 클래스에서 Module 활용

```typescript
export class Robota {
    // ✅ 필수 구성요소들 (내부 핵심 클래스)
    private aiProvider: AIProvider;              // 없으면 대화 불가
    private toolExecutor: ToolExecutor;          // 없으면 함수 호출 불가
    private messageProcessor: MessageProcessor;  // 없으면 메시지 처리 불가
    private sessionManager: SessionManager;      // 없으면 세션 관리 불가
    
    // ✅ 선택적 확장들 (Module/Plugin들)
    private moduleManager: ModuleManager;
    private pluginManager: PluginManager;
    private modulePluginBridge: ModulePluginBridge;
    
    // 선택적 Module들 (없어도 기본 대화 가능)
    private ragModule?: RAGModule;
    private fileProcessingModule?: FileProcessingModule;
    private databaseModule?: DatabaseModule;
    private apiIntegrationModule?: APIIntegrationModule;
    
    constructor(config: RobotaConfig) {
        // 필수 구성요소들 초기화 (이것들 없으면 Robota 동작 불가)
        this.aiProvider = config.aiProvider;
        this.toolExecutor = new ToolExecutor();
        this.messageProcessor = new MessageProcessor();
        this.sessionManager = new SessionManager();
        
        // 선택적 확장들 초기화
        this.moduleManager = new ModuleManager();
        this.pluginManager = new PluginManager();
        this.modulePluginBridge = new ModulePluginBridge(
            this.moduleManager, 
            this.pluginManager
        );
    }
    
    // ✅ 선택적 Module 등록 (없어도 기본 동작)
    async addModule<T extends BaseModule>(module: T): Promise<void> {
        await this.moduleManager.register(module);
        
        // 특정 타입 Module에 대한 특별 처리
        const moduleType = module.getModuleType().type;
        switch (moduleType) {
            case 'rag-search':
                this.ragModule = module as RAGModule;
                break;
            case 'file-processing':
                this.fileProcessingModule = module as FileProcessingModule;
                break;
            case 'database':
                this.databaseModule = module as DatabaseModule;
                break;
            case 'api-integration':
                this.apiIntegrationModule = module as APIIntegrationModule;
                break;
        }
    }
    
    // ✅ 선택적 Plugin 등록 (없어도 기본 동작)
    async addPlugin<T extends BasePlugin>(plugin: T): Promise<void> {
        await this.pluginManager.register(plugin);
    }
    
    // ✅ 메인 실행 로직 (Module들을 선택적으로 활용)
    async run(input: string): Promise<string> {
        // Plugin 훅 실행 (선택적)
        await this.pluginManager.beforeRun(input);
        
        try {
            // RAG 검색 (RAG Module이 있는 경우만)
            let ragContext = '';
            if (this.ragModule) {
                try {
                    const relevantDocs = await this.ragModule.searchRelevant(input, 5);
                    ragContext = relevantDocs.length > 0 ? 
                        `Context:\n${relevantDocs.join('\n\n')}\n\n` : '';
                } catch (error) {
                    console.warn('RAG search failed, continuing without context:', error);
                }
            }
            
            // 파일 첨부 처리 (File Processing Module이 있는 경우만)
            let fileContext = '';
            if (this.fileProcessingModule && this.hasFileAttachment(input)) {
                try {
                    const files = this.extractFiles(input);
                    const processedFiles = await Promise.all(
                        files.map(file => this.fileProcessingModule!.processFile(file.buffer, file.type))
                    );
                    fileContext = `File contents:\n${processedFiles.join('\n\n')}\n\n`;
                } catch (error) {
                    console.warn('File processing failed, continuing without file context:', error);
                }
            }
            
            // 실시간 데이터 조회 (Database/API Module이 있는 경우만)
            let dataContext = '';
            if (this.databaseModule && this.needsRealtimeData(input)) {
                try {
                    const data = await this.queryRealtimeData(input);
                    dataContext = data ? `Real-time data:\n${data}\n\n` : '';
                } catch (error) {
                    console.warn('Database query failed, continuing without real-time data:', error);
                }
            }
            
            // 메시지 처리 (필수)
            const enhancedInput = ragContext + fileContext + dataContext + input;
            const messages = this.messageProcessor.formatMessages(enhancedInput);
            
            // AI 응답 생성 (필수)
            const response = await this.aiProvider.generateResponse(messages);
            
            await this.pluginManager.afterRun(input, response);
            return response;
            
        } catch (error) {
            await this.pluginManager.onError(error);
            throw error;
        }
    }
    
    // ✅ Module 없이도 기본 동작 보장 (핵심 기능)
    async runBasic(input: string): Promise<string> {
        // Module 없이도 기본 텍스트 대화는 가능
        const messages = this.messageProcessor.formatMessages(input);
        return await this.aiProvider.generateResponse(messages);
    }
    
    // ✅ 도구 실행 (필수 기능, Module 아님)
    async executeTool(name: string, params: any): Promise<any> {
        return await this.toolExecutor.execute(name, params);
    }
    
    // Helper 메소드들
    private hasFileAttachment(input: string): boolean {
        // 파일 첨부 여부 확인 로직
        return input.includes('[file:') || input.includes('attachment:');
    }
    
    private extractFiles(input: string): { buffer: Buffer; type: string }[] {
        // 파일 추출 로직
        return [];
    }
    
    private needsRealtimeData(input: string): boolean {
        // 실시간 데이터 필요 여부 확인
        return input.includes('real-time') || input.includes('current') || input.includes('latest');
    }
    
    private async queryRealtimeData(input: string): Promise<string | null> {
        // 실시간 데이터 조회 로직
        if (this.databaseModule) {
            return await this.databaseModule.query('SELECT * FROM real_time_data WHERE relevant = ?', [input]);
        }
        return null;
    }
}
```

### 사용 예시

```typescript
// ✅ 최소 구성 (기본 대화만 가능)
const basicAgent = new RobotaBuilder()
    .setAIProvider(new OpenAIProvider(config))  // 필수
    .build();

// ✅ 선택적 확장을 추가한 구성
const enhancedAgent = new RobotaBuilder()
    .setAIProvider(new OpenAIProvider(config))  // 필수
    .addModule(new RAGModule())                 // 선택적: 문서 검색 능력
    .addModule(new FileProcessingModule())      // 선택적: 파일 처리 능력  
    .addModule(new DatabaseModule())            // 선택적: DB 연동 능력
    .addPlugin(new LoggingPlugin())             // 선택적: 로깅 기능
    .addPlugin(new UsagePlugin())               // 선택적: 사용량 추적
    .build();

// 둘 다 기본 대화는 동일하게 작동
await basicAgent.run("Hello, how are you?");     // ✅ 작동
await enhancedAgent.run("Hello, how are you?");  // ✅ 작동

// 확장 기능은 Module이 있을 때만 동작
await basicAgent.run("Search documents about AI");    // 일반 응답 (RAG 없음)
await enhancedAgent.run("Search documents about AI"); // RAG 검색 기반 응답
```

이러한 아키텍처 설계를 통해 모듈과 플러그인이 명확히 분리되면서도 효율적으로 상호작용할 수 있는 시스템을 구축할 수 있습니다. 가장 중요한 것은 **선택적 확장 원칙**을 통해 Robota의 핵심 기능은 유지하면서, 필요에 따라 추가 능력을 확장할 수 있다는 것입니다. 