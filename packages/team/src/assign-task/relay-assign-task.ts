import { Robota, bindWithOwnerPath, FunctionTool, RelayMcpTool, type IEventService } from '@robota-sdk/agents';
import type { IAgentConfig, IAIProvider, IToolSchema, TToolParameters, IToolResult, IOwnerPathSegment } from '@robota-sdk/agents';
import templates from './templates.json';

type TTemplateEntry = {
    id: string;
    name: string;
    description?: string;
    provider: string;
    model: string;
    temperature?: number;
    systemMessage: string;
};

function validateTemplateList(data: unknown): TTemplateEntry[] {
    if (!Array.isArray(data)) {
        throw new Error('[relay-assign-task] templates.json must be an array');
    }
    for (const entry of data) {
        if (
            typeof entry !== 'object' || entry === null ||
            typeof (entry as Record<string, unknown>).id !== 'string' ||
            typeof (entry as Record<string, unknown>).name !== 'string' ||
            typeof (entry as Record<string, unknown>).provider !== 'string' ||
            typeof (entry as Record<string, unknown>).model !== 'string' ||
            typeof (entry as Record<string, unknown>).systemMessage !== 'string'
        ) {
            throw new Error('[relay-assign-task] Invalid template entry: missing required fields (id, name, provider, model, systemMessage)');
        }
    }
    return data as TTemplateEntry[];
}

const TEMPLATE_LIST: TTemplateEntry[] = validateTemplateList(templates);

const listTemplateCategoriesSchema: IToolSchema = {
    name: 'listTemplateCategories',
    description: 'List categories of available assignTask templates',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

const listTemplatesSchema: IToolSchema = {
    name: 'listTemplates',
    description: 'List available assignTask templates (optional category filter)',
    parameters: {
        type: 'object',
        properties: {
            categoryId: {
                type: 'string',
                description: 'Category ID to filter templates'
            }
        },
        required: []
    }
};

const getTemplateDetailSchema: IToolSchema = {
    name: 'getTemplateDetail',
    description: 'Get details of a specific assignTask template',
    parameters: {
        type: 'object',
        properties: {
            templateId: {
                type: 'string',
                description: 'Template identifier'
            }
        },
        required: ['templateId']
    }
};

const assignTaskSchema: IToolSchema = {
    name: 'assignTask',
    description: 'Assign a task to an agent based on a template',
    parameters: {
        type: 'object',
        properties: {
            templateId: { type: 'string', description: 'Template to use' },
            jobDescription: { type: 'string', description: 'Task description' },
            provider: { type: 'string', description: 'Override provider' },
            model: { type: 'string', description: 'Override model' },
            temperature: { type: 'number', description: 'Sampling temperature' },
            maxTokens: { type: 'number', description: 'Max tokens' },
            context: { type: 'string', description: 'Additional context' }
        },
        required: ['templateId', 'jobDescription']
    }
};

/**
 * Tool that lists available template categories for task assignment.
 * @returns An object containing the array of template categories.
 */
export const listTemplateCategoriesTool = new FunctionTool(listTemplateCategoriesSchema, async () => {
    const categories = [
        {
            id: 'default',
            name: 'Default Templates',
            description: 'Built-in assignTask templates'
        }
    ];
    return { categories };
});

/**
 * Tool that lists available task assignment templates with optional category filtering.
 * @returns An object containing the array of template summaries.
 */
export const listTemplatesTool = new FunctionTool(listTemplatesSchema, async (params: TToolParameters) => {
    void params;
    const filtered = TEMPLATE_LIST.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        categoryId: 'default'
    }));
    return { templates: filtered };
});

/**
 * Tool that retrieves the full details of a specific task assignment template.
 * @returns The complete template entry matching the requested templateId.
 */
export const getTemplateDetailTool = new FunctionTool(getTemplateDetailSchema, async (params: TToolParameters) => {
    const templateId = typeof params.templateId === 'string' ? params.templateId : '';
    if (!templateId) {
        throw new Error('Missing required parameter: templateId');
    }
    const tmpl = TEMPLATE_LIST.find(t => t.id === templateId);
    if (!tmpl) {
        throw new Error(`Template not found: ${templateId}`);
    }
    return tmpl;
});

/**
 * Create a relay tool that assigns a task to a dynamically spawned agent based on a template.
 * @param eventService - Event service for agent communication and lifecycle tracking.
 * @param aiProviders - Available AI providers for the spawned agent to use.
 * @returns A RelayMcpTool that executes task assignment via template-driven agent creation.
 */
export function createAssignTaskRelayTool(eventService: IEventService, aiProviders: IAIProvider[]): RelayMcpTool {
    return new RelayMcpTool({
        schema: assignTaskSchema,
        eventService,
        run: async (params: TToolParameters, ctx): Promise<IToolResult> => {
            const templateId = typeof params.templateId === 'string' ? params.templateId : '';
            const jobDescription = typeof params.jobDescription === 'string' ? params.jobDescription : '';
            if (!templateId) {
                return { success: false, error: 'Missing required parameter: templateId' };
            }
            if (!jobDescription) {
                return { success: false, error: 'Missing required parameter: jobDescription' };
            }

            const provider = typeof params.provider === 'string' ? params.provider : undefined;
            const model = typeof params.model === 'string' ? params.model : undefined;
            const temperature = typeof params.temperature === 'number' ? params.temperature : undefined;
            const maxTokens = typeof params.maxTokens === 'number' ? params.maxTokens : undefined;
            const jobContext = typeof params.context === 'string' ? params.context : '';

            const tmpl = TEMPLATE_LIST.find(t => t.id === templateId);
            if (!tmpl) {
                return { success: false, error: `Template not found: ${templateId}` };
            }

            if (!ctx?.eventService) {
                throw new Error('[ASSIGN-TASK] Missing context.eventService');
            }
            if (!ctx?.baseEventService) {
                throw new Error('[ASSIGN-TASK] Missing context.baseEventService');
            }
            if (!ctx?.agentId) {
                throw new Error('[ASSIGN-TASK] Missing context.agentId');
            }
            const parentOwnerPath: IOwnerPathSegment[] = Array.isArray(ctx.ownerPath)
                ? ctx.ownerPath
                    .filter((s: IOwnerPathSegment): s is IOwnerPathSegment =>
                        s !== null && typeof s === 'object' && typeof s.type === 'string' && typeof s.id === 'string'
                    )
                    .map((s: IOwnerPathSegment) => ({ ...s }))
                : [];
            const agentOwnerPath: IOwnerPathSegment[] = [...parentOwnerPath, { type: 'agent', id: ctx.agentId }];
            const agentEventService = bindWithOwnerPath(ctx.baseEventService, {
                ownerType: 'agent',
                ownerId: ctx.agentId,
                ownerPath: agentOwnerPath
            });

            const agentConfig: IAgentConfig = {
                name: `assign-${ctx.agentId}`,
                aiProviders,
                defaultModel: {
                    provider: provider || tmpl.provider,
                    model: model || tmpl.model,
                    ...(temperature !== undefined ? { temperature } : tmpl.temperature !== undefined ? { temperature: tmpl.temperature } : {}),
                    ...(maxTokens !== undefined ? { maxTokens } : {})
                },
                conversationId: ctx.agentId,
                eventService: agentEventService,
                executionContext: { ownerPath: agentOwnerPath }
            };

            const agent = new Robota(agentConfig);
            const prompt = jobContext ? `${jobDescription}\n\nContext: ${jobContext}` : jobDescription;
            const result = await agent.run(prompt);

            return { success: true, data: { response: result, templateId } };
        }
    });
}

