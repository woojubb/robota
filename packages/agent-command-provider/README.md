# @robota-sdk/agent-command-provider

Composable `/provider` command module for Robota sessions.

```ts
import { createProviderCommandModule } from '@robota-sdk/agent-command-provider';
```

This package owns provider slash command metadata, setup flow orchestration, provider switching, profile testing, and the provider profile management interaction chain. `/provider` and `/provider list` can return generic SDK interactions for profile selection and actions such as switch, edit, test, duplicate, and delete. It consumes SDK command contracts and provider common APIs from `@robota-sdk/agent-sdk`; it does not own provider construction or CLI/TUI rendering.
