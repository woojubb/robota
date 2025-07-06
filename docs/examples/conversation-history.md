# Conversation History Management

This example demonstrates how to manage conversation history, implement memory limits, and handle multi-turn conversations effectively.

## Overview

The conversation history management example shows how to:
- Maintain conversation context across multiple interactions
- Implement memory limits and history pruning
- Test conversation history persistence
- Handle conversation serialization and deserialization
- Optimize memory usage for long conversations

## Source Code

**Location**: `apps/examples/01-basic/05-conversation-history-test.ts`

## Key Concepts

### 1. Basic History Management
```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';

const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentModel: 'gpt-3.5-turbo',
    maxHistoryLength: 10,  // Keep last 10 messages
    systemPrompt: 'You are a helpful assistant with memory of our conversation.'
});

// Sequential conversation with memory
await robota.run('Hello, my name is Alice');
await robota.run('I work as a software engineer');
const response = await robota.run('What do you remember about me?');
// AI should remember the name and profession
```

### 2. History Persistence Testing
```typescript
async function testHistoryPersistence() {
    console.log('Testing conversation history persistence...');
    
    // Build conversation context
    await robota.run('I am planning a trip to Japan');
    await robota.run('I want to visit Tokyo and Kyoto');
    await robota.run('My budget is $3000');
    
    // Test memory retention
    const response = await robota.run('Can you summarize my travel plans?');
    
    // Verify AI remembers all the details
    const remembersDestination = response.toLowerCase().includes('japan');
    const remembersCities = response.toLowerCase().includes('tokyo') && response.toLowerCase().includes('kyoto');
    const remembersBudget = response.includes('3000');
    
    console.log('Memory test results:', {
        remembersDestination,
        remembersCities,
        remembersBudget,
        overallScore: [remembersDestination, remembersCities, remembersBudget].filter(Boolean).length
    });
    
    return response;
}
```

### 3. History Limits and Memory Management
```typescript
async function testHistoryLimits() {
    console.log('Testing history limits...');
    
    // Create instance with small history limit
    const limitedRobota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentModel: 'gpt-3.5-turbo',
        maxHistoryLength: 3,  // Very small limit for testing
        systemPrompt: 'Remember our conversation within your memory limits.'
    });
    
    // Add many messages to exceed limit
    const topics = ['dogs', 'cats', 'birds', 'fish', 'hamsters'];
    
    for (let i = 0; i < topics.length; i++) {
        await limitedRobota.run(`I love ${topics[i]}. They are my favorite pet #${i + 1}.`);
    }
    
    // Test what AI remembers (should only remember recent items)
    const response = await limitedRobota.run('What pets did I mention?');
    
    console.log('History limit test response:', response);
    
    // Should remember recent topics but not the earliest ones
    return response;
}
```

## Running the Example

1. **Ensure setup is complete** (see [Setup Guide](./setup.md))

2. **Navigate to examples directory**:
   ```bash
   cd apps/examples
   ```

3. **Run the conversation history test**:
   ```bash
   # Using bun (recommended)
   bun run 01-basic/05-conversation-history-test.ts
   
   # Using pnpm + tsx
   pnpm tsx 01-basic/05-conversation-history-test.ts
   ```

## Expected Output

```
===== Conversation History Management Test =====

----- Basic Memory Test -----
User: Hello, my name is Alice
AI: Hello Alice! Nice to meet you. How can I help you today?

User: I work as a software engineer
AI: That's great, Alice! Software engineering is an exciting field...

User: What do you remember about me?
AI: I remember that your name is Alice and you work as a software engineer...

✓ Basic memory test passed

----- Travel Planning Memory Test -----
Testing conversation history persistence...

User: I am planning a trip to Japan
AI: How exciting! Japan is a wonderful destination...

User: I want to visit Tokyo and Kyoto
AI: Excellent choices! Tokyo and Kyoto offer very different experiences...

User: My budget is $3000
AI: With a $3000 budget, you should be able to have a great trip to Tokyo and Kyoto...

User: Can you summarize my travel plans?
AI: Based on our conversation, you're planning a trip to Japan with a $3000 budget, specifically wanting to visit Tokyo and Kyoto...

