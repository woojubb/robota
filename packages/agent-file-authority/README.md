# @robota-sdk/agent-file-authority

Opaque, stable, root-relative bounded reads and atomic UTF-8 writes for supported Node.js hosts. The
package retains a native directory authority and resolves each requested path segment relative to
that authority, so a symlink, junction, or pathname replacement cannot redirect an in-progress
operation.

## Installation

```bash
npm install @robota-sdk/agent-file-authority
```

## Usage

```typescript
import {
  createStableRootedFileReader,
  createStableRootedFileWriter,
} from '@robota-sdk/agent-file-authority';

using reader = createStableRootedFileReader('/approved/root');
const bytes = reader.readBytes(['payloads', 'record.json'], 1_048_576);

using writer = createStableRootedFileWriter('/approved/root');
writer.writeUtf8(['output', 'result.json'], '{"complete":true}\n');
```

`readBytes()` accepts validated single path segments and a mandatory byte limit. It returns
`undefined` only for a missing entry; unsafe entries, unsupported hosts, changed files, and exceeded
budgets throw a `StableFileAuthorityError` whose `code` names the refusal. Raw descriptors, Windows
handles, canonical paths, and pathname fallbacks are never exposed. `writeUtf8()` creates missing
parents and atomically commits through the retained root authority. Close either authority with
`close()`, or let `using` dispose it.

The qualified native targets are Linux x64/arm64, macOS x64/arm64, and Windows x64 on Node.js
22.12 or newer. Other targets fail closed with `UNSUPPORTED_BACKEND`.

The package has no `@robota-sdk` dependencies. Within agent runtime, `agent-framework` uses it for
trusted workspace reads, `agent-session` for session-log payload reads, and `agent-tools` for
contained host writes.

See [the package specification](./docs/SPEC.md) for the contract and security boundaries.
