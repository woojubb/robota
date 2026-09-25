# @robota-sdk/agent-interface-session-mobility

Session-mobility contracts and handoff orchestration for the Robota SDK — peer messaging between
live sessions, and handoff of session authority to another machine.

This package owns the handoff authority transaction, settled-work offer policy, resource inventory,
and source/destination orchestration. A host still decides whether a given destination is authorized
and supplies transport, record decoding, and durable persistence.

```ts
import type { IPeerMessage } from '@robota-sdk/agent-interface-session-mobility';
import { isHandoffCommitted } from '@robota-sdk/agent-interface-session-mobility';
```

See [`docs/SPEC.md`](docs/SPEC.md) for the full contract and the boundaries.

## License

AGPL-3.0-only OR LicenseRef-Commercial