Memory test results: {
  remembersDestination: true,
  remembersCities: true,
  remembersBudget: true,
  overallScore: 3
}

✓ Travel planning memory test passed

----- History Limits Test -----
Testing history limits...

User: I love dogs. They are my favorite pet #1.
User: I love cats. They are my favorite pet #2.
User: I love birds. They are my favorite pet #3.
User: I love fish. They are my favorite pet #4.
User: I love hamsters. They are my favorite pet #5.

User: What pets did I mention?
AI: From our recent conversation, I can see you mentioned birds, fish, and hamsters as pets you love...

✓ History limits working correctly (forgot earlier mentions)

===== Conversation History Tests Completed =====
```

## Advanced History Management

### 1. Custom History Strategies
```typescript
interface HistoryStrategy {
    shouldKeepMessage(message: any, index: number, allMessages: any[]): boolean;
    pruneHistory(messages: any[]): any[];
}

class SlidingWindowStrategy implements HistoryStrategy {
    constructor(private maxMessages: number) {}
    
    shouldKeepMessage(message: any, index: number, allMessages: any[]): boolean {
        return index >= allMessages.length - this.maxMessages;
    }
    
    pruneHistory(messages: any[]): any[] {
        return messages.slice(-this.maxMessages);
    }
}

class ImportanceBasedStrategy implements HistoryStrategy {
    constructor(private maxMessages: number) {}
    
    shouldKeepMessage(message: any, index: number, allMessages: any[]): boolean {
        // Keep system messages and recent messages
        if (message.role === 'system') return true;
        if (index >= allMessages.length - Math.floor(this.maxMessages / 2)) return true;
        
        // Keep messages with important keywords
        const importantKeywords = ['name', 'important', 'remember', 'budget', 'deadline'];
        const hasImportantKeyword = importantKeywords.some(keyword => 
            message.content?.toLowerCase().includes(keyword)
        );
        
        return hasImportantKeyword;
    }
    
    pruneHistory(messages: any[]): any[] {
        const kept = messages.filter((msg, index) => 
            this.shouldKeepMessage(msg, index, messages)
        );
        
        // If still too many, keep most recent
        return kept.length > this.maxMessages 
            ? kept.slice(-this.maxMessages)
            : kept;
    }
}

class SmartHistoryManager {
    private strategy: HistoryStrategy;
    
    constructor(strategy: HistoryStrategy) {
        this.strategy = strategy;
    }
    
    manageHistory(currentHistory: any[]): any[] {
        return this.strategy.pruneHistory(currentHistory);
    }
    
    setStrategy(newStrategy: HistoryStrategy) {
        this.strategy = newStrategy;
    }
}

// Usage
const historyManager = new SmartHistoryManager(
    new ImportanceBasedStrategy(10)
);

const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentModel: 'gpt-3.5-turbo',
    historyManager: historyManager,
    systemPrompt: 'You are an assistant with smart memory management.'
});
```

### 2. Conversation Summarization
```typescript
class ConversationSummarizer {
    private robota: Robota;
    
    constructor(robota: Robota) {
        this.robota = robota;
    }
    
    async summarizeConversation(messages: any[]): Promise<string> {
        // Extract key conversation points
        const conversationText = messages
            .filter(msg => msg.role !== 'system')
            .map(msg => `${msg.role}: ${msg.content}`)
            .join('\n');
        
        const summaryPrompt = `
Please provide a concise summary of this conversation, focusing on:
1. Key facts mentioned by the user
2. Important decisions or preferences
3. Action items or next steps

Conversation:
${conversationText}

Summary:`;
        
        return await this.robota.run(summaryPrompt);
    }
    
    async createContextualSummary(messages: any[], maxSummaryLength: number = 200): Promise<string> {
        const summary = await this.summarizeConversation(messages);
        
        // Truncate if too long
        if (summary.length > maxSummaryLength) {
            return summary.substring(0, maxSummaryLength - 3) + '...';
        }
        
        return summary;
    }
}

class SummarizingHistoryStrategy implements HistoryStrategy {
    private summarizer: ConversationSummarizer;
    private maxMessages: number;
    private summaryInterval: number;
    
