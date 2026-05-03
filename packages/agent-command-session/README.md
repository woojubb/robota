# @robota-sdk/agent-command-session

Composable session command module for Robota sessions.

```ts
import { createSessionCommandModule } from '@robota-sdk/agent-command-session';
```

The module consumes `@robota-sdk/agent-sdk` command contracts and session command APIs. Hosts compose it by default and apply any typed effects through their own UI or process adapters.

Commands:

- `/clear` clears SDK session history and emits `conversation-history-cleared`.
- `/rename <name>` emits `session-renamed` with the trimmed session name.
- `/resume` emits `session-picker-requested` so the host can show its saved-session picker.
- `/cost` shows the current session id and message count.
