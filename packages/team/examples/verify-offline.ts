import type { IToolExecutionContext, IToolResult, TUniversalValue } from '@robota-sdk/agents';
import {
    getTemplateDetailTool,
    listTemplateCategoriesTool,
    listTemplatesTool,
} from '../src/index.ts';

type TCategorySummary = {
    id: string;
    name: string;
    description?: string;
};

type TTemplateSummary = {
    id: string;
    name: string;
    description?: string;
    categoryId?: string;
};

const isObject = (value: TUniversalValue): value is Record<string, TUniversalValue> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
};

const isCategorySummary = (value: TUniversalValue): value is TCategorySummary => {
    if (!isObject(value)) return false;
    return typeof value.id === 'string' && typeof value.name === 'string';
};

const isTemplateSummary = (value: TUniversalValue): value is TTemplateSummary => {
    if (!isObject(value)) return false;
    return typeof value.id === 'string' && typeof value.name === 'string';
};

const createContext = (toolName: string, parameters: Record<string, TUniversalValue>): IToolExecutionContext => ({
    toolName,
    parameters,
    executionId: `verify_${toolName}`,
});

function expectSuccess(result: IToolResult, label: string): asserts result is IToolResult & { success: true } {
    if (!result.success) {
        throw new Error(result.error ?? `${label} failed`);
    }
}

async function main(): Promise<void> {
    const categoriesResult = await listTemplateCategoriesTool.execute({}, createContext('listTemplateCategories', {}));
    expectSuccess(categoriesResult, 'listTemplateCategories');
    if (!isObject(categoriesResult.data) || !Array.isArray(categoriesResult.data.categories)) {
        throw new Error('listTemplateCategories returned invalid payload.');
    }

    const categories = categoriesResult.data.categories.filter(isCategorySummary);
    if (categories.length === 0) {
        throw new Error('No template categories were returned.');
    }

    const templatesParams = { categoryId: categories[0].id };
    const templatesResult = await listTemplatesTool.execute(templatesParams, createContext('listTemplates', templatesParams));
    expectSuccess(templatesResult, 'listTemplates');
    if (!isObject(templatesResult.data) || !Array.isArray(templatesResult.data.templates)) {
        throw new Error('listTemplates returned invalid payload.');
    }

    const templates = templatesResult.data.templates.filter(isTemplateSummary);
    const selectedTemplate = templates[0];
    if (!selectedTemplate) {
        throw new Error('No templates were returned.');
    }

    const detailParams = { templateId: selectedTemplate.id };
    const detailResult = await getTemplateDetailTool.execute(detailParams, createContext('getTemplateDetail', detailParams));
    expectSuccess(detailResult, 'getTemplateDetail');
    if (!isObject(detailResult.data) || detailResult.data.id !== selectedTemplate.id) {
        throw new Error('Template detail payload does not match the selected template.');
    }

    process.stdout.write('team offline verify passed.\n');
}

void main();
