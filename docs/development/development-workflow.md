# Development Workflow

This document outlines the development workflow and processes for the Robota project.

## Code Quality Process

### Pragmatic Lint Strategy

- **Iterative Improvement**: Fix lint issues progressively, not all at once
- **Context-aware Decisions**: Some lint rules may be overridden with good reason
- **Team Consistency**: Maintain consistent code style across the project
- **Tool-assisted**: Use automated tools where possible, manual review where needed

### Lint Workflow Best Practices

1. **Development Phase**: 
   - Fix critical errors immediately (syntax, type errors)
   - Address warnings that affect functionality
   - Defer style-only warnings to review phase
   - Use `// eslint-disable-next-line` sparingly with comments explaining why

2. **Review Phase**: 
   - Run `pnpm run lint:fix` to auto-fix issues
   - Address remaining warnings with context consideration
   - Document any intentional rule overrides

3. **Pre-commit Phase**: 
   - Ensure no critical errors remain
   - All auto-fixable issues should be resolved
   - Document any remaining warnings in PR description

### Available Lint Commands

```bash
# Check lint issues across all packages
pnpm run lint

# Fix auto-fixable lint issues across all packages
pnpm run lint:fix

# Package-specific linting
pnpm --filter @robota-sdk/agents run lint:fix
pnpm --filter @robota-sdk/agents run lint:fix
pnpm --filter @robota-sdk/openai run lint:fix

# Examples and apps
pnpm --filter robota-examples run lint:fix
```

### Lint Rule Categories

#### Critical Issues (Fix Immediately)
- **Syntax Errors**: Break compilation/runtime
- **Type Errors**: Cause runtime failures
- **Security Issues**: Potential vulnerabilities
- **Logic Errors**: Incorrect program behavior

#### Important Issues (Address in Review)
- **Unused Variables**: May indicate incomplete code
- **Missing Error Handling**: Potential runtime issues
- **Performance Issues**: Inefficient patterns
- **Accessibility Issues**: User experience impacts

#### Style Issues (Batch Fix)
- **Import Ordering**: Can be auto-fixed
- **Formatting**: Should be handled by prettier
- **Naming Conventions**: Consistency improvements
- **Comment Style**: Documentation improvements

## Legacy Code Management

### Pragmatic Legacy Handling

- **Deprecation with Purpose**: Deprecate when there's a clear better alternative
- **Migration Support**: Provide migration tools and documentation
- **Compatibility Windows**: Support deprecated features for reasonable time periods
- **User Communication**: Clear communication about deprecations and timelines

### Refactoring Strategy

- **Incremental Changes**: Large refactors should be broken into smaller, reviewable changes
- **Backward Compatibility**: Maintain API compatibility during refactoring
- **Feature Flags**: Use feature flags for major changes
- **Testing**: Comprehensive testing during refactoring

### Technical Debt Management

- **Documentation**: Document known technical debt and its impact
- **Prioritization**: Address technical debt based on user impact and development velocity
- **Boy Scout Rule**: Leave code better than you found it
- **Regular Reviews**: Periodic technical debt assessment and planning

## IDE Configuration

### VSCode Recommendations

```json
// VSCode settings.json example
{
    "editor.codeActionsOnSave": {
        "source.fixAll.eslint": true,
        "source.organizeImports": true
    },
    "editor.formatOnSave": true,
    "typescript.preferences.importModuleSpecifier": "relative"
}
```

## Acceptable Code Overrides

### Temporary Lint Overrides

```typescript
// Acceptable: External library without types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const externalLibResult: any = untypedLibrary.method();

// Acceptable: Intentional any for generic utility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepClone<T = any>(obj: T): T {
    // Implementation needs any for JSON serialization
}

// NOT acceptable: Lazy typing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processData(data: any): any { // Should define proper types
```

## Package-Specific Guidelines

### @robota-sdk/agents Package

- Must not depend on deprecated packages
- Should be the primary entry point for new users
- Implement all functionality independently
- Maintain compatibility with existing provider packages

### Provider Packages (@robota-sdk/openai, anthropic, google)

- Should remain lightweight and focused
- Implement only provider-specific logic
- Maintain backward compatibility
- Support both core and agents packages

### Deprecation Strategy

- **Gradual Migration**: Provide clear migration paths for deprecated features
- **Timing**: Maintain deprecated features for at least 2 major versions
- **Documentation**: Clear deprecation warnings with replacement suggestions
- **Breaking Changes**: Only in major version releases 

