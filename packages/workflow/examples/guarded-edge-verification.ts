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
import { SilentLogger } from '@robota-sdk/agents';
import { WorkflowEventSubscriber, WorkflowEventServiceBridge } from '@robota-sdk/workflow';

import { ScenarioStore, createScenarioToolWrapper } from '@robota-sdk/workflow/scenario';
import { createOpenAIProviderForRecordFromEnv, createScenarioRuntime } from './utils/scenario-runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TNonEmptyString = string & { readonly __brand: 'TNonEmptyString' };
const asNonEmptyString = (value: string, label: string): TNonEmptyString => {
    if (!value) {
        throw new Error(`[EXAMPLES] Missing required ${label}`);
    }
    return value as TNonEmptyString;
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
        const extraContext = typeof params.context === 'string' ? params.context : '';
        const priority = typeof params.priority === 'string' ? params.priority : '';
        const prompt =
            `Task: ${jobDescription}\n\n` +
            `Context: ${extraContext}\n\n` +
            `Priority: ${priority}`;

        const agentTemplate = typeof params.agentTemplate === 'string' ? params.agentTemplate : '';
        const temperature =
            agentTemplate === 'creative_ideator' ? 0.8
                : agentTemplate === 'domain_researcher' ? 0.4
                    : 0.6;

        const childAgent = new Robota({
            name: `GuardedDelegatedAgent_${childAgentId}`,
            conversationId: childAgentId,
            aiProviders: [aiProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                temperature
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
    const assignTaskTool = createScenarioToolWrapper(buildGuardedAssignTaskTool(delegatedExecutionProvider), {
        mode: scenario.mode,
        scenarioId: scenario.mode === 'none' ? undefined : scenario.scenarioId,
        store,
        ...(scenario.mode === 'play' ? { onToolCallUsed: scenario.onToolCallUsed } : undefined)
    });

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
        '카페 창업 계획서를 작성해주세요. 🚨 MANDATORY DELEGATION REQUIRED: 다음 두 부분을 반드시 별도의 전문가에게 위임해야 합니다: ' +
        '1) 시장 분석 (경쟁사, 타겟 고객, 트렌드) - 시장조사 전문가에게 assignTask로 위임 ' +
        '2) 메뉴 구성 (음료 3개, 디저트 2개, 가격대) - 메뉴기획 전문가에게 assignTask로 위임 ' +
        'YOU MUST use assignTask tool to delegate these tasks. DO NOT attempt to do the analysis yourself.';

    await agent.run(prompt);
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


