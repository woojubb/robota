import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { Robota, FunctionTool } from '@robota-sdk/agents';
import type {
    IAIProvider,
    IEventService,
    IOwnerPathSegment,
    IToolExecutionContext,
    IToolSchema,
    TToolParameters
} from '@robota-sdk/agents';
import { DefaultConsoleLogger } from '@robota-sdk/agents';
import { WorkflowEventSubscriber } from '@robota-sdk/workflow';

import { ScenarioStore } from './utils/scenario-store';
import { createScenarioProviderFromEnv } from './lib/scenario-provider';
import { WorkflowSubscriberEventService } from './lib/workflow-subscriber-event-service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type NonEmptyString = string & { readonly __brand: 'NonEmptyString' };
const asNonEmptyString = (value: string, label: string): NonEmptyString => {
    if (!value) {
        throw new Error(`[EXAMPLES] Missing required ${label}`);
    }
    return value as NonEmptyString;
};

const findNearestOwnerId = (ownerPath: IOwnerPathSegment[] | undefined, ownerType: string): string | undefined => {
    if (!ownerPath?.length) return undefined;
    for (let i = ownerPath.length - 1; i >= 0; i--) {
        const seg = ownerPath[i];
        if (seg?.type === ownerType && typeof seg.id === 'string' && seg.id.length > 0) {
            return seg.id;
        }
    }
    return undefined;
};

const buildGuardedAssignTaskTool = (aiProvider: IAIProvider): FunctionTool => {
    let nextChildAgentNumber = 1;

    const schema: IToolSchema = {
        name: 'assignTask',
        description: 'Guarded assignTask: creates a new agent instance and runs the delegated task.',
        parameters: {
            type: 'object',
            properties: {
                jobDescription: { type: 'string' },
                context: { type: 'string' },
                priority: { type: 'string' },
                agentTemplate: { type: 'string' },
                allowFurtherDelegation: { type: 'boolean' }
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
        const parentAgentId = findNearestOwnerId(parentOwnerPath, 'agent');
        if (!parentAgentId) {
            throw new Error('[GUARDED-ASSIGN-TASK] Missing parent agent segment in context.ownerPath');
        }

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
        return { response, delegatedFrom: parentAgentId, delegatedAgentId: childAgentId, delegatedResponseNodeId };
    });
};

async function main(): Promise<void> {
    // Guard: This example is for refactor validation. It must be deterministic and offline.
    // Use sequential playback to avoid request-hash coupling during refactors.
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
    const baseEventService: IEventService = bridge;

    const rootAgentId = 'agent_0';
    const assignTaskTool = buildGuardedAssignTaskTool(provider);

    const agent = new Robota({
        name: 'GuardedRootAgent',
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

    const prompt =
        'Write a cafe business plan.\n' +
        'MANDATORY: You MUST delegate market analysis and menu planning using assignTask.\n' +
        'Do NOT do those parts yourself.';

    await agent.run(prompt);
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


