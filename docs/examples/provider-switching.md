# Provider Switching

This example demonstrates advanced provider switching patterns, including dynamic model switching, conversation history preservation, and performance comparison across different AI providers.

## Overview

The provider switching examples show how to:
- Switch between different AI providers dynamically during conversations
- Compare responses across multiple providers
- Maintain conversation history when switching providers
- Test different models within the same provider
- Implement graceful fallbacks and error handling

## Source Code

**Locations**: 
- `apps/examples/01-basic/04-provider-switching.ts` - Full multi-provider switching
- `apps/examples/01-basic/04-provider-switching-simple.ts` - OpenAI model switching

## Key Concepts

### 1. Dynamic Provider Switching
```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';

// Setup multiple providers
const robota = new Robota({
    aiProviders: {
        'openai': openaiProvider,
        'anthropic': anthropicProvider,
        'google': googleProvider
    },
    currentModel: 'gpt-3.5-turbo'
});

// Switch providers dynamically
async function testProviderSwitching() {
    // Test OpenAI
    console.log('Testing OpenAI...');
    robota.setModel({ provider: 'openai', model: 'gpt-3.5-turbo' });
    const openaiResponse = await robota.run('Explain quantum computing in simple terms');
    
    // Switch to Anthropic
    console.log('Testing Anthropic...');
    robota.setModel({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' });
    const anthropicResponse = await robota.run('Explain quantum computing in simple terms');
    
    // Switch to Google
    console.log('Testing Google...');
    robota.setModel({ provider: 'google', model: 'gemini-1.5-pro' });
    const googleResponse = await robota.run('Explain quantum computing in simple terms');
    
    return { openaiResponse, anthropicResponse, googleResponse };
}
```

### 2. Model Switching Within Provider
```typescript
// Simple OpenAI model switching
const openaiModels = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o-mini'];

async function testModelSwitching() {
    const question = 'Write a creative short story about a robot learning to paint';
    const results = {};
    
    for (const model of openaiModels) {
        console.log(`Testing ${model}...`);
        robota.setModel({ provider: 'openai', model });
        
        const startTime = Date.now();
        const response = await robota.run(question);
        const responseTime = Date.now() - startTime;
        
        results[model] = {
            response,
            responseTime,
            wordCount: response.split(' ').length
        };
    }
    
    return results;
}
```

### 3. Conversation History Preservation
```typescript
async function testHistoryPreservation() {
    // Start conversation with one provider
    robota.setModel({ provider: 'openai', model: 'gpt-3.5-turbo' });
    await robota.run('Hello, my name is Alice and I love cooking');
    
    // Switch provider and test memory
    robota.setModel({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' });
    const response = await robota.run('What did I tell you about myself?');
    
    // Verify history is preserved
    console.log('History preserved:', response.includes('Alice') || response.includes('cooking'));
    
    return response;
}
```

## Running the Examples

### Full Provider Switching Example

1. **Set up all API keys** in your `.env` file:
   ```env
   OPENAI_API_KEY=your_openai_key
   ANTHROPIC_API_KEY=your_anthropic_key
   GOOGLE_API_KEY=your_google_key
   ```

2. **Run the comprehensive example**:
   ```bash
   cd apps/examples
   bun run 01-basic/04-provider-switching.ts
   ```

### Simple Model Switching Example

1. **Ensure OpenAI API key is set**:
   ```env
   OPENAI_API_KEY=your_openai_key
   ```

2. **Run the simple example**:
   ```bash
   cd apps/examples
   bun run 01-basic/04-provider-switching-simple.ts
   ```

## Expected Output

### Multi-Provider Switching
```
===== Multi-Provider Switching Test =====

----- Testing OpenAI (gpt-3.5-turbo) -----
Response time: 1,234ms
OpenAI Response: Quantum computing is a revolutionary technology that uses the principles of quantum mechanics...

----- Testing Anthropic (claude-3-5-sonnet-20241022) -----
Response time: 2,156ms
Anthropic Response: Quantum computing represents a fundamentally different approach to processing information...

----- Testing Google (gemini-1.5-pro) -----
Response time: 1,876ms
Google Response: Imagine classical computers as very fast librarians who can only read one book at a time...

===== Conversation History Test =====
History preserved across provider switches: ✓

===== Performance Comparison =====
Provider Performance Ranking:
1. OpenAI: 1,234ms average
2. Google: 1,876ms average  
3. Anthropic: 2,156ms average
```

