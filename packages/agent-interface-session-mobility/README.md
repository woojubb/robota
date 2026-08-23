# @robota-sdk/agent-interface-session-mobility

Session-mobility contract interfaces for the Robota SDK — peer messaging between live sessions, and
handoff of session authority to another machine.

Type declarations plus four discriminators. This package declares that authority **can** move and what
that looks like; it decides nothing about whether a given move is permitted.

```ts
import type { IPeerMessage } from '@robota-sdk/agent-interface-session-mobility';
import { isHandoffCommitted } from '@robota-sdk/agent-interface-session-mobility';
```

See [`docs/SPEC.md`](docs/SPEC.md) for the full contract and the boundaries.

## License

AGPL-3.0-only OR LicenseRef-Commercial
