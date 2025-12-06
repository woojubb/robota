/**
 * assign-task-basic.ts
 *
 * Minimal assignTask tool collection demo without @robota-sdk/team.
 * Flow: listTemplates -> getTemplateDetail -> assignTask
 * Notes:
 * - Uses built-in templates (templates.json in @robota-sdk/team/assign-task).
 * - No live LLM calls; provider/model are provided as constants.
 * - Guard: do not execute network calls in this example. It's a shape demo only.
 */

import { createAssignTaskRelayTool, listTemplatesTool, getTemplateDetailTool } from '@robota-sdk/team';
import { RelayMcpTool } from '@robota-sdk/agents';
import type { EventService } from '@robota-sdk/agents';

// Minimal no-op event service (ownerPath handled upstream in real use)
const noopEventService: EventService = {
    emit: () => undefined
};

async function main() {
    // 1) list templates
    const listResult = await listTemplatesTool.execute({});
    if (!listResult.success) {
        console.error('Failed to list templates:', listResult.error);
        return;
    }
    const templates = (listResult.data as any)?.templates ?? [];
    console.log('Templates:', templates);

    // Pick first template for demo
    const selected = templates[0];
    if (!selected) {
        console.error('No templates available');
        return;
    }

    // 2) get template detail
    const detail = await getTemplateDetailTool.execute({ templateId: selected.id });
    if (!detail.success) {
        console.error('Failed to get template detail:', detail.error);
        return;
    }
    console.log('Template detail:', detail.data);

    // 3) assignTask via Relay MCP Tool (no LLM run; this only shows shape)
    const relay = createAssignTaskRelayTool(noopEventService) as RelayMcpTool;
    const jobDescription = 'Summarize the advantages of TypeScript for large codebases.';

    const assignResult = await relay.execute({
        templateId: selected.id,
        jobDescription,
        // Override example (kept inline, no network):
        provider: (detail.data as any)?.provider,
        model: (detail.data as any)?.model
    }, {
        // Minimal execution context shape
        ownerPath: [{ type: 'tool', id: 'assignTask' }],
        agentId: 'agent_assign_demo',
        eventService: noopEventService
    } as any);

    console.log('AssignTask result (shape only, no LLM call expected):', assignResult);
}

// Guarded entry (no real network expected)
main().catch((err) => {
    console.error('assign-task-basic failed:', err);
});