## Plugin vs Module Development Guidelines

### Module vs Plugin Decision Tree

When developing a new component, use these questions to determine whether it should be a Module or Plugin:

#### Primary Filter: Optional Extension vs Essential Component
```
❓ "Can Robota perform basic text conversation without this feature?"
   ✅ Yes → Module or Plugin candidate (optional extension)
   ❌ No → Internal core class (not Module/Plugin)
```

#### Secondary Filter: LLM Capabilities vs External Extensions
```
❓ "Is this something LLMs cannot do natively?"
   ✅ Yes → Module candidate (e.g., file processing, DB integration, speech processing)
   ❌ No → "Does it observe/enhance existing behavior?"
           ✅ Yes → Plugin (e.g., logging, monitoring, notifications)
           ❌ No → Internal class (things LLMs already do well)
```

#### Important: Cases Where Module/Plugin is NOT Possible
```
❓ "Would removing this cause errors or break main functionality?"
   ✅ Yes → Internal core class (AI Provider, Tool Execution, Message Processing, etc.)
   ❌ No → Can be implemented as Module or Plugin

❓ "Is this something LLMs already do well?"
   ✅ Yes → Internal class or unnecessary (conversation, reasoning, text understanding, etc.)
   ❌ No → Module candidate
```

### Module Development Guidelines

#### 1. Design Principles
```typescript
// ✅ Good Module design (things LLMs cannot do)
export class VectorSearchModule extends BaseModule {
    // Clear responsibility: vector search (LLMs cannot do directly)
    async addDocument(id: string, text: string, metadata: any): Promise<void>
    async search(query: string, topK: number): Promise<SearchResult[]>
    async embed(text: string): Promise<number[]>
    
    // Clear capability specification
    getCapabilities(): ModuleCapabilities {
        return {
            vectorDimensions: [512, 1024, 1536],
            similarityMethods: ['cosine', 'euclidean'],
            indexTypes: ['flat', 'ivf', 'hnsw']
        };
    }
}

// ❌ Bad Module design (things LLMs already do well)
export class ReasoningModule extends BaseModule {
    // LLMs already reason well - unnecessary Module
    async analyze(text: string): Promise<Analysis>
    async infer(facts: string[]): Promise<string>
    async explain(conclusion: string): Promise<string>
}

// ❌ Essential component as Module
export class AIProviderModule extends BaseModule {
    // Without this, conversation is impossible - should be internal class
    async generateResponse(messages: Message[]): Promise<string>
}
```

#### 2. Dependency Management
```typescript
// ✅ Clear dependency definition (actual needed modules)
export class DatabaseModule extends BaseModule {
    readonly dependencies = ['transport']; // Network connection needed
    
    validateDependencies(): boolean {
        return this.dependencies.every(dep => 
            ModuleTypeRegistry.getType(dep) !== undefined
        );
    }
    
    // ✅ EventEmitter-based dependency resolution (no direct references)
    async initialize(config: DatabaseConfig): Promise<void> {
        // Emit transport module request event
        this.emitEvent('transport.request', {
            requestor: this.name,
            operation: 'initialize',
            config: config.transportConfig
        });
        
        // Subscribe to transport response event
        this.eventEmitter?.on('transport.ready', (event) => {
            if (event.data.requestor === this.name) {
                this.establishConnection(config);
            }
        });
    }
}

// ❌ Circular dependency - this design is prohibited
export class ModuleA extends BaseModule {
    readonly dependencies = ['module-b']; // If ModuleB also depends on ModuleA, circular dependency
}

// ✅ Correct dependency design - solved with Event-Driven approach
export class ModuleA extends BaseModule {
    readonly dependencies = []; // No direct dependencies
    
    async processData(data: any): Promise<any> {
        // Emit event when ModuleB functionality is needed
        this.emitEvent('moduleB.request', {
            requestor: this.name,
            operation: 'process',
            data
        });
        
        // Receive result via event
        return new Promise((resolve) => {
            this.eventEmitter?.once('moduleB.response', (event) => {
                if (event.data.requestor === this.name) {
                    resolve(event.data.result);
                }
            });
        });
    }
}
```

