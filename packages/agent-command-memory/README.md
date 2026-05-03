# @robota-sdk/agent-command-memory

Composable command module that contributes the model-invocable `/memory` command.

```ts
import { createMemoryCommandModule } from '@robota-sdk/agent-command-memory';
```

The command package owns `/memory` descriptors, argument parsing, and output formatting. It uses SDK command memory APIs for project memory storage, pending candidate review, audit events, and used-memory provenance.
