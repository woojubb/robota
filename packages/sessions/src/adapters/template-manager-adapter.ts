import { AgentFactory, AgentTemplates, type IAgentConfig, type IAgentTemplate } from '@robota-sdk/agents';
import type { ITemplateManager } from '../types/chat';

/**
 * TemplateManagerAdapter - adapts agents package AgentFactory/AgentTemplates to ITemplateManager interface
 * 
 * This adapter allows the sessions package to use the template functionality from
 * the agents package without duplicating implementation.
 */
export class TemplateManagerAdapter implements ITemplateManager {
    private agentFactory: AgentFactory;
    private agentTemplates: AgentTemplates;

    constructor(agentFactory?: AgentFactory) {
        this.agentFactory = agentFactory || new AgentFactory();
        this.agentTemplates = new AgentTemplates();
    }

    /**
     * Get template configuration by name
     */
    getTemplate(name: string): IAgentConfig | undefined {
        const template = this.agentTemplates.getTemplate(name);
        if (!template) {
            return undefined;
        }

        return template.config;
    }

    /**
     * List all available template names
     */
    listTemplates(): string[] {
        const templates = this.agentTemplates.getTemplates();
        return templates.map(template => template.id);
    }

    /**
     * Validate template configuration
     */
    validateTemplate(config: IAgentConfig): boolean {
        // Single authoritative validation path (no fallback).
        const validation = this.agentFactory.validateConfiguration(config);
        return validation.isValid;
    }

    /**
     * Register a new template
     */
    registerTemplate(template: IAgentTemplate): void {
        this.agentTemplates.registerTemplate(template);
    }

    /**
     * Unregister a template
     */
    unregisterTemplate(templateId: string): boolean {
        return this.agentTemplates.unregisterTemplate(templateId);
    }

    /**
     * Get template details (full template object)
     */
    getTemplateDetails(name: string): IAgentTemplate | undefined {
        return this.agentTemplates.getTemplate(name);
    }

    /**
     * Apply template to create agent config with overrides
     */
    applyTemplate(templateId: string, overrides: Partial<IAgentConfig> = {}): IAgentConfig | undefined {
        const template = this.agentTemplates.getTemplate(templateId);
        if (!template) {
            return undefined;
        }

        // Apply template with overrides using AgentFactory
        const result = this.agentFactory.applyTemplate(template, overrides);
        return result.config;
    }
} 