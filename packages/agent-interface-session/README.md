# @robota-sdk/agent-interface-session

Session contract interfaces for the Robota SDK — interactive sessions, interaction channels, session
events, turns and persistence.

Type declarations plus the narrow accessors and discriminators the Interface Package Rule permits.

```ts
import type {
  IInteractiveSession,
  IInteractiveSessionRecord,
  ITurnHandle,
  InteractionEvent,
} from '@robota-sdk/agent-interface-session';
import { readAssistantReplies, isTurnNotRunError } from '@robota-sdk/agent-interface-session';
```

See [`docs/SPEC.md`](docs/SPEC.md) for the full contract and the boundaries.

## License

AGPL-3.0-only OR LicenseRef-Commercial
