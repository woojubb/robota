import { Robota, bindWithOwnerPath, FunctionTool, RelayMcpTool, type IEventService } from '@robota-sdk/agents';
import type { IAgentConfig, IToolSchema, TToolParameters, IToolResult, IOwnerPathSegment } from '@robota-sdk/agents';
import templates from './templates.json';

type TemplateEntry = {
    id: string;
    name: string;
    description?: string;
    provider: string;
    model: string;
    temperature?: number;
    systemMessage: string;
};

const TEMPLATE_LIST: TemplateEntry[] = templates as TemplateEntry[];

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

export function createAssignTaskRelayTool(eventService: IEventService): RelayMcpTool {
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
            const parentOwnerPath: IOwnerPathSegment[] = Array.isArray(ctx.ownerPath) ? ctx.ownerPath.map((s: IOwnerPathSegment) => ({ ...s })) : [];
            const agentOwnerPath: IOwnerPathSegment[] = [...parentOwnerPath, { type: 'agent', id: ctx.agentId }];
            const agentEventService = bindWithOwnerPath(ctx.baseEventService, {
                ownerType: 'agent',
                ownerId: ctx.agentId,
                ownerPath: agentOwnerPath
            });

            const agentConfig: IAgentConfig = {
                name: `assign-${ctx.agentId}`,
                aiProviders: [], // caller must inject via execution context/manager; left empty here
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