#### 3. Interface Design
```typescript
// ✅ Standard interface implementation (actual needed functionality)
export interface FileProcessingModule {
    processImage(buffer: Buffer): Promise<string>;
    processPDF(buffer: Buffer): Promise<string>;
    processAudio(buffer: Buffer): Promise<string>;
    extractMetadata(buffer: Buffer, type: string): Promise<any>;
}

export class LocalFileProcessingModule extends BaseModule implements FileProcessingModule {
    // Standard interface implementation
    async processImage(buffer: Buffer): Promise<string> { /* OCR processing */ }
    async processPDF(buffer: Buffer): Promise<string> { /* PDF parsing */ }
    async processAudio(buffer: Buffer): Promise<string> { /* Speech conversion */ }
    async extractMetadata(buffer: Buffer, type: string): Promise<any> { /* Metadata extraction */ }
    
    // Extended functionality
    async batchProcess(files: Buffer[]): Promise<string[]> { /* Batch processing */ }
}
```

### Plugin Development Guidelines

#### 1. Performance Considerations
```typescript
// ✅ Efficient Plugin design
export class PerformancePlugin extends BasePlugin {
    private metrics = new Map<string, number>();
    
    async beforeRun(input: string): Promise<void> {
        // Only perform lightweight measurements
        this.metrics.set('startTime', performance.now());
    }
    
    async afterRun(input: string, output: string): Promise<void> {
        // Process asynchronously to avoid affecting main flow
        setImmediate(() => {
            this.recordMetrics(input, output);
        });
    }
}

// ❌ Plugin that affects performance
export class BadPlugin extends BasePlugin {
    async beforeRun(input: string): Promise<void> {
        // Heavy operations that delay main flow
        await this.heavyAnalysis(input);
        await this.syncToDatabase();
    }
}
```

#### 2. Error Handling
```typescript
// ✅ Robust error handling
export class LoggingPlugin extends BasePlugin {
    async afterRun(input: string, output: string): Promise<void> {
        try {
            await this.logConversation(input, output);
        } catch (error) {
            // Handle plugin errors silently without affecting main flow
            this.handleError('Failed to log conversation', error);
        }
    }
    
    private handleError(message: string, error: any): void {
        // Handle internally only, don't propagate to external
        console.error(`${this.name}: ${message}`, error);
        this.incrementErrorCount();
    }
}
```

#### 3. State Management
```typescript
// ✅ Independent state management
export class UsagePlugin extends BasePlugin {
    private usage = {
        totalRequests: 0,
        totalTokens: 0,
        totalCost: 0
    };
    
    // State is isolated and independent of other plugins
    getStats(): UsageStats {
        return { ...this.usage }; // Return copy
    }
    
    async afterRun(input: string, output: string): Promise<void> {
        this.usage.totalRequests++;
        this.usage.totalTokens += this.countTokens(input, output);
        this.usage.totalCost += this.calculateCost(this.usage.totalTokens);
    }
}
```

## Practical Application Scenarios

### Scenario 1: Adding RAG Document Search

**Requirement**: Document search-based answer generation

**Analysis Process**:
1. **Optional extension?**: ✅ (general conversation possible without it)
2. **Something LLMs cannot do?**: ✅ (real-time document search not directly possible for LLMs)
3. **Conclusion**: Module

**Implementation**:
```typescript
export class RAGModule extends BaseModule<RAGConfig> {
    readonly name = 'rag-search';
    readonly version = '1.0.0';
    readonly dependencies = ['vector-search', 'storage'];
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'rag-search',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: this.dependencies,
            capabilities: ['document-search', 'context-retrieval', 'rag-generation']
        };
    }
    
    async addDocument(id: string, content: string, metadata?: any): Promise<void> {
        // Event-Driven: emit event to vector search module
        this.emitEvent('vector.addDocument', {
            requestor: this.name,
            id, content, metadata
        });
    }
    
    async searchRelevant(query: string, topK: number = 5): Promise<string[]> {
        // Event-Driven: emit search request event
        this.emitEvent('vector.search', {
            requestor: this.name,
            query, topK
        });
        
        // Receive search results via event
        return new Promise((resolve) => {
            this.eventEmitter?.once('vector.searchResponse', (event) => {
                if (event.data.requestor === this.name) {
                    resolve(event.data.results.map((r: any) => r.content));
                }
            });
        });
    }
    
    async generateAnswer(query: string, context: string[]): Promise<string> {
        // RAG logic: support answer generation based on retrieved documents
        const contextText = context.join('\n\n');
        return `Based on the following context:\n${contextText}\n\nAnswer: [LLM will generate based on this context]`;
    }
}
```

