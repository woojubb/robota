import { describe, expect, it, vi } from 'vitest';
import {
    listTemplateCategoriesTool,
    listTemplatesTool,
    getTemplateDetailTool,
    createAssignTaskRelayTool
} from './relay-assign-task';
import type { IToolResult, IToolExecutionContext, IAIProvider, IEventService } from '@robota-sdk/agents';

// Mock Robota so createAssignTaskRelayTool doesn't call real AI
const mockRun = vi.fn();
vi.mock('@robota-sdk/agents', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@robota-sdk/agents')>();
    return {
        ...actual,
        Robota: vi.fn(() => ({ run: mockRun })),
        bindWithOwnerPath: vi.fn((_base: unknown) => ({
            emit: vi.fn(),
            on: vi.fn(),
            off: vi.fn()
        }))
    };
});

function getData(result: IToolResult): Record<string, unknown> {
    return (result.data ?? {}) as Record<string, unknown>;
}

function createMockEventService(): IEventService {
    return {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn()
    } as unknown as IEventService;
}

function createToolExecutionContext(): IToolExecutionContext {
    return {
        eventService: createMockEventService(),
        baseEventService: createMockEventService(),
        ownerPath: [{ type: 'agent', id: 'parent-agent-1' }],
        agentId: 'test-agent-123'
    } as unknown as IToolExecutionContext;
}

describe('listTemplateCategoriesTool', () => {
    it('returns a default category', async () => {
        const result = await listTemplateCategoriesTool.execute({});
        expect(result.success).toBe(true);
        const data = getData(result);
        const categories = data.categories as Array<Record<string, unknown>>;
        expect(Array.isArray(categories)).toBe(true);
        expect(categories[0]?.id).toBe('default');
    });
});

describe('listTemplatesTool', () => {
    it('returns template summaries', async () => {
        const result = await listTemplatesTool.execute({});
        expect(result.success).toBe(true);
        const data = getData(result);
        const templates = data.templates as Array<Record<string, unknown>>;
        expect(Array.isArray(templates)).toBe(true);
        expect(templates.length).toBeGreaterThanOrEqual(2);
        expect(templates[0]?.id).toBe('general');
    });

    it('all templates have required fields', async () => {
        const result = await listTemplatesTool.execute({});
        const data = getData(result);
        const templates = data.templates as Array<Record<string, unknown>>;
        for (const tmpl of templates) {
            expect(typeof tmpl.id).toBe('string');
            expect(typeof tmpl.name).toBe('string');
        }
    });
});

describe('getTemplateDetailTool', () => {
    it('returns full template entry by id', async () => {
        const result = await getTemplateDetailTool.execute({ templateId: 'general' });
        expect(result.success).toBe(true);
        const detail = getData(result);
        expect(detail.id).toBe('general');
        expect(typeof detail.provider).toBe('string');
        expect(typeof detail.model).toBe('string');
        expect(typeof detail.systemMessage).toBe('string');
    });

    it('returns task_coordinator template', async () => {
        const result = await getTemplateDetailTool.execute({ templateId: 'task_coordinator' });
        expect(result.success).toBe(true);
        const detail = getData(result);
        expect(detail.id).toBe('task_coordinator');
    });

    it('throws when templateId is missing', async () => {
        await expect(getTemplateDetailTool.execute({})).rejects.toThrow();
    });

    it('throws when templateId is not found', async () => {
        await expect(getTemplateDetailTool.execute({ templateId: 'nonexistent' })).rejects.toThrow();
    });
});

describe('createAssignTaskRelayTool', () => {
    const mockEventService = createMockEventService();
    const mockProviders: IAIProvider[] = [{ name: 'openai' } as unknown as IAIProvider];

    it('returns a tool with assignTask schema', () => {
        const tool = createAssignTaskRelayTool(mockEventService, mockProviders);
        expect(tool.schema.name).toBe('assignTask');
        expect(tool.schema.parameters.required).toContain('templateId');
        expect(tool.schema.parameters.required).toContain('jobDescription');
    });

    it('returns error when templateId is missing', async () => {
        const tool = createAssignTaskRelayTool(mockEventService, mockProviders);
        const ctx = createToolExecutionContext();
        const result = await tool.execute(
            { jobDescription: 'Do something' },
            ctx
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('templateId');
    });

    it('returns error when jobDescription is missing', async () => {
        const tool = createAssignTaskRelayTool(mockEventService, mockProviders);
        const ctx = createToolExecutionContext();
        const result = await tool.execute(
            { templateId: 'general' },
            ctx
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('jobDescription');
    });

    it('returns error when template is not found', async () => {
        const tool = createAssignTaskRelayTool(mockEventService, mockProviders);
        const ctx = createToolExecutionContext();
        const result = await tool.execute(
            { templateId: 'nonexistent', jobDescription: 'Do something' },
            ctx
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('nonexistent');
    });

    it('executes successfully with valid template and job description', async () => {
        mockRun.mockResolvedValueOnce('Task completed successfully');
        const tool = createAssignTaskRelayTool(mockEventService, mockProviders);
        const ctx = createToolExecutionContext();
        const result = await tool.execute(
            { templateId: 'general', jobDescription: 'Write a report' },
            ctx
        );
        expect(result.success).toBe(true);
        const data = getData(result);
        expect(data.response).toBe('Task completed successfully');
        expect(data.templateId).toBe('general');
    });

    it('appends context to prompt when context param is provided', async () => {
        mockRun.mockResolvedValueOnce('Done with context');
        const tool = createAssignTaskRelayTool(mockEventService, mockProviders);
        const ctx = createToolExecutionContext();
        await tool.execute(
            { templateId: 'general', jobDescription: 'Write report', context: 'Extra info' },
            ctx
        );
        expect(mockRun).toHaveBeenCalledWith('Write report\n\nContext: Extra info');
    });
});
