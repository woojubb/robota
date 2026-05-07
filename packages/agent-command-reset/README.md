# @robota-sdk/agent-command-reset

Composable command module that contributes the user-only `/reset` command.

```ts
import { createResetCommandModule } from '@robota-sdk/agent-command-reset';
```

The command does not delete files directly. It emits the SDK `settings-reset-requested` effect so the host can apply settings file I/O and shutdown behavior through its own adapter/UI boundary.
