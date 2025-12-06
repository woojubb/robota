# assignTask Tool Collection (team package)

Legacy team collaboration has been removed. The `@robota-sdk/team` package now provides assignTask MCP tools only.

## Quick Start

```typescript
import { createAssignTaskRelayTool, listTemplatesTool, getTemplateDetailTool } from '@robota-sdk/team';

// List templates
const templates = await listTemplatesTool.execute({});
const selected = (templates.data as any)?.templates?.[0];
if (!selected) {
  throw new Error('No templates available');
}

// Get detail
const detail = await getTemplateDetailTool.execute({ templateId: selected.id });

// Create assignTask tool (eventService injected by caller in real usage)
const assignTask = createAssignTaskRelayTool({ emit: () => undefined } as any);

const result = await assignTask.execute({
  templateId: selected.id,
  jobDescription: 'Create a cafe business plan with market analysis and menu composition.'
}, {
  ownerPath: [{ type: 'tool', id: 'assignTask' }],
  agentId: 'agent_assign_demo',
  eventService: { emit: () => undefined }
} as any);

console.log(result);
```

## Notes
- No team creation APIs remain; use Robota agents plus assignTask tool collection.
- Templates are bundled JSON; override provider/model via params when needed.
- Wire real eventService/ownerPath in your runtime; examples use no-op emitters.

