# @robota-sdk/agent-file-authority

Opaque, stable, root-relative bounded file reads for supported Node.js hosts. The package retains a
native directory authority and opens each requested path segment relative to that authority, so a
symlink, junction, or pathname replacement cannot redirect an in-progress read.

```typescript
import { createStableRootedFileReader } from '@robota-sdk/agent-file-authority';

using reader = createStableRootedFileReader('/approved/root');
const bytes = reader.readBytes(['payloads', 'record.json'], 1_048_576);
```

`readBytes()` accepts validated single path segments and a mandatory byte limit. It returns
`undefined` only for a missing entry; unsafe entries, unsupported hosts, changed files, and exceeded
budgets are explicit `StableFileAuthorityError` results. Raw descriptors, Windows handles, canonical
paths, and pathname fallbacks are never exposed.

The qualified native targets are Linux x64/arm64, macOS x64/arm64, and Windows x64 on Node.js
22.12 or newer. Other targets fail closed with `UNSUPPORTED_BACKEND`.

See [the package specification](./docs/SPEC.md) for the contract and security boundaries.
