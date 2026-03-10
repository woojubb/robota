import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateManagerAdapter } from '../template-manager-adapter';
import type { IAgentConfig, IAgentTemplate } from '@robota-sdk/agents';

// Track mock instances for assertions
let mockTemplatesInstance: {
    getTemplate: ReturnType<typeof vi.fn>;
    getTemplates: ReturnType<typeof vi.fn>;
    registerTemplate: ReturnType<typeof vi.fn>;
    unregisterTemplate: ReturnType<typeof vi.fn>;
    applyTemplate: ReturnType<typeof vi.fn>;
};

let mockFactoryInstance: {
    validateConfiguration: ReturnType<typeof vi.fn>;
    applyTemplate: ReturnType<typeof vi.fn>;
};

vi.mock('@robota-sdk/agents', () => {
    const AgentTemplatesMock = vi.fn().mockImplementation(() => {
        mockTemplatesInstance = {
            getTemplate: vi.fn(),
            getTemplates: vi.fn().mockReturnValue([]),
            registerTemplate: vi.fn(),
            unregisterTemplate: vi.fn(),
            applyTemplate: vi.fn(),
        };
        return mockTemplatesInstance;
    });

    const AgentFactoryMock = vi.fn().mockImplementation(() => {
        mockFactoryInstance = {
            validateConfiguration: vi.fn(),
            applyTemplate: vi.fn(),
        };
        return mockFactoryInstance;
    });

    return {
        AgentTemplates: AgentTemplatesMock,
        AgentFactory: AgentFactoryMock,
    };
});

function createSampleConfig(overrides: Partial<IAgentConfig> = {}): IAgentConfig {
    return {
        name: 'test-agent',
        aiProviders: [],
        defaultModel: { provider: 'openai', model: 'gpt-4' },
        ...overrides,
    } as IAgentConfig;
}

function createSampleTemplate(overrides: Partial<IAgentTemplate> = {}): IAgentTemplate {
    return {
        id: 'test-template',
        name: 'Test Template',
        config: createSampleConfig(),
        ...overrides,
    };
}

describe('TemplateManagerAdapter', () => {
    let adapter: TemplateManagerAdapter;

    beforeEach(() => {
        vi.clearAllMocks();
        adapter = new TemplateManagerAdapter();
    });

    describe('constructor', () => {
        it('should create internal AgentTemplates instance', () => {
            expect(adapter).toBeDefined();
        });
    });

    describe('getTemplate', () => {
        it('should return config when template exists', () => {
            const template = createSampleTemplate();
            mockTemplatesInstance.getTemplate.mockReturnValue(template);

            const result = adapter.getTemplate('test-template');

            expect(mockTemplatesInstance.getTemplate).toHaveBeenCalledWith('test-template');
            expect(result).toBe(template.config);
        });

        it('should return undefined when template does not exist', () => {
            mockTemplatesInstance.getTemplate.mockReturnValue(undefined);

            const result = adapter.getTemplate('nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('listTemplates', () => {
        it('should return template IDs from all templates', () => {
            const templates = [
                createSampleTemplate({ id: 'alpha' }),
                createSampleTemplate({ id: 'beta' }),
                createSampleTemplate({ id: 'gamma' }),
            ];
            mockTemplatesInstance.getTemplates.mockReturnValue(templates);

            const result = adapter.listTemplates();

            expect(result).toEqual(['alpha', 'beta', 'gamma']);
        });

        it('should return empty array when no templates registered', () => {
            mockTemplatesInstance.getTemplates.mockReturnValue([]);

            const result = adapter.listTemplates();

            expect(result).toEqual([]);
        });
    });

    describe('validateTemplate', () => {
        it('should return true when configuration is valid', () => {
            mockFactoryInstance.validateConfiguration.mockReturnValue({ isValid: true, errors: [] });

            const config = createSampleConfig();
            const result = adapter.validateTemplate(config);

            expect(mockFactoryInstance.validateConfiguration).toHaveBeenCalledWith(config);
            expect(result).toBe(true);
        });

        it('should return false when configuration is invalid', () => {
            mockFactoryInstance.validateConfiguration.mockReturnValue({ isValid: false, errors: ['missing name'] });

            const config = createSampleConfig();
            const result = adapter.validateTemplate(config);

            expect(result).toBe(false);
        });
    });

    describe('registerTemplate', () => {
        it('should delegate to agentTemplates.registerTemplate', () => {
            const template = createSampleTemplate();

            adapter.registerTemplate(template);

            expect(mockTemplatesInstance.registerTemplate).toHaveBeenCalledWith(template);
        });
    });

    describe('unregisterTemplate', () => {
        it('should return true when template was removed', () => {
            mockTemplatesInstance.unregisterTemplate.mockReturnValue(true);

            const result = adapter.unregisterTemplate('test-template');

            expect(mockTemplatesInstance.unregisterTemplate).toHaveBeenCalledWith('test-template');
            expect(result).toBe(true);
        });

        it('should return false when template did not exist', () => {
            mockTemplatesInstance.unregisterTemplate.mockReturnValue(false);

            const result = adapter.unregisterTemplate('nonexistent');

            expect(result).toBe(false);
        });
    });

    describe('getTemplateDetails', () => {
        it('should return full template object when found', () => {
            const template = createSampleTemplate({ id: 'detailed', description: 'A detailed template' });
            mockTemplatesInstance.getTemplate.mockReturnValue(template);

            const result = adapter.getTemplateDetails('detailed');

            expect(result).toBe(template);
        });

        it('should return undefined when template not found', () => {
            mockTemplatesInstance.getTemplate.mockReturnValue(undefined);

            const result = adapter.getTemplateDetails('missing');

            expect(result).toBeUndefined();
        });
    });

    describe('applyTemplate', () => {
        it('should apply template with no overrides and return config', () => {
            const template = createSampleTemplate();
            const appliedConfig = createSampleConfig({ name: 'applied' });
            mockTemplatesInstance.getTemplate.mockReturnValue(template);
            mockFactoryInstance.applyTemplate.mockReturnValue({
                config: appliedConfig,
                template,
                warnings: [],
                modified: false,
            });

            const result = adapter.applyTemplate('test-template');

            expect(mockTemplatesInstance.getTemplate).toHaveBeenCalledWith('test-template');
            expect(mockFactoryInstance.applyTemplate).toHaveBeenCalledWith(template, {});
            expect(result).toBe(appliedConfig);
        });

        it('should apply template with overrides', () => {
            const template = createSampleTemplate();
            const overrides: Partial<IAgentConfig> = { name: 'custom-name' } as Partial<IAgentConfig>;
            const appliedConfig = createSampleConfig({ name: 'custom-name' });
            mockTemplatesInstance.getTemplate.mockReturnValue(template);
            mockFactoryInstance.applyTemplate.mockReturnValue({
                config: appliedConfig,
                template,
                warnings: [],
                modified: true,
            });

            const result = adapter.applyTemplate('test-template', overrides);

            expect(mockFactoryInstance.applyTemplate).toHaveBeenCalledWith(template, overrides);
            expect(result).toBe(appliedConfig);
        });

        it('should return undefined when template not found', () => {
            mockTemplatesInstance.getTemplate.mockReturnValue(undefined);

            const result = adapter.applyTemplate('nonexistent');

            expect(result).toBeUndefined();
        });
    });
});
