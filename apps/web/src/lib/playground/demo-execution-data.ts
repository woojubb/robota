import type { PlaygroundBlockCollector } from './block-tracking/block-collector';
import type { RealTimeBlockMessage, RealTimeBlockMetadata } from './block-tracking/types';

/**
 * Generate demo execution data for testing the tree visualization
 */
export function generateDemoExecutionData(blockCollector: PlaygroundBlockCollector): void {
    console.log('🎬 Generating demo execution data...');

    const now = new Date();

    // Clear existing blocks
    blockCollector.clearBlocks();

    // 1. Root level - User message
    const userMessage: RealTimeBlockMessage = {
        role: 'user',
        content: 'Compare React vs Vue for a new project and search for recent performance benchmarks',
        timestamp: new Date(now.getTime()),
        blockMetadata: {
            id: 'user_001',
            type: 'user',
            level: 0,
            parentId: undefined,
            children: ['team_001'],
            isExpanded: true,
            visualState: 'completed',
            startTime: new Date(now.getTime()),
            endTime: new Date(now.getTime() + 100),
            actualDuration: 100,
            executionContext: {
                timestamp: new Date(now.getTime())
            }
        }
    };

    // 2. Team level execution
    const teamExecution: RealTimeBlockMessage = {
        role: 'system',
        content: 'Team execution started - Processing comparison request',
        timestamp: new Date(now.getTime() + 200),
        blockMetadata: {
            id: 'team_001',
            type: 'group',
            level: 0,
            parentId: 'user_001',
            children: ['agent_001'],
            isExpanded: true,
            visualState: 'completed',
            startTime: new Date(now.getTime() + 200),
            endTime: new Date(now.getTime() + 15000),
            actualDuration: 14800,
            executionHierarchy: {
                level: 0,
                path: ['team'],
                rootExecutionId: 'team_001'
            },
            executionContext: {
                executionId: 'team_001',
                timestamp: new Date(now.getTime() + 200)
            }
        }
    };

    // 3. Agent level execution
    const agentExecution: RealTimeBlockMessage = {
        role: 'assistant',
        content: 'Agent processing: I need to research both frameworks and find recent benchmarks',
        timestamp: new Date(now.getTime() + 500),
        blockMetadata: {
            id: 'agent_001',
            type: 'assistant',
            level: 1,
            parentId: 'team_001',
            children: ['tool_001', 'tool_002'],
            isExpanded: true,
            visualState: 'completed',
            startTime: new Date(now.getTime() + 500),
            endTime: new Date(now.getTime() + 14500),
            actualDuration: 14000,
            executionHierarchy: {
                parentExecutionId: 'team_001',
                rootExecutionId: 'team_001',
                level: 1,
                path: ['team', 'agent']
            },
            executionContext: {
                agentId: 'research_agent',
                executionId: 'agent_001',
                timestamp: new Date(now.getTime() + 500)
            }
        }
    };

    // 4. First tool - Web search for React vs Vue
    const webSearchTool: RealTimeBlockMessage = {
        role: 'tool',
        content: 'Executing webSearch tool for React vs Vue comparison',
        timestamp: new Date(now.getTime() + 1000),
        blockMetadata: {
            id: 'tool_001',
            type: 'tool_call',
            level: 2,
            parentId: 'agent_001',
            children: ['tool_result_001'],
            isExpanded: true,
            visualState: 'completed',
            startTime: new Date(now.getTime() + 1000),
            endTime: new Date(now.getTime() + 6000),
            actualDuration: 5000,
            toolParameters: {
                query: 'React vs Vue 2024 performance comparison',
                maxResults: 10
            },
            toolResult: {
                results: [
                    { title: 'React vs Vue Performance 2024', url: 'https://example.com/react-vue-2024' },
                    { title: 'Framework Benchmark Analysis', url: 'https://example.com/benchmark' }
                ],
                totalFound: 15
            },
            executionHierarchy: {
                parentExecutionId: 'agent_001',
                rootExecutionId: 'team_001',
                level: 2,
                path: ['team', 'agent', 'webSearch']
            },
            executionContext: {
                toolName: 'webSearch',
                executionId: 'tool_001',
                timestamp: new Date(now.getTime() + 1000),
                duration: 5000
            },
            renderData: {
                parameters: {
                    query: 'React vs Vue 2024 performance comparison',
                    maxResults: 10
                }
            },
            toolProvidedData: {
                estimatedDuration: 4500,
                executionSteps: [
                    { id: 'query', name: 'Processing Query', estimatedDuration: 500 },
                    { id: 'search', name: 'Web Search', estimatedDuration: 3000 },
                    { id: 'parse', name: 'Parsing Results', estimatedDuration: 1000 }
                ],
                currentStep: 'completed',
                progress: 100
            }
        }
    };

    // 5. Second tool - Performance benchmarks search
    const benchmarkSearchTool: RealTimeBlockMessage = {
        role: 'tool',
        content: 'Executing webSearch tool for performance benchmarks',
        timestamp: new Date(now.getTime() + 7000),
        blockMetadata: {
            id: 'tool_002',
            type: 'tool_call',
            level: 2,
            parentId: 'agent_001',
            children: ['tool_result_002'],
            isExpanded: true,
            visualState: 'completed',
            startTime: new Date(now.getTime() + 7000),
            endTime: new Date(now.getTime() + 12000),
            actualDuration: 5000,
            toolParameters: {
                query: 'JavaScript framework performance benchmarks 2024',
                maxResults: 5
            },
            toolResult: {
                results: [
                    { title: 'JS Framework Benchmarks 2024', url: 'https://example.com/js-benchmarks' },
                    { title: 'Performance Test Results', url: 'https://example.com/perf-tests' }
                ],
                totalFound: 8
            },
            executionHierarchy: {
                parentExecutionId: 'agent_001',
                rootExecutionId: 'team_001',
                level: 2,
                path: ['team', 'agent', 'webSearch']
            },
            executionContext: {
                toolName: 'webSearch',
                executionId: 'tool_002',
                timestamp: new Date(now.getTime() + 7000),
                duration: 5000
            },
            renderData: {
                parameters: {
                    query: 'JavaScript framework performance benchmarks 2024',
                    maxResults: 5
                }
            },
            toolProvidedData: {
                estimatedDuration: 4800,
                executionSteps: [
                    { id: 'query', name: 'Processing Query', estimatedDuration: 500 },
                    { id: 'search', name: 'Web Search', estimatedDuration: 3300 },
                    { id: 'parse', name: 'Parsing Results', estimatedDuration: 1000 }
                ],
                currentStep: 'completed',
                progress: 100
            }
        }
    };

    // 6. Final LLM response
    const finalResponse: RealTimeBlockMessage = {
        role: 'assistant',
        content: `Based on my research, here's a comprehensive comparison of React vs Vue for 2024:

**Performance:**
- React: Excellent performance with concurrent features and Suspense
- Vue: Outstanding performance with Composition API and optimized reactivity

**Learning Curve:**
- React: Steeper learning curve, more concepts to master
- Vue: Gentler learning curve, more approachable for beginners

**Ecosystem:**
- React: Vast ecosystem, more job opportunities
- Vue: Growing ecosystem, excellent documentation

**Recent Benchmarks (2024):**
- Both frameworks show similar performance in most scenarios
- Vue edges out slightly in memory usage
- React performs better in complex state management scenarios

I recommend React for larger teams and complex applications, Vue for smaller projects and teams preferring simplicity.`,
        timestamp: new Date(now.getTime() + 13000),
        blockMetadata: {
            id: 'llm_response_001',
            type: 'assistant',
            level: 1,
            parentId: 'agent_001',
            children: [],
            isExpanded: true,
            visualState: 'completed',
            startTime: new Date(now.getTime() + 13000),
            endTime: new Date(now.getTime() + 14500),
            actualDuration: 1500,
            executionHierarchy: {
                parentExecutionId: 'agent_001',
                rootExecutionId: 'team_001',
                level: 1,
                path: ['team', 'agent', 'llm_response']
            },
            executionContext: {
                agentId: 'research_agent',
                executionId: 'llm_response_001',
                timestamp: new Date(now.getTime() + 13000),
                duration: 1500
            },
            renderData: {
                reasoning: 'Final LLM response synthesis',
                parameters: {
                    model: 'gpt-4',
                    tokensUsed: 1250
                }
            }
        }
    };

    // Add all blocks to collector
    [
        userMessage,
        teamExecution,
        agentExecution,
        webSearchTool,
        benchmarkSearchTool,
        finalResponse
    ].forEach(block => {
        blockCollector.collectBlock(block);
    });

    console.log('✅ Demo execution data generated successfully!');
    console.log(`📊 Created ${6} blocks with hierarchical relationships`);
}

/**
 * Generate a second demo scenario - Complex multi-tool execution
 */
export function generateComplexDemoData(blockCollector: PlaygroundBlockCollector): void {
    console.log('🎬 Generating complex demo execution data...');

    const now = new Date();
    blockCollector.clearBlocks();

    // More complex scenario with deeper nesting and multiple assignTask calls
    // This will generate the structure shown in SIMPLIFIED-TEAM-EVENTS-PLAN.md

    // ... (Implementation would follow the structure from the documentation)

    console.log('✅ Complex demo data generation complete!');
} 