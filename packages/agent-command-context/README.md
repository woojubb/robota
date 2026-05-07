# @robota-sdk/agent-command-context

Composable `/context` command module for Robota sessions. It reports context-window usage,
lists file references, manages manual context references, and owns `/context auto ...` controls
for automatic compaction.

```ts
import { createContextCommandModule } from '@robota-sdk/agent-command-context';
```

Hosts compose the module into `InteractiveSession` through the SDK command-module API.
