---
title: Runtime migration
description: Existing Robota entry points and explicit product configuration in the migrated SDK.
---

The SDK keeps the `@robota-sdk/*` package namespace. `Robota` remains available from
`@robota-sdk/agent-core`, alongside the neutral `ConversationAgent` name. Roundtable's existing
`@robota-sdk/agent-roundtable-robota` package, its `/session` subpath, `robotaParticipant`,
`robotaSelector`, and their public types remain available. Existing `robota-agent/1` and
`robota-session/1` checkpoints and parked approval requests retain their version labels.

The CLI remains `robota`. Without an explicit product selection, its host composition uses Robota's
existing `.robota` project and user storage, credential namespace and cryptographic domain.
`pnpm build`, `pnpm cli:dev`, `pnpm gui:dev` and `pnpm app:dev` select that composition. An explicit
`PRODUCT_ENV_PREFIX`, `PRODUCT_ID` or `PRODUCT_CONFIG_FILE` selects the caller's configuration;
incomplete or conflicting explicit settings still fail validation. Generated product workspaces
keep their embedded identity and independently selected configuration.

The beta remote-pairing API deliberately requires explicit cryptographic context and derivation
options. This prevents a reusable SDK from silently selecting a product's keys or signature domain.
Replace the former implicit constants and calls with an instance-owned context and path:

```ts
import { createIdentityContext, deriveMasterKey } from '@robota-sdk/agent-remote-pairing';

const context = createIdentityContext('robota');
const master = await deriveMasterKey(recoveryPhrase, { derivationPath: [7240, 0] });
```

Use `context.purposes` in place of `IDENTITY_PURPOSES`; provide the same context to pairing,
certificate, handshake and reconnect functions. The former `PAIRWISE_SECRET_LABEL` is the public
`${context.namespace}/rdv/v1` protocol label. Robota keeps its existing signature and HKDF labels
and hardened derivation path, so the explicit configuration reproduces its existing recovery
identity and paired-device keys. Other products choose their own namespace and path.

This migration does not bump package versions or publish packages. Local replay and packed-consumer
checks establish the tested SDK behavior; they do not establish paid-provider quality or deployed
cloud isolation guarantees.
