# Robota Constructor AI Provider Injection Refactoring

## 🎯 새로운 설계 개요

Robota 생성자의 AI Provider 주입 방식을 완전히 새로운 방식으로 교체합니다. 기존 방식과의 호환성은 제공하지 않으며, 완전한 Breaking Change입니다.

## 🚀 최종 설계

### 새로운 AgentConfig 인터페이스

```typescript
interface AgentConfig {
    name: string;
    aiProviders: AIProvider[];
    defaultModel: {
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        systemMessage?: string;
    };
    tools?: BaseTool[];
    plugins?: BasePlugin[];
    modules?: BaseModule[];
    logging?: LoggingConfig;
}
```

### 새로운 사용법

```typescript
// ✅ 새로운 Robota 생성자
const robota = new Robota({
    name: 'MyAgent',
    aiProviders: [
        new OpenAIProvider({ apiKey: 'sk-...' }),
        new AnthropicProvider({ apiKey: 'sk-...' }),
        new GoogleProvider({ apiKey: 'sk-...' })
    ],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 2000
    },
    tools: [...],
    plugins: [...],
    modules: [...]
});
```

### 새로운 런타임 메서드

```typescript
// 모델 설정 완전 교체
robota.setModel({
    provider: 'anthropic',
    model: 'claude-3-opus',
    temperature: 0.9,
    maxTokens: 4000
});

// 현재 모델 설정 조회
const currentModel = robota.getModel();
```

## 🔧 핵심 구현 사항

### 1. 생성자 검증 로직

```typescript
export class Robota extends BaseAgent<AgentConfig, RunOptions, Message> {
    constructor(config: AgentConfig) {
        super();
        
        this.validateConfig(config);
        this.initializeProviders(config.aiProviders);
        this.applyDefaultModel(config.defaultModel);
        
        // 나머지 초기화...
    }
    
    private validateConfig(config: AgentConfig): void {
        if (!config.aiProviders || config.aiProviders.length === 0) {
            throw new ConfigurationError('At least one AI provider is required');
        }
        
        const providerNames = config.aiProviders.map(p => p.name);
        const duplicates = providerNames.filter((name, index) => 
            providerNames.indexOf(name) !== index
        );
        if (duplicates.length > 0) {
            throw new ConfigurationError(`Duplicate AI provider names: ${duplicates.join(', ')}`);
        }
        
        if (!providerNames.includes(config.defaultModel.provider)) {
            throw new ConfigurationError(
                `Default provider '${config.defaultModel.provider}' not found in AI providers list. ` +
                `Available: ${providerNames.join(', ')}`
            );
        }
    }
    
    private initializeProviders(aiProviders: AIProvider[]): void {
        for (const provider of aiProviders) {
            this.aiProviders.addProvider(provider.name, provider);
        }
    }
    
    private applyDefaultModel(defaultModel: AgentConfig['defaultModel']): void {
        this.aiProviders.setCurrentProvider(defaultModel.provider, defaultModel.model);
        this.config.temperature = defaultModel.temperature;
        this.config.maxTokens = defaultModel.maxTokens;
        this.config.topP = defaultModel.topP;
        this.config.systemMessage = defaultModel.systemMessage;
    }
}
```

### 2. 새로운 런타임 메서드

```typescript
export class Robota {
    /**
     * 모델 설정을 완전히 교체합니다.
     */
    setModel(modelConfig: {
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        systemMessage?: string;
    }): void {
        const availableProviders = this.aiProviders.getProviderNames();
        if (!availableProviders.includes(modelConfig.provider)) {
            throw new ConfigurationError(
                `AI Provider '${modelConfig.provider}' not found. ` +
                `Available: ${availableProviders.join(', ')}`
            );
        }
        
        this.aiProviders.setCurrentProvider(modelConfig.provider, modelConfig.model);
        
        // 전체 덮어쓰기
        this.config.temperature = modelConfig.temperature;
        this.config.maxTokens = modelConfig.maxTokens;
        this.config.topP = modelConfig.topP;
        this.config.systemMessage = modelConfig.systemMessage;
        
        this.logger.debug('Model configuration updated', modelConfig);
    }
    
    /**
     * 현재 모델 설정을 조회합니다.
     */
    getModel(): {
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        systemMessage?: string;
    } {
        const currentProvider = this.aiProviders.getCurrentProvider();
        if (!currentProvider) {
            throw new Error('No provider is currently set');
        }
        
        return {
            provider: currentProvider.provider,
            model: currentProvider.model,
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            topP: this.config.topP,
            systemMessage: this.config.systemMessage
        };
    }
}
```

## 📚 사용 예시

### 기본 사용법

```typescript
// 단일 AI Provider
const simpleAgent = new Robota({
    name: 'SimpleAgent',
    aiProviders: [
        new OpenAIProvider({ apiKey: 'sk-...' })
    ],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4'
    }
});

// 다중 AI Provider
const multiAgent = new Robota({
    name: 'MultiAgent',
    aiProviders: [
        new OpenAIProvider({ apiKey: 'sk-...' }),
        new AnthropicProvider({ apiKey: 'sk-...' }),
        new GoogleProvider({ apiKey: 'sk-...' })
    ],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.7
    }
});
```

### 런타임 모델 변경

```typescript
// 완전한 모델 설정 교체
robota.setModel({
    provider: 'anthropic',
    model: 'claude-3-opus',
    temperature: 0.9,
    maxTokens: 4000
});

// 현재 설정 확인
const current = robota.getModel();
console.log(`Current: ${current.provider}/${current.model}`);
```

## 🗑️ 제거되는 기능들

### 생성자 옵션 (완전 제거)
```typescript
// ❌ 더 이상 지원하지 않음
interface RemovedOptions {
    aiProviders?: Record<string, AIProvider>;  // 객체 방식
    currentProvider?: string;
    currentModel?: string;
    provider?: string;
    model?: string;
    temperature?: number;                      // 최상위 레벨
    maxTokens?: number;                        // 최상위 레벨
}
```

### 런타임 메서드 (완전 제거)
```typescript
// ❌ 더 이상 지원하지 않음
robota.switchProvider(provider: string, model: string);
robota.registerProvider(name: string, provider: AIProvider);
robota.updateConfig(config: Partial<AgentConfig>);
```

## 🎯 핵심 개선점

1. **명확한 구조**: `aiProviders` 배열 + `defaultModel` 객체로 역할 분리
2. **타입 안전성**: Provider 이름 검증 및 중복 확인
3. **일관된 API**: `setModel()` / `getModel()` 메서드로 통일
4. **완전 교체**: 부분 업데이트 없이 전체 설정 교체
5. **에러 처리**: 명확한 에러 메시지와 검증 로직

이 새로운 설계로 Robota의 AI Provider 관리가 훨씬 직관적이고 안전해집니다!
