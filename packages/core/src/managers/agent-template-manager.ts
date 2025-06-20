import type { AgentTemplate } from '../types';
import { validateAgentTemplate, safeValidateAgentTemplate, getValidationErrors } from '../schemas/agent-template-schema';

/**
 * Manager for agent templates - handles template storage, retrieval, and management
 */
export class AgentTemplateManager {
    private templates: Map<string, AgentTemplate> = new Map();
    private builtinTemplates: Map<string, AgentTemplate> = new Map();

    constructor() {
        this.loadBuiltinTemplates();
    }

    /**
     * Add a new template or update an existing one
     */
    addTemplate(template: AgentTemplate): void {
        this.validateTemplate(template);

        if (this.builtinTemplates.has(template.name)) {
            throw new Error(`Cannot override builtin template: ${template.name}`);
        }

        const templateWithMetadata: AgentTemplate = {
            ...template,
            metadata: {
                ...template.metadata,
                type: 'custom',
                createdAt: template.metadata?.createdAt || new Date(),
                updatedAt: new Date()
            }
        };

        this.templates.set(template.name, templateWithMetadata);
    }

    /**
     * Get a template by name
     */
    getTemplate(name: string): AgentTemplate | undefined {
        return this.templates.get(name) || this.builtinTemplates.get(name);
    }

    /**
     * Get all available templates
     */
    getAvailableTemplates(): AgentTemplate[] {
        const allTemplates = new Map([...this.builtinTemplates, ...this.templates]);
        return Array.from(allTemplates.values());
    }

    /**
     * Get templates filtered by tags
     */
    getTemplatesByTags(tags: string[]): AgentTemplate[] {
        return this.getAvailableTemplates().filter(template =>
            template.tags.some(tag => tags.includes(tag))
        );
    }

    /**
     * Remove a custom template
     */
    removeTemplate(name: string): boolean {
        if (this.builtinTemplates.has(name)) {
            throw new Error(`Cannot remove builtin template: ${name}`);
        }
        return this.templates.delete(name);
    }

    /**
     * Check if a template exists
     */
    hasTemplate(name: string): boolean {
        return this.templates.has(name) || this.builtinTemplates.has(name);
    }

    /**
     * Validate template structure using Zod schema
     */
    private validateTemplate(template: AgentTemplate): void {
        const result = safeValidateAgentTemplate(template);

        if (!result.success) {
            const errorMessages = getValidationErrors(result.error!);
            throw new Error(`Template validation failed:\n${errorMessages.join('\n')}`);
        }
    }

    /**
 * Load builtin templates from JSON file
 */
    private loadBuiltinTemplates(): void {
        try {
            // Import JSON templates
            const builtinTemplatesJson = require('../templates/builtin-templates.json');

            builtinTemplatesJson.forEach((template: AgentTemplate) => {
                // Validate each template before adding
                this.validateTemplate(template);
                this.builtinTemplates.set(template.name, template);
            });
        } catch (error) {
            console.warn('Failed to load builtin templates from JSON:', error);
            // No fallback - if loading fails, we have no builtin templates
        }
    }
}