    constructor(summarizer: ConversationSummarizer, maxMessages: number = 10, summaryInterval: number = 20) {
        this.summarizer = summarizer;
        this.maxMessages = maxMessages;
        this.summaryInterval = summaryInterval;
    }
    
    shouldKeepMessage(message: any, index: number, allMessages: any[]): boolean {
        // Always keep recent messages
        return index >= allMessages.length - this.maxMessages;
    }
    
    async pruneHistory(messages: any[]): Promise<any[]> {
        if (messages.length <= this.maxMessages) {
            return messages;
        }
        
        // Get older messages to summarize
        const oldMessages = messages.slice(0, messages.length - this.maxMessages);
        const recentMessages = messages.slice(-this.maxMessages);
        
        // Create summary of old messages
        if (oldMessages.length >= this.summaryInterval) {
            const summary = await this.summarizer.createContextualSummary(oldMessages);
            
            // Replace old messages with summary
            const summaryMessage = {
                role: 'system',
                content: `Previous conversation summary: ${summary}`,
                timestamp: new Date().toISOString(),
                type: 'summary'
            };
            
            return [summaryMessage, ...recentMessages];
        }
        
        return messages;
    }
}
```

### 3. Contextual Memory Search
```typescript
class ContextualMemory {
    private memories: Array<{
        content: string;
        timestamp: Date;
        importance: number;
        keywords: string[];
        context: string;
    }> = [];
    
    addMemory(content: string, importance: number = 1, context: string = 'general') {
        const keywords = this.extractKeywords(content);
        
        this.memories.push({
            content,
            timestamp: new Date(),
            importance,
            keywords,
            context
        });
        
        // Keep memories sorted by importance and recency
        this.memories.sort((a, b) => {
            const importanceScore = b.importance - a.importance;
            if (Math.abs(importanceScore) < 0.1) {
                return b.timestamp.getTime() - a.timestamp.getTime();
            }
            return importanceScore;
        });
        
        // Limit memory size
        if (this.memories.length > 100) {
            this.memories = this.memories.slice(0, 100);
        }
    }
    
    searchMemories(query: string, context?: string, limit: number = 5): Array<any> {
        const queryKeywords = this.extractKeywords(query);
        
        return this.memories
            .filter(memory => {
                // Filter by context if specified
                if (context && memory.context !== context) return false;
                
                // Check keyword overlap
                const keywordOverlap = memory.keywords.filter(keyword =>
                    queryKeywords.some(qk => qk.includes(keyword) || keyword.includes(qk))
                ).length;
                
                return keywordOverlap > 0;
            })
            .sort((a, b) => {
                // Score based on keyword relevance and importance
                const aScore = this.calculateRelevanceScore(a, queryKeywords);
                const bScore = this.calculateRelevanceScore(b, queryKeywords);
                return bScore - aScore;
            })
            .slice(0, limit);
    }
    
    private extractKeywords(text: string): string[] {
        // Simple keyword extraction (in production, use NLP library)
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 3)
            .filter(word => !['this', 'that', 'with', 'have', 'will', 'been', 'from'].includes(word));
    }
    
    private calculateRelevanceScore(memory: any, queryKeywords: string[]): number {
        const keywordOverlap = memory.keywords.filter(keyword =>
            queryKeywords.some(qk => qk.includes(keyword) || keyword.includes(qk))
        ).length;
        
        const keywordScore = keywordOverlap / Math.max(memory.keywords.length, queryKeywords.length);
        const importanceScore = memory.importance;
        const recencyScore = (Date.now() - memory.timestamp.getTime()) / (1000 * 60 * 60 * 24); // Days old
        
        return keywordScore * 0.5 + importanceScore * 0.3 + (1 / (1 + recencyScore)) * 0.2;
    }
    
    getMemoryStats() {
        const contexts = [...new Set(this.memories.map(m => m.context))];
        const avgImportance = this.memories.reduce((sum, m) => sum + m.importance, 0) / this.memories.length;
        
        return {
            totalMemories: this.memories.length,
            contexts: contexts,
            averageImportance: avgImportance,
            oldestMemory: this.memories.length > 0 
                ? Math.min(...this.memories.map(m => m.timestamp.getTime()))
                : null,
            newestMemory: this.memories.length > 0
                ? Math.max(...this.memories.map(m => m.timestamp.getTime()))
                : null
        };
    }
}

