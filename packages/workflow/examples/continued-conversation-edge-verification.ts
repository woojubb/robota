import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { Robota, FunctionTool } from '@robota-sdk/agents';
import type { IAIProvider, IEventService, IOwnerPathSegment, IToolExecutionContext, IToolSchema, TToolParameters } from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import { WorkflowEventSubscriber, WorkflowEventServiceBridge } from '@robota-sdk/workflow';

import { ScenarioStore, createScenarioToolWrapper } from '@robota-sdk/workflow/scenario';
import { createOpenAIProviderForRecordFromEnv, createScenarioRuntime } from './utils/scenario-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

        const delegatedAgentId = `agent_${nextChildAgentNumber}`;
        nextChildAgentNumber += 1;
        const extraContext = typeof params.context === 'string' ? params.context : '';
        const prompt = extraContext ? `${jobDescription}\n\nContext: ${extraContext}` : jobDescription;

        const childAgent = new Robota({
            name: `GuardedDelegatedAgent_${delegatedAgentId}`,
            conversationId: delegatedAgentId,
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
    const runtime = createScenarioRuntime({
        createProviderForRecord: createOpenAIProviderForRecordFromEnv,
        providerName: 'openai',
        providerVersion: 'mock-scenario',
        defaultPlayStrategy: 'hash',
        scenarioOptions: { store }
    });
    const scenario = runtime.scenario;
    const provider = scenario.provider;
    const delegatedExecutionProvider = scenario.mode === 'record'
        ? (runtime.recordDelegateProvider ?? provider)
        : provider;

    const subscriber = new WorkflowEventSubscriber({ logger: SilentLogger });
    const bridge = new WorkflowEventServiceBridge(subscriber, SilentLogger);
    const baseEventService: IEventService = bridge;

    const rootAgentId = 'agent_0';
    const assignTaskTool = createScenarioToolWrapper(buildAssignTaskTool(delegatedExecutionProvider), {
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
    const outputPath = path.resolve(__dirname, 'data', 'real-workflow-data.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges }, null, 2), 'utf8');
}

main().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.error(err.message);
    process.exit(1);
});


