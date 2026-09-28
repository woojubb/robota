### Examples

Package-owned examples for `@robota-sdk/agent-core`. None of them needs a network connection or a
provider key.

#### Files

- `verify-offline.ts`: Deterministic offline smoke run with a mock provider. It checks that `run()`
  and `runStream()` give the same answer. Run it with `pnpm scenario:verify` from this package.
- `hook-block-demo.mjs`, `hook-json-response-demo.mjs`, `hook-permission-mode-demo.mjs`,
  `hook-timeout-demo.mjs`: Hook demonstrations that call `runHooks` directly. They import the built
  package (`../dist/node/index.js`), so build the package first, then run for example
  `node examples/hook-block-demo.mjs` from this package.

Embedding and demo examples live in the repository-root `examples/` directory.