// Integration with Robota
class MemoryEnhancedRobota extends Robota {
    private contextualMemory: ContextualMemory;
    
    constructor(config: any) {
        super(config);
        this.contextualMemory = new ContextualMemory();
    }
    
    async run(prompt: string, context?: string): Promise<string> {
        // Search for relevant memories
        const relevantMemories = this.contextualMemory.searchMemories(prompt, context);
        
        // Enhance prompt with relevant context
        let enhancedPrompt = prompt;
        if (relevantMemories.length > 0) {
            const memoryContext = relevantMemories
                .map(m => m.content)
                .join('\n');
            
            enhancedPrompt = `Context from previous conversations:\n${memoryContext}\n\nCurrent request: ${prompt}`;
        }
        
        // Get AI response
        const response = await super.run(enhancedPrompt);
        
        // Store interaction in memory
        this.contextualMemory.addMemory(
            `User asked: ${prompt}\nAssistant responded: ${response}`,
            this.calculateImportance(prompt, response),
            context || 'general'
        );
        
        return response;
    }
    
    private calculateImportance(prompt: string, response: string): number {
        // Simple importance calculation
        const importantKeywords = ['important', 'remember', 'name', 'password', 'meeting', 'deadline', 'budget'];
        const hasImportantKeywords = importantKeywords.some(keyword =>
            prompt.toLowerCase().includes(keyword) || response.toLowerCase().includes(keyword)
        );
        
        const isQuestion = prompt.includes('?');
        const isLongResponse = response.length > 200;
        
        let importance = 1.0;
        if (hasImportantKeywords) importance += 0.5;
        if (isQuestion) importance += 0.2;
        if (isLongResponse) importance += 0.3;
        
        return Math.min(importance, 3.0); // Cap at 3.0
    }
    
    getMemoryStats() {
        return this.contextualMemory.getMemoryStats();
    }
    
    searchMemory(query: string, context?: string) {
        return this.contextualMemory.searchMemories(query, context);
    }
}
```

## Performance Optimization

### 1. Efficient History Storage
```typescript
class OptimizedHistoryManager {
    private compressionThreshold: number = 1000; // chars
    
    compressMessage(message: any): any {
        if (message.content.length < this.compressionThreshold) {
            return message;
        }
        
        // Simple compression - extract key information
        const keyPhrases = this.extractKeyPhrases(message.content);
        
        return {
            ...message,
            content: keyPhrases.join('. '),
            originalLength: message.content.length,
            compressed: true
        };
    }
    
    private extractKeyPhrases(text: string): string[] {
        // Extract sentences with important keywords
        const sentences = text.split(/[.!?]+/);
        const importantKeywords = ['name', 'important', 'remember', 'budget', 'deadline', 'meeting'];
        
        return sentences
            .filter(sentence => 
                importantKeywords.some(keyword => 
                    sentence.toLowerCase().includes(keyword)
                ) || sentence.length < 100
            )
            .slice(0, 3); // Keep max 3 key phrases
    }
    
    estimateTokenCount(messages: any[]): number {
        // Rough estimation: 1 token ≈ 4 characters
        const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
        return Math.ceil(totalChars / 4);
    }
    
    optimizeForTokenLimit(messages: any[], maxTokens: number): any[] {
        let currentTokens = this.estimateTokenCount(messages);
        
        if (currentTokens <= maxTokens) {
            return messages;
        }
        
        // Start removing oldest non-system messages
        const optimized = [...messages];
        
        while (currentTokens > maxTokens && optimized.length > 1) {
            // Find oldest non-system message
            const oldestIndex = optimized.findIndex((msg, idx) => 
                idx > 0 && msg.role !== 'system'
            );
            
            if (oldestIndex !== -1) {
                optimized.splice(oldestIndex, 1);
                currentTokens = this.estimateTokenCount(optimized);
            } else {
                break;
            }
        }
        
        return optimized;
    }
}
```

### 2. Lazy Loading and Pagination
```typescript
class PaginatedHistoryManager {
    private pageSize: number = 10;
    private currentPage: number = 0;
    private totalMessages: any[] = [];
    
