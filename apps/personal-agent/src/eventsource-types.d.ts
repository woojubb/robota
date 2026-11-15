// Stands in for `eventsource` and `eventsource-parser` when this app typechecks. It resolves every
// package through the `source` condition, which for those two names reaches TypeScript sources
// that do not typecheck under this configuration, and the MCP client's declarations import them.
// Nothing in this app uses either; the real packages are what runs.
export {};