### Scenario 2: Conversation Quality Assessment

**Requirement**: Automatically evaluate and score AI response quality

**Analysis Process**:
1. **Optional extension?**: ✅ (conversation works normally without it)
2. **Something LLMs cannot do?**: ❌ (observes/evaluates existing behavior)
3. **Conclusion**: Plugin

**Implementation**:
```typescript
export class QualityAssessmentPlugin extends BasePlugin<QualityOptions, QualityStats> {
    readonly name = 'quality-assessment';
    readonly version = '1.0.0';
    readonly category = PluginCategory.MONITORING;
    readonly priority = PluginPriority.NORMAL;
    
    private qualityScores: number[] = [];
    
    async afterRun(input: string, output: string): Promise<void> {
        // Execute quality assessment asynchronously (no impact on main flow)
        setImmediate(async () => {
            const score = await this.assessQuality(input, output);
            this.qualityScores.push(score);
            
            if (score < 0.5) {
                await this.flagLowQuality(input, output, score);
            }
        });
    }
    
    getStats(): QualityStats {
        return {
            averageScore: this.qualityScores.reduce((a, b) => a + b, 0) / this.qualityScores.length,
            totalAssessments: this.qualityScores.length,
            lowQualityCount: this.qualityScores.filter(s => s < 0.5).length
        };
    }
    
    private async assessQuality(input: string, output: string): Promise<number> {
        // Response quality assessment logic (observation functionality)
        return Math.random(); // Example
    }
}
```

### Scenario 3: File Processing System

**Requirement**: Process PDF, image, and audio files to convert to text

**Analysis Process**:
1. **Optional extension?**: ✅ (text conversation possible without it)
2. **Something LLMs cannot do?**: ✅ (file parsing not directly possible for LLMs)
3. **Conclusion**: Module

**Implementation**:
```typescript
export class FileProcessingModule extends BaseModule<FileProcessingConfig> {
    readonly name = 'file-processing';
    readonly version = '1.0.0';
    readonly dependencies = ['storage'];
    
    getModuleType(): ModuleTypeDescriptor {
        return {
            type: 'file-processing',
            category: ModuleCategory.CAPABILITY,
            layer: ModuleLayer.APPLICATION,
            dependencies: this.dependencies,
            capabilities: ['pdf-parsing', 'image-ocr', 'audio-transcription']
        };
    }
    
    async processFile(buffer: Buffer, type: string): Promise<string> {
        switch (type) {
            case 'pdf':
                return await this.processPDF(buffer);
            case 'image':
                return await this.processImage(buffer);
            case 'audio':
                return await this.processAudio(buffer);
            default:
                throw new Error(`Unsupported file type: ${type}`);
        }
    }
    
    private async processPDF(buffer: Buffer): Promise<string> {
        // PDF parsing logic (file processing LLMs cannot do)
        return 'Extracted text from PDF';
    }
    
    private async processImage(buffer: Buffer): Promise<string> {
        // OCR processing logic (image text extraction LLMs cannot do)
        return 'Extracted text from image';
    }
    
    private async processAudio(buffer: Buffer): Promise<string> {
        // Speech recognition logic (audio conversion LLMs cannot do)
        return 'Transcribed text from audio';
    }
}
```

## Best Practices

### Module Development
1. **Clear Responsibility**: Focus on capabilities LLMs cannot provide
2. **Event-Driven Communication**: Use EventEmitter for loose coupling
3. **Dependency Declaration**: Clearly specify module dependencies
4. **Capability Definition**: Explicitly define what the module provides
5. **Optional Extension**: Ensure agent works without the module

### Plugin Development
1. **Performance Awareness**: Minimize impact on main execution flow
2. **Error Isolation**: Handle errors without affecting agent operation
3. **Independent State**: Maintain isolated state from other components
4. **Asynchronous Processing**: Use async operations for heavy tasks
5. **Graceful Degradation**: Function properly even when other plugins fail

### General Guidelines
1. **Type Safety**: Use TypeScript interfaces and generics
2. **Event-Driven Architecture**: Prefer events over direct coupling
3. **Modular Design**: Keep components focused and independent
4. **Documentation**: Clearly document capabilities and dependencies
5. **Testing**: Write comprehensive tests for both modules and plugins

This development workflow ensures that the Plugin vs Module architecture maintains clarity, performance, and extensibility while providing a solid foundation for building sophisticated AI agents. 