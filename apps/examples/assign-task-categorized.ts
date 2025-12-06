/**
 * assign-task-categorized.ts
 *
 * Template category-aware demo for assignTask tool collection.
 * Flow: listTemplateCategories -> listTemplates(category) -> getTemplateDetail -> assignTask
 * No LLM calls; constants only. For shape/reference use.
 */

import { listTemplateCategoriesTool, listTemplatesTool, getTemplateDetailTool, createAssignTaskRelayTool } from '@robota-sdk/team';
import { RelayMcpTool } from '@robota-sdk/agents';
import type { EventService } from '@robota-sdk/agents';

const noopEventService: EventService = { emit: () => undefined };

async function main() {
    const categoriesResult = await listTemplateCategoriesTool.execute({});
    if (!categoriesResult.success) {
        console.error('Failed to list categories:', categoriesResult.error);
        return;
    }
    const categories = (categoriesResult.data as any)?.categories ?? [];
    console.log('Categories:', categories);

    const categoryId = categories[0]?.id;
    const templatesResult = await listTemplatesTool.execute(categoryId ? { categoryId } : {});
    if (!templatesResult.success) {
        console.error('Failed to list templates:', templatesResult.error);
        return;
    }
    const templates = (templatesResult.data as any)?.templates ?? [];
    console.log('Templates:', templates);

    const selected = templates[0];
    if (!selected) {
        console.error('No templates available');
        return;
    }

    const detail = await getTemplateDetailTool.execute({ templateId: selected.id });
    if (!detail.success) {
        console.error('Failed to get template detail:', detail.error);
        return;
    }
    console.log('Template detail:', detail.data);

    const relay = createAssignTaskRelayTool(noopEventService) as RelayMcpTool;
    const jobDescription = 'Draft a brief market analysis and menu outline for a cafe.';

    const assignResult = await relay.execute({
        templateId: selected.id,
        jobDescription,
        provider: (detail.data as any)?.provider,
        model: (detail.data as any)?.model
    }, {
        ownerPath: [{ type: 'tool', id: 'assignTask' }],
        agentId: 'agent_assign_categorized',
        eventService: noopEventService
    } as any);

    console.log('AssignTask result (shape only, no LLM call expected):', assignResult);
}

main().catch((err) => {
    console.error('assign-task-categorized failed:', err);
});

