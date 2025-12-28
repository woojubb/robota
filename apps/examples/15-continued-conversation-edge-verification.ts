import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { Robota, FunctionTool } from '@robota-sdk/agents';
import type { IAIProvider, IEventService, IOwnerPathSegment, IToolExecutionContext, IToolSchema, TToolParameters } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { WorkflowEventSubscriber, WorkflowSubscriberEventService } from '@robota-sdk/workflow';

import { ScenarioStore, createScenarioProviderFromEnv, createScenarioToolWrapper } from '@robota-sdk/workflow/scenario';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requireNonEmptyEnv = (key: string): string => {
    const value = process.env[key];
    if (!value) {
        throw new Error(`[EXAMPLES] Missing required env "${key}"`);
    }
    return value;
};

const buildAssignTaskTool = (aiProvider: IAIProvider): FunctionTool => {
    let nextChildAgentNumber = 1;

    const schema: IToolSchema = {
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

    return new FunctionTool(schema, async (params: TToolParameters, ctx?: IToolExecutionContext) => {

        const jobDescription = typeof params.jobDescription === 'string' ? params.jobDescription : '';
        if (!jobDescription) {
            throw new Error('[GUARDED-ASSIGN-TASK] Missing jobDescription');
        }
        if (!ctx?.baseEventService) {
            throw new Error('[GUARDED-ASSIGN-TASK] Missing context.baseEventService (DI required)');
        }

        const parentOwnerPath: IOwnerPathSegment[] = Array.isArray(ctx.ownerPath) ? ctx.ownerPath.map(segment => ({ ...segment })) : [];

        const childAgentId = `agent_${nextChildAgentNumber}`;
        nextChildAgentNumber += 1;
        const extraContext = typeof params.context === 'string' ? params.context : '';
        const prompt = extraContext ? `${jobDescription}\n\nContext: ${extraContext}` : jobDescription;

        const childAgent = new Robota({
            name: `GuardedDelegatedAgent_${childAgentId}`,
            conversationId: childAgentId,
            aiProviders: [aiProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                temperature: 0.6
            },
            eventService: ctx.baseEventService,
            executionContext: { ownerPath: parentOwnerPath }
        });

        const response = await childAgent.run(prompt);
        // Tool message content must be a plain string to match the recorded scenario snapshots.
        return response;
    });
};

async function main(): Promise<void> {
    const store = new ScenarioStore({ baseDir: path.resolve(__dirname, 'scenarios') });

    const isPlayMode = Boolean(process.env.SCENARIO_PLAY_ID);
    const delegate =
        isPlayMode
            ? undefined
            : (() => {
                const apiKey = process.env.OPENAI_API_KEY;
                if (!apiKey) {
                    throw new Error('OPENAI_API_KEY environment variable is required (record/none mode)');
                }
                return new OpenAIProvider({ apiKey });
            })();

    const scenario = createScenarioProviderFromEnv({
        store,
        ...(delegate ? { delegate } : undefined),
        defaultPlayStrategy: 'sequential',
        providerName: 'openai',
        providerVersion: 'mock-scenario'
    });
    const provider = scenario.provider;

    const subscriber = new WorkflowEventSubscriber({ logger: SilentLogger });
    const bridge = new WorkflowSubscriberEventService(subscriber, SilentLogger);
    const baseEventService: IEventService = bridge;

    const rootAgentId = 'agent_0';
    const assignTaskTool = createScenarioToolWrapper(buildAssignTaskTool(provider), {
        mode: scenario.mode,
        scenarioId: scenario.mode === 'none' ? undefined : scenario.scenarioId,
        store,
        ...(scenario.mode === 'play' ? { onToolCallUsed: scenario.onToolCallUsed } : undefined)
    });
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
    if (scenario.mode === 'play') {
        await scenario.assertNoUnusedSteps();
    }

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


