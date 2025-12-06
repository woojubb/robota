import { Robota, type AgentConfig, type ToolExecutionContext, bindEventServiceOwner, FunctionTool, RelayMcpTool, type EventService } from '@robota-sdk/agents';
import type { ToolParameters, ToolResult } from '@robota-sdk/agents/src/interfaces/tool';
import type { ToolSchema } from '@robota-sdk/agents/src/interfaces/provider';
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

type AssignTaskParams = {
    templateId: string;
    jobDescription: string;
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    context?: string;
};

const TEMPLATE_LIST: TemplateEntry[] = templates as TemplateEntry[];

const listTemplateCategoriesSchema: ToolSchema = {
    name: 'listTemplateCategories',
    description: 'List categories of available assignTask templates',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

const listTemplatesSchema: ToolSchema = {
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

const getTemplateDetailSchema: ToolSchema = {
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

const assignTaskSchema: ToolSchema = {
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

export const listTemplateCategoriesTool = new FunctionTool(listTemplateCategoriesSchema, async (): Promise<ToolResult> => {
    const categories = [
        {
            id: 'default',
            name: 'Default Templates',
            description: 'Built-in assignTask templates'
        }
    ];
    return { success: true, data: { categories } as any };
});

export const listTemplatesTool = new FunctionTool(listTemplatesSchema, async (params: ToolParameters): Promise<ToolResult> => {
    const filtered = TEMPLATE_LIST.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        categoryId: 'default'
    }));
    return { success: true, data: { templates: filtered } as any };
});

export const getTemplateDetailTool = new FunctionTool(getTemplateDetailSchema, async (params: ToolParameters): Promise<ToolResult> => {
    const templateId = params.templateId as string;
    const tmpl = TEMPLATE_LIST.find(t => t.id === templateId);
    if (!tmpl) {
        return { success: false, error: `Template not found: ${templateId}` };
    }
    return { success: true, data: tmpl };
});

export function createAssignTaskRelayTool(eventService: EventService): RelayMcpTool {
    return new RelayMcpTool({
        schema: assignTaskSchema,
        eventService,
        run: async (params: ToolParameters, ctx): Promise<ToolResult> => {
            const { templateId, jobDescription, provider, model, temperature, maxTokens, context: jobContext } = params as AssignTaskParams;
            const tmpl = TEMPLATE_LIST.find(t => t.id === templateId);
            if (!tmpl) {
                return { success: false, error: `Template not found: ${templateId}` };
            }

            const agentEventService = bindEventServiceOwner(ctx.eventService, {
                ownerType: 'agent',
                ownerId: ctx.agentId,
                ownerPath: ctx.ownerPath,
                sourceType: 'agent',
                sourceId: ctx.agentId
            });

            const agentConfig: AgentConfig = {
                name: `assign-${ctx.agentId}`,
                aiProviders: [], // caller must inject via execution context/manager; left empty here
                defaultModel: {
                    provider: provider || tmpl.provider,
                    model: model || tmpl.model,
                    ...(temperature !== undefined ? { temperature } : tmpl.temperature !== undefined ? { temperature: tmpl.temperature } : {}),
                    ...(maxTokens !== undefined ? { maxTokens } : {})
                },
                conversationId: ctx.agentId,
                eventService: agentEventService
            };

            const agent = new Robota(agentConfig);
            const prompt = jobContext ? `${jobDescription}\n\nContext: ${jobContext}` : jobDescription;
            const result = await agent.run(prompt);

            return { success: true, data: { response: result, templateId } };
        }
    });
}