### Model Switching (OpenAI)
```
===== OpenAI Model Comparison Test =====

----- Testing gpt-3.5-turbo -----
Response time: 1,450ms
Word count: 245 words
Response: In a small workshop filled with the gentle hum of machinery...

----- Testing gpt-4 -----
Response time: 3,200ms
Word count: 387 words
Response: The fluorescent lights buzzed overhead as Unit-7 stood motionless...

----- Testing gpt-4o-mini -----
Response time: 980ms
Word count: 198 words
Response: Servo whirred to life in the art studio, sensors adjusting...

===== Model Performance Summary =====
Fastest: gpt-4o-mini (980ms)
Most detailed: gpt-4 (387 words)
Best balance: gpt-3.5-turbo (1,450ms, 245 words)
```

## Advanced Switching Patterns

### 1. Intelligent Provider Selection
```typescript
class IntelligentProviderSelector {
    private robota: Robota;
    private providerMetrics: Map<string, ProviderMetrics> = new Map();
    
    constructor(robota: Robota) {
        this.robota = robota;
    }
    
    async selectOptimalProvider(prompt: string, criteria: SelectionCriteria) {
        const candidates = await this.evaluateProviders(prompt, criteria);
        const best = this.rankProviders(candidates, criteria);
        
        if (best.provider !== this.robota.getCurrentAI().provider) {
            this.robota.setModel({ provider: best.provider, model: best.model });
            console.log(`Switched to optimal provider: ${best.provider}/${best.model}`);
        }
        
        return best;
    }
    
    private async evaluateProviders(prompt: string, criteria: SelectionCriteria) {
        const providers = Object.keys(this.robota.getAIProviders());
        const evaluations = [];
        
        for (const provider of providers) {
            const metrics = this.providerMetrics.get(provider);
            const score = this.calculateScore(metrics, criteria);
            
            evaluations.push({
                provider,
                model: this.getDefaultModel(provider),
                score,
                metrics
            });
        }
        
        return evaluations;
    }
    
    private calculateScore(metrics: ProviderMetrics, criteria: SelectionCriteria): number {
        let score = 0;
        
        // Weight factors based on criteria
        if (criteria.prioritizeSpeed) {
            score += (1000 / (metrics?.averageResponseTime || 2000)) * 0.4;
        }
        
        if (criteria.prioritizeQuality) {
            score += (metrics?.qualityRating || 0.5) * 0.4;
        }
        
        if (criteria.prioritizeCost) {
            score += (1 / (metrics?.averageCost || 0.01)) * 0.2;
        }
        
        return score;
    }
}

interface SelectionCriteria {
    prioritizeSpeed: boolean;
    prioritizeQuality: boolean;
    prioritizeCost: boolean;
    taskType?: 'creative' | 'analytical' | 'conversational';
}

interface ProviderMetrics {
    averageResponseTime: number;
    qualityRating: number;
    averageCost: number;
    successRate: number;
}
```

### 2. Fallback Chain Implementation
```typescript
class ProviderFallbackChain {
    private robota: Robota;
    private fallbackOrder: Array<{provider: string, model: string}>;
    
    constructor(robota: Robota, fallbackOrder: Array<{provider: string, model: string}>) {
        this.robota = robota;
        this.fallbackOrder = fallbackOrder;
    }
    
    async runWithFallback(prompt: string, maxRetries: number = 3): Promise<string> {
        let lastError: Error | null = null;
        
        for (const {provider, model} of this.fallbackOrder) {
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    console.log(`Attempting ${provider}/${model} (attempt ${attempt + 1})`);
                    
                    this.robota.setModel({ provider, model });
                    const response = await this.robota.run(prompt);
                    
                    console.log(`✓ Success with ${provider}/${model}`);
                    return response;
                    
                } catch (error) {
                    lastError = error;
                    console.warn(`✗ Failed with ${provider}/${model}:`, error.message);
                    
                    // Exponential backoff
                    if (attempt < maxRetries - 1) {
                        const delay = Math.pow(2, attempt) * 1000;
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
        }
        
        throw new Error(`All providers failed. Last error: ${lastError?.message}`);
    }
}

// Usage
const fallbackChain = new ProviderFallbackChain(robota, [
    { provider: 'openai', model: 'gpt-4' },
    { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    { provider: 'google', model: 'gemini-1.5-pro' },
    { provider: 'openai', model: 'gpt-3.5-turbo' } // Fallback to cheaper option
]);
```

