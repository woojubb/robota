---
'@robota-sdk/agent-core': major
---

**BREAKING — CORE-028: the Node-only surface moves from the main barrel to `@robota-sdk/agent-core/node`.**

`canonicalizePath`, `isPathInside`, `CommandExecutor` and `HttpExecutor` were exported from the main
barrel. Each one needs `node:fs`, `node:path` or `node:child_process`, so the package's `browser`
build had those three builtins in its static import graph — a package declaring a `browser` export
condition while statically importing Node builtins. A bundler resolves that one of two ways: it
errors, or it aliases the builtin to an empty object and the code fails later at a call site with no
useful trace. Neither is a build you want to ship.

The four now live at the `./node` subpath, which makes the dependency legible at the import site
instead of hiding it inside a barrel. The main barrel's static graph imports zero Node builtins,
which a test now holds at zero rather than at a list of known remainders.

**Migration** — change the import path; no signature changed:

```ts
// before
import {
  canonicalizePath,
  isPathInside,
  CommandExecutor,
  HttpExecutor,
} from '@robota-sdk/agent-core';

// after
import {
  canonicalizePath,
  isPathInside,
  CommandExecutor,
  HttpExecutor,
} from '@robota-sdk/agent-core/node';
```

`./node` carries `"browser": null`, declaring that the subpath has no browser implementation, so a
resolver that honours a null target refuses it by name instead of quietly serving the Node build.

That declaration is worth stating precisely, because it was measured rather than assumed. Bundling
`import '@robota-sdk/agent-core/node'` under `['browser', 'import', 'default']` with the repo's own
bundler does NOT stop at the null: through a workspace link it resolves the `source` entry and then
fails on `node:fs`, `node:path` and `node:child_process`. The build still breaks, and the message
still names the Node dependency, so the failure is visible either way — but by a different mechanism
than the null, and only spec-compliant resolvers give the cleaner error. The claim here is the
declaration, not a guarantee about every bundler.
