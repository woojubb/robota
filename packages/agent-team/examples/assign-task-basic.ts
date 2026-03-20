/**
 * assign-task-basic example for @robota-sdk/agent-team.
 *
 * Flow: listTemplates -> getTemplateDetail -> print assignTask call shape
 * Note: This example does NOT execute assignTask. It is tool-only and offline.
 */

import { listTemplatesTool, getTemplateDetailTool } from '@robota-sdk/agent-team';
import type { IToolExecutionContext, IToolResult, TUniversalValue } from '@robota-sdk/agent-core';
import type { TTemplateSummary, TTemplatesListPayload } from './template-payloads.js';

const isObject = (value: TUniversalValue): value is Record<string, TUniversalValue> => {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
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

async function main(): Promise<void> {
  const listParams = {};
  const listContext: IToolExecutionContext = {
    toolName: 'listTemplates',
    parameters: listParams,
    executionId: 'example_listTemplates',
  };
  const listResult = await listTemplatesTool.execute(listParams, listContext);
  const { templates } = extractTemplatesList(listResult);
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
    executionId: 'example_getTemplateDetail',
  };
  const detail = await getTemplateDetailTool.execute(detailParams, detailContext);
  if (!detail.success) {
    throw new Error(detail.error ?? 'getTemplateDetail failed');
  }
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.log('Template detail:', detail.data);

  const jobDescription = 'Summarize the advantages of TypeScript for large codebases.';
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