    addMessage(message: any) {
        this.totalMessages.push(message);
    }
    
    getCurrentPage(): any[] {
        const start = this.currentPage * this.pageSize;
        const end = start + this.pageSize;
        return this.totalMessages.slice(start, end);
    }
    
    getRecentMessages(count: number = 10): any[] {
        return this.totalMessages.slice(-count);
    }
    
    searchMessages(query: string): any[] {
        return this.totalMessages.filter(msg =>
            msg.content?.toLowerCase().includes(query.toLowerCase())
        );
    }
    
    nextPage(): boolean {
        const maxPage = Math.ceil(this.totalMessages.length / this.pageSize) - 1;
        if (this.currentPage < maxPage) {
            this.currentPage++;
            return true;
        }
        return false;
    }
    
    previousPage(): boolean {
        if (this.currentPage > 0) {
            this.currentPage--;
            return true;
        }
        return false;
    }
    
    getPageInfo() {
        const totalPages = Math.ceil(this.totalMessages.length / this.pageSize);
        return {
            currentPage: this.currentPage,
            totalPages,
            totalMessages: this.totalMessages.length,
            hasNext: this.currentPage < totalPages - 1,
            hasPrevious: this.currentPage > 0
        };
    }
}
```

## Best Practices

### 1. Memory-Efficient Conversation Management
```typescript
// Configure appropriate history limits
const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentModel: 'gpt-3.5-turbo',
    maxHistoryLength: 20,          // Keep reasonable history
    maxHistoryTokens: 4000,        // Respect token limits
    historyPruningStrategy: 'smart', // Use intelligent pruning
    systemPrompt: 'You are a helpful assistant with good memory management.'
});
```

### 2. Context Preservation
```typescript
async function preserveImportantContext(robota: Robota, userMessage: string) {
    // Check if message contains important information
    const importantPatterns = [
        /my name is (\w+)/i,
        /i work as (.+)/i,
        /my budget is (.+)/i,
        /remember that (.+)/i
    ];
    
    const hasImportantInfo = importantPatterns.some(pattern => 
        pattern.test(userMessage)
    );
    
    if (hasImportantInfo) {
        // Mark this message as high importance
        await robota.run(userMessage, { importance: 'high' });
    } else {
        await robota.run(userMessage);
    }
}
```

### 3. History Serialization
```typescript
class SerializableHistoryManager {
    serializeHistory(messages: any[]): string {
        const serializable = messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            importance: msg.importance || 1
        }));
        
        return JSON.stringify(serializable);
    }
    
    deserializeHistory(serialized: string): any[] {
        try {
            return JSON.parse(serialized);
        } catch (error) {
            console.error('Failed to deserialize history:', error);
            return [];
        }
    }
    
    saveToStorage(messages: any[], key: string = 'conversation_history') {
        const serialized = this.serializeHistory(messages);
        localStorage.setItem(key, serialized);
    }
    
    loadFromStorage(key: string = 'conversation_history'): any[] {
        const serialized = localStorage.getItem(key);
        return serialized ? this.deserializeHistory(serialized) : [];
    }
}
```

## Next Steps

After mastering conversation history management, explore:

1. [**Token and Request Limits**](./token-limits.md) - Managing usage and costs
2. [**Session Management**](./session-management.md) - Multi-session conversation management
3. [**Provider Switching**](./provider-switching.md) - History preservation across providers

## Troubleshooting

### Memory Issues
- Monitor conversation length and token usage
- Implement appropriate history limits
- Use compression for long conversations
- Consider conversation summarization

### Context Loss
- Verify history retention settings
- Check for proper message serialization
- Test with different conversation lengths
- Implement importance-based retention

### Performance Problems
- Optimize history storage and retrieval
- Use efficient data structures
- Implement lazy loading for large histories
- Monitor memory usage patterns 