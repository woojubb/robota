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
import type { IToolExecutionContext, IToolResult, TUniversalValue } from '@robota-sdk/agents';
import type { TTemplateSummary, TTemplatesListPayload } from './lib/template-payloads';
import { createHash } from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ScenarioStore, stringifyToolArguments, createScenarioToolWrapper } from '@robota-sdk/workflow/scenario';

const isObject = (value: TUniversalValue): value is Record<string, TUniversalValue> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
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
        if (!isTemplateSummary(item as TUniversalValue)) {
            throw new Error('listTemplates returned invalid template item');
        }
        templates.push(item as TTemplateSummary);
    }
    return { templates };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveScenarioMode(): { mode: 'record' | 'play' | 'none'; scenarioId?: string } {
    const recordId = process.env.SCENARIO_RECORD_ID;
    const playId = process.env.SCENARIO_PLAY_ID;
    if (recordId && playId) {
        throw new Error('[SCENARIO-GUARD] Both SCENARIO_RECORD_ID and SCENARIO_PLAY_ID are set. Choose exactly one.');
    }
    if (recordId) return { mode: 'record', scenarioId: recordId };
    if (playId) return { mode: 'play', scenarioId: playId };
    return { mode: 'none' };
}

function createDeterministicToolCallId(toolName: string, parameters: Record<string, TUniversalValue>): string {
    const toolArguments = stringifyToolArguments(parameters);
    const input = `${toolName}:${toolArguments}`;
    return createHash('md5').update(input).digest('hex');
}

async function main() {
    const scenario = resolveScenarioMode();
    const store = new ScenarioStore({ baseDir: path.resolve(__dirname, 'scenarios') });
    const usedToolCallIds = new Set<string>();

    const listTool =
        scenario.mode === 'none'
            ? listTemplatesTool
            : createScenarioToolWrapper(listTemplatesTool, {
                mode: scenario.mode,
                scenarioId: scenario.scenarioId,
                store,
                ...(scenario.mode === 'play' ? { onToolCallUsed: (id) => usedToolCallIds.add(id) } : undefined)
            });

    const detailTool =
        scenario.mode === 'none'
            ? getTemplateDetailTool
            : createScenarioToolWrapper(getTemplateDetailTool, {
                mode: scenario.mode,
                scenarioId: scenario.scenarioId,
                store,
                ...(scenario.mode === 'play' ? { onToolCallUsed: (id) => usedToolCallIds.add(id) } : undefined)
            });

    const listParams = {};
    const listToolCallId = createDeterministicToolCallId('listTemplates', listParams as Record<string, TUniversalValue>);
    const listContext: IToolExecutionContext = { toolName: 'listTemplates', parameters: listParams, executionId: listToolCallId };
    const listResult = await listTool.execute(listParams, listContext);
    const { templates } = extractTemplatesList(listResult);
    console.log('Templates:', templates);

    // Pick first template for demo
    const selected = templates[0];
    if (!selected) {
        throw new Error('No templates available');
    }

    const detailParams = { templateId: selected.id };
    const detailToolCallId = createDeterministicToolCallId('getTemplateDetail', detailParams as Record<string, TUniversalValue>);
    const detailContext: IToolExecutionContext = {
        toolName: 'getTemplateDetail',
        parameters: detailParams,
        executionId: detailToolCallId
    };
    const detail = await detailTool.execute(detailParams, detailContext);
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

    if (scenario.mode === 'play') {
        if (!scenario.scenarioId) {
            throw new Error('[SCENARIO] Missing scenarioId in play mode');
        }
        await store.assertNoUnusedToolResultsForPlay(scenario.scenarioId, usedToolCallIds);
    }
}

main().catch((err) => {
    console.error('assign-task-basic failed:', err instanceof Error ? err.message : String(err));
});

