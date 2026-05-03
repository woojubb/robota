# @robota-sdk/agent-command-exit

Composable `/exit` command module for Robota hosts.

The package owns command metadata and returns a typed `session-exit-requested` effect. Concrete shutdown, session persistence, and process exit remain host-owned.

```ts
import { createExitCommandModule } from '@robota-sdk/agent-command-exit';
```

The command is user-invocable only and uses inline lifecycle metadata because it does not call the model or perform host I/O.
