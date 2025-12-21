import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { Robota, FunctionTool } from '@robota-sdk/agents';
import type { AIProvider, EventService, OwnerPathSegment, ToolExecutionContext, ToolParameters, ToolExecutionData, ToolSchema } from '@robota-sdk/agents';
import { DefaultConsoleLogger } from '@robota-sdk/agents';
import { WorkflowEventSubscriber } from '@robota-sdk/workflow';

import { ScenarioStore } from './utils/scenario-store';
import { createScenarioProviderFromEnv } from './lib/scenario-provider';
import { WorkflowSubscriberEventService } from './lib/workflow-subscriber-event-service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requireNonEmptyEnv = (key: string): string => {
    const value = process.env[key];
    if (!value) {
        throw new Error(`[EXAMPLES] Missing required env "${key}"`);
    }
    return value;
};

const buildAssignTaskTool = (aiProvider: AIProvider): FunctionTool => {
    let nextChildAgentNumber = 1;

    const schema: ToolSchema = {
        name: 'assignTask',
        description: 'Guarded assignTask: creates a new agent instance and runs the delegated task.',
        parameters: {
            type: 'object',
            properties: {
                jobDescription: { type: 'string' },
                context: { type: 'string' }
            },
            required: ['jobDescription']
        }
    };

    return new FunctionTool(schema, async (params: ToolParameters, ctx?: ToolExecutionContext): Promise<ToolExecutionData> => {
        const jobDescription = typeof params.jobDescription === 'string' ? params.jobDescription : '';
        if (!jobDescription) {
            throw new Error('[GUARDED-ASSIGN-TASK] Missing jobDescription');
        }
        if (!ctx?.baseEventService) {
            throw new Error('[GUARDED-ASSIGN-TASK] Missing context.baseEventService (DI required)');
        }

        const parentOwnerPath: OwnerPathSegment[] = Array.isArray(ctx.ownerPath) ? ctx.ownerPath.map(segment => ({ ...segment })) : [];

        const childAgentId = `agent_${nextChildAgentNumber}`;
        nextChildAgentNumber += 1;
        const delegatedResponseNodeId = `response_thinking_${childAgentId}_round1`;

        const extraContext = typeof params.context === 'string' ? params.context : '';
        const prompt = extraContext ? `${jobDescription}\n\nContext: ${extraContext}` : jobDescription;

        const childAgent = new Robota({
            name: `GuardedDelegatedAgent_${childAgentId}`,
            conversationId: childAgentId,
            aiProviders: [aiProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini'
            },
            eventService: ctx.baseEventService,
            executionContext: { ownerPath: parentOwnerPath }
        });

        const response = await childAgent.run(prompt);
        return { response, delegatedAgentId: childAgentId, delegatedResponseNodeId };
    });
};

async function main(): Promise<void> {
    const store = new ScenarioStore({ baseDir: path.resolve(__dirname, 'scenarios') });

    const scenario = createScenarioProviderFromEnv({
        store,
        defaultPlayStrategy: 'sequential',
        providerName: 'openai',
        providerVersion: 'mock-scenario'
    });
    if (scenario.mode !== 'play') {
        throw new Error(`[GUARD] This example requires scenario playback. Set SCENARIO_PLAY_ID (mode=${scenario.mode}).`);
    }
    const provider = scenario.provider;

    const subscriber = new WorkflowEventSubscriber({ logger: DefaultConsoleLogger });
    const bridge = new WorkflowSubscriberEventService(subscriber, DefaultConsoleLogger);
    const baseEventService: EventService = bridge;

    const rootAgentId = 'agent_0';
    const assignTaskTool = buildAssignTaskTool(provider);
    const agent = new Robota({
        name: 'GuardedContinuedConversationAgent',
        conversationId: rootAgentId,
        aiProviders: [provider],
        tools: [assignTaskTool],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            temperature: 0.6
        },
        eventService: baseEventService,
        executionContext: { ownerPath: [] }
    });

    // Continued conversation should be represented by executing twice in the same conversationId.
    await agent.run('First message: delegate one task using assignTask, then respond briefly.');
    await agent.run('Second message: continue based on previous response; do not reset context.');
    await bridge.flush();
    await scenario.assertNoUnusedSteps();

    const snapshot = subscriber.getWorkflowSnapshot();
    const nodes = snapshot.nodes;
    const edges = snapshot.edges;

    const outputPath = path.resolve(__dirname, 'data', 'real-workflow-data.json');
    fs.writeFileSync(outputPath, JSON.stringify({ nodes, edges }, null, 2), 'utf8');
}

main().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.error(err.message);
    process.exit(1);
});


