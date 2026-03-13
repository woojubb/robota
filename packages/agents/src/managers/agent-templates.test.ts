import { describe, it, expect, beforeEach } from 'vitest';
import { AgentTemplates } from './agent-templates';
import type { IAgentTemplate, IAgentConfig } from '../interfaces/agent';

function makeTemplate(overrides: Partial<IAgentTemplate> = {}): IAgentTemplate {
    return {
        id: 'tpl-1',
        name: 'Test Template',
        description: 'A test template',
        config: {
            name: 'test-agent',
            aiProviders: [],
            defaultModel: { provider: 'openai', model: 'gpt-4' }
        },
        category: 'general',
        tags: ['test', 'basic'],
        ...overrides
    };
}

describe('AgentTemplates', () => {
    let templates: AgentTemplates;

    beforeEach(() => {
        templates = new AgentTemplates();
    });

    describe('registerTemplate', () => {
        it('registers a template', () => {
            templates.registerTemplate(makeTemplate());
            expect(templates.hasTemplate('tpl-1')).toBe(true);
        });

        it('throws for template without ID', () => {
            expect(() => templates.registerTemplate(makeTemplate({ id: '' })))
                .toThrow('Template must have an ID');
        });

        it('overrides existing template with same ID', () => {
            templates.registerTemplate(makeTemplate({ name: 'Original' }));
            templates.registerTemplate(makeTemplate({ name: 'Override' }));
            expect(templates.getTemplate('tpl-1')?.name).toBe('Override');
        });
    });

    describe('unregisterTemplate', () => {
        it('removes an existing template', () => {
            templates.registerTemplate(makeTemplate());
            const removed = templates.unregisterTemplate('tpl-1');
            expect(removed).toBe(true);
            expect(templates.hasTemplate('tpl-1')).toBe(false);
        });

        it('returns false for non-existent template', () => {
            expect(templates.unregisterTemplate('missing')).toBe(false);
        });
    });

    describe('getTemplate', () => {
        it('returns the template by ID', () => {
            templates.registerTemplate(makeTemplate());
            expect(templates.getTemplate('tpl-1')?.id).toBe('tpl-1');
        });

        it('returns undefined for missing template', () => {
            expect(templates.getTemplate('missing')).toBeUndefined();
        });
    });

    describe('getTemplates', () => {
        it('returns all registered templates', () => {
            templates.registerTemplate(makeTemplate({ id: 'a' }));
            templates.registerTemplate(makeTemplate({ id: 'b' }));
            expect(templates.getTemplates()).toHaveLength(2);
        });
    });

    describe('findTemplates', () => {
        beforeEach(() => {
            templates.registerTemplate(makeTemplate({
                id: 'chat', category: 'chat', tags: ['conversational'],
                config: { name: 'chat-agent', aiProviders: [], defaultModel: { provider: 'openai', model: 'gpt-4' } }
            }));
            templates.registerTemplate(makeTemplate({
                id: 'code', category: 'coding', tags: ['developer'],
                config: { name: 'code-agent', aiProviders: [], defaultModel: { provider: 'anthropic', model: 'claude-3' } }
            }));
        });

        it('filters by category', () => {
            const found = templates.findTemplates({ category: 'chat' });
            expect(found).toHaveLength(1);
            expect(found[0].id).toBe('chat');
        });

        it('filters by tags', () => {
            const found = templates.findTemplates({ tags: ['developer'] });
            expect(found).toHaveLength(1);
            expect(found[0].id).toBe('code');
        });

        it('filters by provider', () => {
            const found = templates.findTemplates({ provider: 'anthropic' });
            expect(found).toHaveLength(1);
            expect(found[0].id).toBe('code');
        });

        it('filters by model', () => {
            const found = templates.findTemplates({ model: 'gpt-4' });
            expect(found).toHaveLength(1);
            expect(found[0].id).toBe('chat');
        });

        it('returns all when no criteria', () => {
            const found = templates.findTemplates({});
            expect(found).toHaveLength(2);
        });
    });

    describe('applyTemplate', () => {
        it('returns template config without modifications', () => {
            const tpl = makeTemplate();
            const result = templates.applyTemplate(tpl);
            expect(result.config.name).toBe('test-agent');
            expect(result.template).toBe(tpl);
            expect(result.modified).toBe(false);
        });

        it('applies overrides and marks as modified', () => {
            const tpl = makeTemplate();
            const result = templates.applyTemplate(tpl, { name: 'custom-agent' });
            expect(result.config.name).toBe('custom-agent');
            expect(result.modified).toBe(true);
            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });

    describe('getTemplateCount', () => {
        it('returns the number of templates', () => {
            templates.registerTemplate(makeTemplate({ id: 'a' }));
            templates.registerTemplate(makeTemplate({ id: 'b' }));
            expect(templates.getTemplateCount()).toBe(2);
        });
    });

    describe('clearAll', () => {
        it('removes all templates', () => {
            templates.registerTemplate(makeTemplate());
            templates.clearAll();
            expect(templates.getTemplateCount()).toBe(0);
        });
    });

    describe('getStats', () => {
        it('returns statistics', () => {
            templates.registerTemplate(makeTemplate({
                id: 'a', category: 'chat', tags: ['tag1'],
                config: { name: 'x', aiProviders: [], defaultModel: { provider: 'openai', model: 'gpt-4' } }
            }));
            templates.registerTemplate(makeTemplate({
                id: 'b', category: 'code', tags: ['tag2'],
                config: { name: 'y', aiProviders: [], defaultModel: { provider: 'anthropic', model: 'claude' } }
            }));
            const stats = templates.getStats();
            expect(stats.totalTemplates).toBe(2);
            expect(stats.categories).toContain('chat');
            expect(stats.categories).toContain('code');
            expect(stats.tags).toContain('tag1');
            expect(stats.tags).toContain('tag2');
            expect(stats.providers).toContain('openai');
            expect(stats.models).toContain('gpt-4');
        });
    });
});
