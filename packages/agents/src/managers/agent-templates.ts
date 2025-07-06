import { AgentTemplate, AgentConfig } from '../interfaces/agent';
import { Logger, createLogger } from '../utils/logger';

/**
 * Reusable type definitions for agent templates
 */

/**
 * Agent template configuration data type
 * Used for storing template configuration values
 */
export type AgentTemplateConfigurationData = Record<string, string | number | boolean | string[] | number[] | boolean[]>;

/**
 * Agent template configuration - uses AgentConfig type
 */
export type AgentTemplateConfig = AgentConfig;

/**
 * Template application result
 */
export interface TemplateApplicationResult {
    /** Applied configuration */
    config: AgentTemplateConfig;
    /** Template that was applied */
    template: AgentTemplate;
    /** Any warnings during application */
    warnings: string[];
    /** Whether config was modified during application */
    modified: boolean;
}

/**
 * Agent Templates implementation
 * Manages agent templates for AgentFactory
 * Instance-based for isolated template management
 */
export class AgentTemplates {
    private templates = new Map<string, AgentTemplate>();
    private logger: Logger;

    constructor() {
        this.logger = createLogger('AgentTemplates');
        this.logger.info('AgentTemplates initialized');
    }

    /**
     * Register a template
     */
    registerTemplate(template: AgentTemplate): void {
        if (!template.id) {
            throw new Error('Template must have an ID');
        }

        if (this.templates.has(template.id)) {
            this.logger.warn(`Template "${template.id}" is already registered, overriding`);
        }

        this.templates.set(template.id, template);
        this.logger.info(`Template "${template.id}" registered successfully`, {
            templateId: template.id,
            category: template.category,
            tags: template.tags
        });
    }

    /**
     * Unregister a template
     */
    unregisterTemplate(templateId: string): boolean {
        const removed = this.templates.delete(templateId);
        if (removed) {
            this.logger.info(`Template "${templateId}" unregistered`);
        } else {
            this.logger.warn(`Attempted to unregister non-existent template "${templateId}"`);
        }
        return removed;
    }

    /**
     * Get all templates
     */
    getTemplates(): AgentTemplate[] {
        return Array.from(this.templates.values());
    }

    /**
     * Get template by ID
     */
    getTemplate(templateId: string): AgentTemplate | undefined {
        return this.templates.get(templateId);
    }

    /**
     * Find templates by criteria
     */
    findTemplates(criteria: {
        category?: string;
        tags?: string[];
        provider?: string;
        model?: string;
    }): AgentTemplate[] {
        return this.getTemplates().filter(template => {
            // Check category
            if (criteria.category && template.category !== criteria.category) {
                return false;
            }

            // Check tags
            if (criteria.tags && criteria.tags.length > 0) {
                const hasAnyTag = criteria.tags.some(tag =>
                    template.tags?.includes(tag)
                );
                if (!hasAnyTag) {
                    return false;
                }
            }

            // Check provider
            if (criteria.provider && template.config.provider !== criteria.provider) {
                return false;
            }

            // Check model
            if (criteria.model && template.config.model !== criteria.model) {
                return false;
            }

            return true;
        });
    }

    /**
     * Apply template to configuration
     */
    applyTemplate(template: AgentTemplate, overrides: Partial<AgentTemplateConfig> = {}): TemplateApplicationResult {
        const warnings: string[] = [];
        let modified = false;

        // Start with template configuration
        const config: AgentTemplateConfig = { ...template.config };

        // Apply overrides with type-safe approach
        const mergedConfig = { ...config, ...overrides } as AgentTemplateConfig;

        // Check for modifications by comparing specific known fields
        const checkField = (fieldName: keyof AgentConfig): void => {
            if (fieldName in overrides && config[fieldName] !== overrides[fieldName]) {
                modified = true;
                if (config[fieldName] !== undefined) {
                    warnings.push(`Override: ${fieldName} changed from "${String(config[fieldName])}" to "${String(overrides[fieldName])}"`);
                }
            }
        };

        // Check common override fields
        if (overrides.name !== undefined) checkField('name');
        if (overrides.model !== undefined) checkField('model');
        if (overrides.provider !== undefined) checkField('provider');
        if (overrides.temperature !== undefined) checkField('temperature');
        if (overrides.maxTokens !== undefined) checkField('maxTokens');
        if (overrides.systemMessage !== undefined) checkField('systemMessage');

        // Use the merged config
        const finalConfig = mergedConfig;

        this.logger.debug('Template applied', {
            templateId: template.id,
            overridesCount: Object.keys(overrides).length,
            warningsCount: warnings.length,
            modified
        });

        return {
            config: finalConfig,
            template,
            warnings,
            modified
        };
    }

    /**
     * Check if template exists
     */
    hasTemplate(templateId: string): boolean {
        return this.templates.has(templateId);
    }

    /**
     * Get template count
     */
    getTemplateCount(): number {
        return this.templates.size;
    }

    /**
     * Clear all templates
     */
    clearAll(): void {
        this.templates.clear();
        this.logger.info('All templates cleared');
    }

    /**
     * Get template statistics
     */
    getStats(): {
        totalTemplates: number;
        categories: string[];
        tags: string[];
        providers: string[];
        models: string[];
    } {
        const templates = this.getTemplates();
        const categories = [...new Set(templates.map(t => t.category).filter(Boolean))] as string[];
        const tags = [...new Set(templates.flatMap(t => t.tags || []))];
        const providers = [...new Set(templates.map(t => t.config.provider).filter(Boolean))] as string[];
        const models = [...new Set(templates.map(t => t.config.model).filter(Boolean))] as string[];

        return {
            totalTemplates: templates.length,
            categories,
            tags,
            providers,
            models
        };
    }
} 