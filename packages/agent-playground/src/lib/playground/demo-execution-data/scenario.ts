import type { IRealTimeBlockMessage } from '../block-tracking/types';
import { DEMO_TIMELINE_OFFSETS_MS } from './offsets';

export function createDemoExecutionBlocks(now: Date): IRealTimeBlockMessage[] {
  const userMessage: IRealTimeBlockMessage = {
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
      endTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.userEnd),
      actualDuration: DEMO_TIMELINE_OFFSETS_MS.userEnd,
      executionContext: {
        timestamp: new Date(now.getTime()),
      },
    },
  };

  const teamExecution: IRealTimeBlockMessage = {
    role: 'system',
    content: 'Team execution started - Processing comparison request',
    timestamp: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.teamStart),
    blockMetadata: {
      id: 'team_001',
      type: 'group',
      level: 0,
      parentId: 'user_001',
      children: ['agent_001'],
      isExpanded: true,
      visualState: 'completed',
      startTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.teamStart),
      endTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.teamEnd),
      actualDuration: 14800,
      executionHierarchy: {
        level: 0,
        path: ['team'],
        rootExecutionId: 'team_001',
      },
      executionContext: {
        executionId: 'team_001',
        timestamp: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.teamStart),
      },
    },
  };

  const agentExecution: IRealTimeBlockMessage = {
    role: 'assistant',
    content: 'Agent processing: I need to research both frameworks and find recent benchmarks',
    timestamp: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.agentStart),
    blockMetadata: {
      id: 'agent_001',
      type: 'assistant',
      level: 1,
      parentId: 'team_001',
      children: ['tool_001', 'tool_002'],
      isExpanded: true,
      visualState: 'completed',
      startTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.agentStart),
      endTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.agentEnd),
      actualDuration: 14000,
      executionHierarchy: {
        parentExecutionId: 'team_001',
        rootExecutionId: 'team_001',
        level: 1,
        path: ['team', 'agent'],
      },
      executionContext: {
        agentId: 'research_agent',
        executionId: 'agent_001',
        timestamp: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.agentStart),
      },
    },
  };

  const webSearchTool: IRealTimeBlockMessage = {
    role: 'tool',
    content: 'Executing webSearch tool for React vs Vue comparison',
    timestamp: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.tool1Start),
    blockMetadata: {
      id: 'tool_001',
      type: 'tool_call',
      level: 2,
      parentId: 'agent_001',
      children: ['tool_result_001'],
      isExpanded: true,
      visualState: 'completed',
      startTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.tool1Start),
      endTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.tool1End),
      actualDuration: 5000,
      toolParameters: {
        query: 'React vs Vue 2024 performance comparison',
        maxResults: 10,
      },
      toolResult: {
        results: [
          { title: 'React vs Vue Performance 2024', url: 'https://example.com/react-vue-2024' },
          { title: 'Framework Benchmark Analysis', url: 'https://example.com/benchmark' },
        ],
        totalFound: 15,
      },
      executionHierarchy: {
        parentExecutionId: 'agent_001',
        rootExecutionId: 'team_001',
        level: 2,
        path: ['team', 'agent', 'webSearch'],
      },
      executionContext: {
        toolName: 'webSearch',
        executionId: 'tool_001',
        timestamp: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.tool1Start),
        duration: 5000,
      },
      renderData: {
        parameters: {
          query: 'React vs Vue 2024 performance comparison',
          maxResults: 10,
        },
      },
      toolProvidedData: {
        estimatedDuration: 4500,
        executionSteps: [
          { id: 'query', name: 'Processing Query', estimatedDuration: 500 },
          { id: 'search', name: 'Web Search', estimatedDuration: 3000 },
          { id: 'parse', name: 'Parsing Results', estimatedDuration: 1000 },
        ],
        currentStep: 'completed',
        progress: 100,
      },
    },
  };

  const benchmarkSearchTool: IRealTimeBlockMessage = {
    role: 'tool',
    content: 'Executing webSearch tool for performance benchmarks',
    timestamp: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.tool2Start),
    blockMetadata: {
      id: 'tool_002',
      type: 'tool_call',
      level: 2,
      parentId: 'agent_001',
      children: ['tool_result_002'],
      isExpanded: true,
      visualState: 'completed',
      startTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.tool2Start),
      endTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.tool2End),
      actualDuration: 5000,
      toolParameters: {
        query: 'JavaScript framework performance benchmarks 2024',
        maxResults: 5,
      },
      toolResult: {
        results: [
          { title: 'JS Framework Benchmarks 2024', url: 'https://example.com/js-benchmarks' },
          { title: 'Performance Test Results', url: 'https://example.com/perf-tests' },
        ],
        totalFound: 8,
      },
      executionHierarchy: {
        parentExecutionId: 'agent_001',
        rootExecutionId: 'team_001',
        level: 2,
        path: ['team', 'agent', 'webSearch'],
      },
      executionContext: {
        toolName: 'webSearch',
        executionId: 'tool_002',
        timestamp: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.tool2Start),
        duration: 5000,
      },
      renderData: {
        parameters: {
          query: 'JavaScript framework performance benchmarks 2024',
          maxResults: 5,
        },
      },
      toolProvidedData: {
        estimatedDuration: 4800,
        executionSteps: [
          { id: 'query', name: 'Processing Query', estimatedDuration: 500 },
          { id: 'search', name: 'Web Search', estimatedDuration: 3300 },
          { id: 'parse', name: 'Parsing Results', estimatedDuration: 1000 },
        ],
        currentStep: 'completed',
        progress: 100,
      },
    },
  };

  const finalResponse: IRealTimeBlockMessage = {
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
    timestamp: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.llmStart),
    blockMetadata: {
      id: 'llm_response_001',
      type: 'assistant',
      level: 1,
      parentId: 'agent_001',
      children: [],
      isExpanded: true,
      visualState: 'completed',
      startTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.llmStart),
      endTime: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.llmEnd),
      actualDuration: 1500,
      executionHierarchy: {
        parentExecutionId: 'agent_001',
        rootExecutionId: 'team_001',
        level: 1,
        path: ['team', 'agent', 'llm_response'],
      },
      executionContext: {
        agentId: 'research_agent',
        executionId: 'llm_response_001',
        timestamp: new Date(now.getTime() + DEMO_TIMELINE_OFFSETS_MS.llmStart),
        duration: 1500,
      },
      renderData: {
        reasoning: 'Final LLM response synthesis',
        parameters: {
          model: 'gpt-4',
          tokensUsed: 1250,
        },
      },
    },
  };

  return [
    userMessage,
    teamExecution,
    agentExecution,
    webSearchTool,
    benchmarkSearchTool,
    finalResponse,
  ];
}
