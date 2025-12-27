/**
 * assign-task-categorized.ts
 *
 * Template category-aware demo for assignTask tool collection.
 * Flow: listTemplateCategories -> listTemplates(category) -> getTemplateDetail -> print assignTask call shape
 * Notes:
 * - No live LLM calls in this example (it does not execute assignTask).
 */

import { listTemplateCategoriesTool, listTemplatesTool, getTemplateDetailTool } from '@robota-sdk/team';
import type { IToolExecutionContext, IToolResult, TToolResultData } from '@robota-sdk/agents';
import type { TemplateSummary, TemplatesListPayload } from './lib/template-payloads';

type CategorySummary = {
    id: string;
    name: string;
    description?: string;
};

type CategoriesPayload = {
    categories: CategorySummary[];
};

const isObject = (value: TToolResultData): value is Record<string, TToolResultData> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isCategorySummary = (value: TToolResultData): value is CategorySummary => {
    if (!isObject(value)) return false;
    const id = value.id;
    const name = value.name;
    if (typeof id !== 'string' || id.length === 0) return false;
    if (typeof name !== 'string' || name.length === 0) return false;
    const description = value.description;
    if (description !== undefined && typeof description !== 'string') return false;
    return true;
};

const isTemplateSummary = (value: TToolResultData): value is TemplateSummary => {
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

const extractCategories = (result: IToolResult): CategoriesPayload => {
    if (!result.success) {
        throw new Error(result.error ?? 'listTemplateCategories failed');
    }
    const data = result.data;
    if (!data || !isObject(data)) {
        throw new Error('listTemplateCategories returned invalid data');
    }
    const categoriesValue = data.categories;
    if (!Array.isArray(categoriesValue)) {
        throw new Error('listTemplateCategories returned invalid categories');
    }
    const categories: CategorySummary[] = [];
    for (const item of categoriesValue) {
        if (!isCategorySummary(item)) {
            throw new Error('listTemplateCategories returned invalid category item');
        }
        categories.push(item);
    }
    return { categories };
};

const extractTemplatesList = (result: IToolResult): TemplatesListPayload => {
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
        if (!isTemplateSummary(item)) {
            throw new Error('listTemplates returned invalid template item');
        }
        templates.push(item);
    }
    return { templates };
};

async function main() {
    const categoriesContext: IToolExecutionContext = { toolName: 'listTemplateCategories', parameters: {} };
    const categoriesResult = await listTemplateCategoriesTool.execute({}, categoriesContext);
    const { categories } = extractCategories(categoriesResult);
    console.log('Categories:', categories);

    const categoryId = categories[0]?.id;
    const templatesParams = categoryId ? { categoryId } : {};
    const templatesContext: IToolExecutionContext = { toolName: 'listTemplates', parameters: templatesParams };
    const templatesResult = await listTemplatesTool.execute(templatesParams, templatesContext);
    const { templates } = extractTemplatesList(templatesResult);
    console.log('Templates:', templates);

    const selected = templates[0];
    if (!selected) {
        throw new Error('No templates available');
    }

    const detailContext: IToolExecutionContext = {
        toolName: 'getTemplateDetail',
        parameters: { templateId: selected.id }
    };
    const detail = await getTemplateDetailTool.execute({ templateId: selected.id }, detailContext);
    if (!detail.success) {
        throw new Error(detail.error ?? 'getTemplateDetail failed');
    }
    console.log('Template detail:', detail.data);

    const jobDescription = 'Draft a brief market analysis and menu outline for a cafe.';
    const assignTaskCall = {
        templateId: selected.id,
        jobDescription,
        // Optional overrides (provider/model/temperature/maxTokens/context)
    };

    console.log('assignTask call shape (not executed):', assignTaskCall);
}

main().catch((err) => {
    console.error('assign-task-categorized failed:', err instanceof Error ? err.message : String(err));
});

