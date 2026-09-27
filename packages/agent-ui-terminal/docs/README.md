# agent-ui-terminal — Documentation

`@robota-sdk/agent-ui-terminal` is the React + Ink terminal UI package for the Robota SDK. It owns the
Ink rendering pipeline, the session-owning `TuiInteractionChannel`, the full TUI attached to a daemon's
session, and the supervised-session view, and keeps React and Ink out of the dependency graph
of non-terminal consumers.

## Documents

- [SPEC.md](./SPEC.md) — package contract, public API, and boundaries.
- [Package README](../README.md) — installation and entry points.
