---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-ui-terminal': patch
---

`@robota-sdk/agent-cli` and `@robota-sdk/agent-ui-terminal` are now ESM-only. Their CommonJS entry
could never load: it pulls in Ink, whose `yoga-layout` dependency starts with a top-level `await`, so
`require()` failed on every Node version with `ERR_REQUIRE_ASYNC_MODULE`. The packages no longer
declare a `require` condition or ship `index.cjs`/`index.d.cts`, so `require()` now fails at resolution
with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Load them with `import` or `import()`, which is unchanged. The
`robota` executable is unaffected.
