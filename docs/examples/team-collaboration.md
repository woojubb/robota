# assignTask Tool Collection (team package)

Team collaboration features have been removed. The `@robota-sdk/team` package now provides assignTask MCP tools only.

## Quick Start

```typescript
import { createAssignTaskRelayTool, listTemplatesTool, getTemplateDetailTool } from '@robota-sdk/team';
import { DefaultEventService, bindWithOwnerPath } from '@robota-sdk/agents';

// List templates
const templatesResult = await listTemplatesTool.execute({});
if (!templatesResult.success) {
  throw new Error(templatesResult.error ?? 'listTemplates failed');
}

const templates = (templatesResult.data as { templates: Array<{ id: string }> }).templates;

const selected = templates[0];
if (!selected) {
  throw new Error('No templates available');
}

// Get detail
const detail = await getTemplateDetailTool.execute({ templateId: selected.id });

// Create a tool-call scoped EventService (ownerPath must be absolute and end with the tool segment).
// In real usage, ExecutionService/ToolExecutionService provides this binding automatically.
const baseEventService = new DefaultEventService();
const toolCallId = 'tool_call_0';
const toolEventService = bindWithOwnerPath(baseEventService, {
  ownerType: 'tool',
  ownerId: toolCallId,
  ownerPath: [{ type: 'tool', id: toolCallId }],
  sourceType: 'tool',
  sourceId: toolCallId
});

const assignTask = createAssignTaskRelayTool(toolEventService);

// assignTask is typically executed by ToolExecutionService with a ToolExecutionContext that provides:
// - ctx.eventService (tool-call scoped, ownerPath-bound)
// - ctx.baseEventService (unbound, required if the tool creates a delegated agent)
// - ctx.ownerPath (absolute ownerPath including the tool segment)
// - ctx.agentId (delegated agent id)
//
// See apps/examples/26-guarded-edge-verification.ts for a fully guarded, scenario-playback execution.
```

## Notes
- No team creation APIs remain; use Robota agents plus assignTask tool collection.
- Templates are bundled JSON; override provider/model via params when needed.
- Always use an absolute ownerPath (full path). Do not infer relationships via ID parsing or prefixes.

