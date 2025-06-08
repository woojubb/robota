export interface PromptTemplate {
    render(variables: Record<string, any>): string;
    getVariables(): string[];
}

export class SimplePromptTemplate implements PromptTemplate {
    private template: string;
    private variables: string[];

    constructor(template: string) {
        this.template = template;
        this.variables = this.extractVariables(template);
    }

    render(variables: Record<string, any>): string {
        let result = this.template;

        for (const [key, value] of Object.entries(variables)) {
            const placeholder = `{{${key}}}`;
            result = result.replace(new RegExp(placeholder, 'g'), String(value));
        }

        return result;
    }

    getVariables(): string[] {
        return [...this.variables];
    }

    private extractVariables(template: string): string[] {
        const matches = template.match(/\{\{([^}]+)\}\}/g);
        if (!matches) return [];

        return matches.map(match => match.slice(2, -2).trim());
    }

    static create(template: string): SimplePromptTemplate {
        return new SimplePromptTemplate(template);
    }
} 