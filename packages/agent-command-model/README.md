# @robota-sdk/agent-command-model

Composable `/model` command module for Robota sessions.

```ts
import { createModelCommandModule } from '@robota-sdk/agent-command-model';
```

The module consumes `@robota-sdk/agent-sdk` command contracts and model command common APIs, then
returns typed `model-change-requested` effects. Hosts apply those effects through their own
settings/restart adapters.

When invoked without a model id, the command asks the SDK common API for the active provider catalog.
Provider-owned refresh hooks may update the catalog freshness state, but manual `/model <model-id>`
input remains available even when refresh is unavailable.
