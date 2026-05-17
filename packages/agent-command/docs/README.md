# @robota-sdk/agent-command

Consolidated command module for the Robota SDK CLI. Provides all slash-command implementations
(`/agent`, `/background`, `/compact`, `/context`, `/exit`, `/help`, `/language`, `/memory`,
`/mode`, `/model`, `/permissions`, `/plugin`, `/provider`, `/reset`, `/rewind`, `/session`,
`/settings`, `/skills`, `/statusline`, `/user-local`) as a single importable package.

## Usage

```typescript
import { createDefaultCommandModules } from '@robota-sdk/agent-command';

const commandModules = createDefaultCommandModules({ cwd, providerDefinitions });
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, ownership boundaries, and public API surface.
