# @robota-sdk/agent-command-provider

Composable `/provider` command module for Robota sessions.

```ts
import { createProviderCommandModule } from '@robota-sdk/agent-command-provider';
```

This package owns provider slash command metadata, setup flow orchestration, provider switching, and profile testing. It consumes SDK command contracts and provider common APIs from `@robota-sdk/agent-sdk`; it does not own provider construction or CLI/TUI rendering.