### 3. A/B Testing Framework
```typescript
class ProviderABTester {
    private robota: Robota;
    private testResults: Map<string, ABTestResult[]> = new Map();
    
    constructor(robota: Robota) {
        this.robota = robota;
    }
    
    async runABTest(
        prompt: string,
        providerConfigs: Array<{name: string, provider: string, model: string}>,
        iterations: number = 5
    ) {
        const results: ABTestResults = {
            prompt,
            providers: {},
            summary: {}
        };
        
        for (const config of providerConfigs) {
            console.log(`\nTesting ${config.name}...`);
            const providerResults: ABTestResult[] = [];
            
            for (let i = 0; i < iterations; i++) {
                const startTime = Date.now();
                
                try {
                    this.robota.setModel({ provider: config.provider, model: config.model });
                    const response = await this.robota.run(prompt);
                    const responseTime = Date.now() - startTime;
                    
                    providerResults.push({
                        success: true,
                        responseTime,
                        response,
                        wordCount: response.split(' ').length,
                        iteration: i + 1
                    });
                    
                } catch (error) {
                    providerResults.push({
                        success: false,
                        responseTime: Date.now() - startTime,
                        error: error.message,
                        iteration: i + 1
                    });
                }
            }
            
            results.providers[config.name] = providerResults;
            results.summary[config.name] = this.calculateSummary(providerResults);
        }
        
        return results;
    }
    
    private calculateSummary(results: ABTestResult[]): ProviderSummary {
        const successful = results.filter(r => r.success);
        const responseTimes = successful.map(r => r.responseTime);
        const wordCounts = successful.map(r => r.wordCount || 0);
        
        return {
            successRate: successful.length / results.length,
            averageResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length || 0,
            medianResponseTime: this.median(responseTimes),
            averageWordCount: wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length || 0,
            totalTests: results.length
        };
    }
    
    private median(numbers: number[]): number {
        const sorted = numbers.sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }
}

interface ABTestResult {
    success: boolean;
    responseTime: number;
    response?: string;
    wordCount?: number;
    error?: string;
    iteration: number;
}

interface ProviderSummary {
    successRate: number;
    averageResponseTime: number;
    medianResponseTime: number;
    averageWordCount: number;
    totalTests: number;
}

interface ABTestResults {
    prompt: string;
    providers: Record<string, ABTestResult[]>;
    summary: Record<string, ProviderSummary>;
}
```

## Performance Analysis Patterns

