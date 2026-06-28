# agent-testing Docs Index

- `SPEC.md`: Cross-cutting test-harness scope, the PTY driver contract, and package boundary.

`@robota-sdk/agent-testing` is the home for test infrastructure shared across packages — currently the
real-PTY end-to-end harness (`spawnPty` / `spawnPtyFixture`). Consume it as a `devDependency`.
