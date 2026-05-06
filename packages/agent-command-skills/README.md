# @robota-sdk/agent-command-skills

Composable `skills` command module for Robota sessions. User-facing shells render and parse it as `/skills`; SDK command identity remains `skills`.

```ts
import { createSkillsCommandModule } from '@robota-sdk/agent-command-skills';

const commandModules = [createSkillsCommandModule({ cwd: process.cwd() })];
```

`skills` follows the same command-module layering as other built-in commands. Models invoke it through the generic `ExecuteCommand` tool with `command: "skills"` and skill arguments in `args`. When this model-invocable command module is composed, skill metadata is listed in the SDK-composed system prompt `Skills` section; full skill content is loaded only after SDK activation.
