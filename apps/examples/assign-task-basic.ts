/**
 * assign-task-basic.ts
 *
 * Minimal assignTask tool collection demo.
 * Flow: listTemplates -> getTemplateDetail -> print assignTask call shape
 * Notes:
 * - Uses built-in templates (templates.json in @robota-sdk/team/assign-task).
 * - No live LLM calls in this example (it does not execute assignTask).
 */

import { listTemplatesTool, getTemplateDetailTool } from '@robota-sdk/team';
import type { ToolExecutionContext, ToolExecutionData, ToolResult } from '@robota-sdk/agents';

type TemplateSummary = {
    id: string;
    name: string;
    description?: string;
    categoryId?: string;
};

type TemplatesListPayload = {
    templates: TemplateSummary[];
};

const isObject = (value: ToolExecutionData): value is Record<string, ToolExecutionData> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isTemplateSummary = (value: ToolExecutionData): value is TemplateSummary => {
    if (!isObject(value)) return false;
    const id = value.id;
    const name = value.name;
    if (typeof id !== 'string' || id.length === 0) return false;
    if (typeof name !== 'string' || name.length === 0) return false;
    const description = value.description;
    if (description !== undefined && typeof description !== 'string') return false;
    const categoryId = value.categoryId;
    if (categoryId !== undefined && typeof categoryId !== 'string') return false;
    return true;
};

const extractTemplatesList = (result: ToolResult): TemplatesListPayload => {
    if (!result.success) {
        throw new Error(result.error ?? 'listTemplates failed');
    }
    const data = result.data;
    if (!data || !isObject(data)) {
        throw new Error('listTemplates returned invalid data');
    }
    const templatesValue = data.templates;
    if (!Array.isArray(templatesValue)) {
        throw new Error('listTemplates returned invalid templates');
    }
    const templates: TemplateSummary[] = [];
    for (const item of templatesValue) {
        if (!isTemplateSummary(item as ToolExecutionData)) {
            throw new Error('listTemplates returned invalid template item');
        }
        templates.push(item as TemplateSummary);
    }
    return { templates };
};

async function main() {
    const listContext: ToolExecutionContext = { toolName: 'listTemplates', parameters: {} };
    const listResult = await listTemplatesTool.execute({}, listContext);
    const { templates } = extractTemplatesList(listResult);
    console.log('Templates:', templates);

    // Pick first template for demo
    const selected = templates[0];
    if (!selected) {
        throw new Error('No templates available');
    }

    const detailContext: ToolExecutionContext = {
        toolName: 'getTemplateDetail',
        parameters: { templateId: selected.id }
    };
    const detail = await getTemplateDetailTool.execute({ templateId: selected.id }, detailContext);
    if (!detail.success) {
        throw new Error(detail.error ?? 'getTemplateDetail failed');
    }
    console.log('Template detail:', detail.data);

    // This example intentionally does NOT execute assignTask to avoid network/LLM calls.
    // Instead, it prints a ready-to-use call shape.
    const jobDescription = 'Summarize the advantages of TypeScript for large codebases.';
    const assignTaskCall = {
        templateId: selected.id,
        jobDescription,
        // Optional overrides (provider/model/temperature/maxTokens/context)
    };

    console.log('assignTask call shape (not executed):', assignTaskCall);
}

main().catch((err) => {
    console.error('assign-task-basic failed:', err instanceof Error ? err.message : String(err));
});