### 1. Response Quality Evaluation
```typescript
class ResponseQualityEvaluator {
    async evaluateResponses(prompt: string, responses: Record<string, string>) {
        const evaluations = {};
        
        for (const [provider, response] of Object.entries(responses)) {
            evaluations[provider] = {
                length: response.length,
                wordCount: response.split(' ').length,
                sentenceCount: response.split(/[.!?]+/).length - 1,
                readabilityScore: this.calculateReadability(response),
                relevanceScore: await this.calculateRelevance(prompt, response),
                creativityScore: this.calculateCreativity(response)
            };
        }
        
        return evaluations;
    }
    
    private calculateReadability(text: string): number {
        // Simplified Flesch Reading Ease formula
        const sentences = text.split(/[.!?]+/).length - 1;
        const words = text.split(' ').length;
        const syllables = this.countSyllables(text);
        
        if (sentences === 0 || words === 0) return 0;
        
        const score = 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
        return Math.max(0, Math.min(100, score));
    }
    
    private countSyllables(text: string): number {
        // Simplified syllable counting
        return text.toLowerCase().match(/[aeiouy]+/g)?.length || 0;
    }
    
    private calculateCreativity(text: string): number {
        // Simple creativity metrics
        const uniqueWords = new Set(text.toLowerCase().split(/\W+/)).size;
        const totalWords = text.split(/\W+/).length;
        const metaphors = (text.match(/like|as|metaphor|imagine/gi) || []).length;
        
        return Math.min(100, (uniqueWords / totalWords) * 100 + metaphors * 5);
    }
    
    private async calculateRelevance(prompt: string, response: string): Promise<number> {
        // Simple keyword-based relevance (in production, use semantic similarity)
        const promptKeywords = new Set(prompt.toLowerCase().split(/\W+/));
        const responseKeywords = new Set(response.toLowerCase().split(/\W+/));
        
        const intersection = new Set([...promptKeywords].filter(x => responseKeywords.has(x)));
        return (intersection.size / promptKeywords.size) * 100;
    }
}
```

### 2. Cost-Performance Analysis
```typescript
class CostPerformanceAnalyzer {
    private static readonly PROVIDER_COSTS = {
        'openai': {
            'gpt-3.5-turbo': { input: 0.001, output: 0.002 },
            'gpt-4': { input: 0.03, output: 0.06 },
            'gpt-4o-mini': { input: 0.00015, output: 0.0006 }
        },
        'anthropic': {
            'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 }
        },
        'google': {
            'gemini-1.5-pro': { input: 0.0035, output: 0.0105 }
        }
    };
    
    calculateCostEfficiency(provider: string, model: string, inputTokens: number, outputTokens: number, responseTime: number, qualityScore: number) {
        const costs = CostPerformanceAnalyzer.PROVIDER_COSTS[provider]?.[model];
        if (!costs) return null;
        
        const totalCost = (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;
        const costPerSecond = totalCost / (responseTime / 1000);
        const costPerQualityPoint = totalCost / Math.max(qualityScore, 1);
        const efficiencyScore = (qualityScore / responseTime) * 1000; // Quality per millisecond
        
        return {
            totalCost,
            costPerSecond,
            costPerQualityPoint,
            efficiencyScore,
            costEfficiencyRatio: qualityScore / (totalCost * 1000) // Quality per dollar
        };
    }
    
    async analyzeCostPerformance(testResults: ABTestResults) {
        const analysis = {};
        
        for (const [providerName, results] of Object.entries(testResults.providers)) {
            const successfulResults = results.filter(r => r.success);
            if (successfulResults.length === 0) continue;
            
            // Estimate token usage (simplified)
            const avgInputTokens = testResults.prompt.split(' ').length * 1.3; // Rough estimate
            const avgOutputTokens = successfulResults.reduce((sum, r) => sum + (r.wordCount || 0), 0) / successfulResults.length * 1.3;
            
            const [provider, model] = providerName.split('/');
            const costAnalysis = this.calculateCostEfficiency(
                provider,
                model,
                avgInputTokens,
                avgOutputTokens,
                testResults.summary[providerName].averageResponseTime,
                80 // Placeholder quality score
            );
            
            analysis[providerName] = {
                ...testResults.summary[providerName],
                ...costAnalysis,
                estimatedTokens: { input: avgInputTokens, output: avgOutputTokens }
            };
        }
        
        return analysis;
    }
}
```

## Best Practices

### 1. Graceful Provider Switching
```typescript
async function safeProviderSwitch(robota: Robota, targetProvider: string, targetModel: string): Promise<boolean> {
    const currentAI = robota.getCurrentAI();
    
    try {
        // Test if provider is available
        const providers = Object.keys(robota.getAIProviders());
        if (!providers.includes(targetProvider)) {
            console.warn(`Provider ${targetProvider} not available`);
            return false;
        }
        
        // Attempt switch
        robota.setModel({ provider: targetProvider, model: targetModel });
        
        // Test with a simple request
        await robota.run('Test').catch(() => {
            // Revert on failure
            robota.setModel({ provider: currentAI.provider, model: currentAI.model });
            throw new Error('Provider test failed');
        });
        
        console.log(`✓ Successfully switched to ${targetProvider}/${targetModel}`);
        return true;
        
    } catch (error) {
        console.error(`✗ Failed to switch to ${targetProvider}/${targetModel}:`, error.message);
        return false;
    }
}
```

