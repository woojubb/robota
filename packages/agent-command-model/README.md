# @robota-sdk/agent-command-model

Composable `/model` command module for Robota sessions.

```ts
import { createModelCommandModule } from '@robota-sdk/agent-command-model';
```

The module consumes `@robota-sdk/agent-sdk` command contracts and returns typed `model-change-requested` effects. Hosts apply those effects through their own settings/restart adapters.
