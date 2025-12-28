/**
 * assign-task-categorized example for @robota-sdk/team.
 *
 * Flow: listTemplateCategories -> listTemplates(category) -> getTemplateDetail -> print assignTask call shape
 * Note: This example does NOT execute assignTask. It is tool-only and offline.
 */

import { listTemplateCategoriesTool, listTemplatesTool, getTemplateDetailTool } from '@robota-sdk/team';
import type { IToolExecutionContext, IToolResult, TUniversalValue } from '@robota-sdk/agents';
import type { TTemplateSummary, TTemplatesListPayload } from './template-payloads.js';

type TCategorySummary = {
    id: string;
    name: string;
    description?: string;
};

type TCategoriesPayload = {
    categories: TCategorySummary[];
};

const isObject = (value: TUniversalValue): value is Record<string, TUniversalValue> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
};

const isCategorySummary = (value: TUniversalValue): value is TCategorySummary => {
    if (!isObject(value)) return false;
    const id = value.id;
    const name = value.name;
    if (typeof id !== 'string' || id.length === 0) return false;
    if (typeof name !== 'string' || name.length === 0) return false;
    const description = value.description;
    if (description !== undefined && typeof description !== 'string') return false;
    return true;
};

const isTemplateSummary = (value: TUniversalValue): value is TTemplateSummary => {
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

const extractCategories = (result: IToolResult): TCategoriesPayload => {
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
    const categories: TCategorySummary[] = [];
    for (const item of categoriesValue) {
        if (!isCategorySummary(item)) {
            throw new Error('listTemplateCategories returned invalid category item');
        }
        categories.push(item);
    }
    return { categories };
};

const extractTemplatesList = (result: IToolResult): TTemplatesListPayload => {
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
    const templates: TTemplateSummary[] = [];
    for (const item of templatesValue) {
        if (!isTemplateSummary(item)) {
            throw new Error('listTemplates returned invalid template item');
        }
        templates.push(item);
    }
    return { templates };
};

async function main(): Promise<void> {
    const categoriesContext: IToolExecutionContext = {
        toolName: 'listTemplateCategories',
        parameters: {},
        executionId: 'example_listTemplateCategories'
    };
    const categoriesResult = await listTemplateCategoriesTool.execute({}, categoriesContext);
    const { categories } = extractCategories(categoriesResult);
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.log('Categories:', categories);

    const categoryId = categories[0]?.id;
    const templatesParams = categoryId ? { categoryId } : {};
    const templatesContext: IToolExecutionContext = {
        toolName: 'listTemplates',
        parameters: templatesParams,
        executionId: 'example_listTemplates'
    };
    const templatesResult = await listTemplatesTool.execute(templatesParams, templatesContext);
    const { templates } = extractTemplatesList(templatesResult);
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.log('Templates:', templates);

    const selected = templates[0];
    if (!selected) {
        throw new Error('No templates available');
    }

    const detailParams = { templateId: selected.id };
    const detailContext: IToolExecutionContext = {
        toolName: 'getTemplateDetail',
        parameters: detailParams,
        executionId: 'example_getTemplateDetail'
    };
    const detail = await getTemplateDetailTool.execute(detailParams, detailContext);
    if (!detail.success) {
        throw new Error(detail.error ?? 'getTemplateDetail failed');
    }
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.log('Template detail:', detail.data);

    const jobDescription = 'Draft a brief market analysis and menu outline for a cafe.';
    const assignTaskCall = {
        templateId: selected.id,
        jobDescription,
        // Optional overrides (provider/model/temperature/maxTokens/context)
    };

    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.log('assignTask call shape (not executed):', assignTaskCall);
}

main().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.error(err.message);
    process.exit(1);
});


