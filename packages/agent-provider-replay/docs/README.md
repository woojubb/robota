# agent-provider-replay Docs Index

`@robota-sdk/agent-provider-replay` is an internal test utility (`private`, not published to npm). It
is a provider that answers each chat call with the next response recorded in a Robota session log,
so a real conversation can run offline, deterministically and without a model key. The monorepo uses
it for end-to-end tests, and the CLI's `--session-log <file>` option uses it when the CLI runs inside
this monorepo. The published CLI does not include it and reports that option as unavailable.

Entry points:

- `createReplayProviderFromNodeLogFile(logFile, options?)`: reads a session log file from disk.
- `createReplayProviderFromSource(source, options?)`: reads from an `ISessionLogSource`
  (`@robota-sdk/agent-session`).
- `new ReplayProvider({ entries, ... })`: takes already-loaded log entries.

A call past the last recorded response rejects. The log is validated as a whole before any response
is replayed.

- [SPEC.md](SPEC.md): contract, guarantees, error taxonomy and package boundary.