### 2. Context-Aware Switching
```typescript
class ContextAwareProvider {
    private robota: Robota;
    private taskProviderMap: Record<string, {provider: string, model: string}>;
    
    constructor(robota: Robota) {
        this.robota = robota;
        this.taskProviderMap = {
            'creative': { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
            'analytical': { provider: 'openai', model: 'gpt-4' },
            'quick': { provider: 'openai', model: 'gpt-3.5-turbo' },
            'coding': { provider: 'openai', model: 'gpt-4' },
            'conversation': { provider: 'google', model: 'gemini-1.5-pro' }
        };
    }
    
    async runWithContext(prompt: string, context: string = 'general') {
        const optimal = this.taskProviderMap[context];
        
        if (optimal) {
            const switched = await safeProviderSwitch(this.robota, optimal.provider, optimal.model);
            if (!switched) {
                console.warn(`Failed to switch to optimal provider for ${context}, using current`);
            }
        }
        
        return await this.robota.run(prompt);
    }
}
```

### 3. Performance Monitoring
```typescript
class ProviderPerformanceMonitor {
    private metrics: Map<string, PerformanceMetric[]> = new Map();
    
    recordPerformance(provider: string, model: string, responseTime: number, success: boolean, tokenCount?: number) {
        const key = `${provider}/${model}`;
        
        if (!this.metrics.has(key)) {
            this.metrics.set(key, []);
        }
        
        this.metrics.get(key)!.push({
            timestamp: Date.now(),
            responseTime,
            success,
            tokenCount
        });
        
        // Keep only last 100 measurements
        const measurements = this.metrics.get(key)!;
        if (measurements.length > 100) {
            measurements.splice(0, measurements.length - 100);
        }
    }
    
    getPerformanceReport(provider?: string): Record<string, ProviderStats> {
        const report: Record<string, ProviderStats> = {};
        
        for (const [key, measurements] of this.metrics.entries()) {
            if (provider && !key.startsWith(provider)) continue;
            
            const successful = measurements.filter(m => m.success);
            const failed = measurements.filter(m => !m.success);
            
            report[key] = {
                totalRequests: measurements.length,
                successfulRequests: successful.length,
                failedRequests: failed.length,
                successRate: successful.length / measurements.length,
                averageResponseTime: successful.reduce((sum, m) => sum + m.responseTime, 0) / successful.length || 0,
                medianResponseTime: this.median(successful.map(m => m.responseTime)),
                lastUpdated: Math.max(...measurements.map(m => m.timestamp))
            };
        }
        
        return report;
    }
    
    private median(numbers: number[]): number {
        if (numbers.length === 0) return 0;
        const sorted = numbers.sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }
}

interface PerformanceMetric {
    timestamp: number;
    responseTime: number;
    success: boolean;
    tokenCount?: number;
}

interface ProviderStats {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number;
    averageResponseTime: number;
    medianResponseTime: number;
    lastUpdated: number;
}
```

## Next Steps

After mastering provider switching, explore:

1. [**Conversation History**](./conversation-history.md) - Advanced history management
2. [**Token and Request Limits**](./token-limits.md) - Usage monitoring and optimization
3. [**Session Management**](./session-management.md) - Managing provider state across sessions

## Troubleshooting

### Switching Failures
- Verify all providers are properly initialized
- Check API keys and quotas for each provider
- Ensure model names are valid for each provider
- Test connectivity before switching

### Performance Issues
- Monitor response times and implement timeouts
- Use appropriate models for different task types
- Consider cost vs. performance trade-offs
- Implement proper error handling and retries

### History Preservation
- Verify conversation history is maintained across switches
- Test with different conversation lengths
- Monitor memory usage with long conversations
- Implement history limits for production use 