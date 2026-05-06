# @robota-sdk/agent-command-skills

Composable `/skills` command module for Robota sessions.

```ts
import { createSkillsCommandModule } from '@robota-sdk/agent-command-skills';

const commandModules = [createSkillsCommandModule({ cwd: process.cwd() })];
```

The module exposes `/skills` as a standard model-invocable built-in command. Models call it through the generic `ExecuteCommand` tool with `command: "skills"`. Individual skill names remain virtual aliases handled by the SDK command execution path.

## Documents

- [SPEC.md](SPEC.md) — package contract, ownership, public API, and verification expectations.
