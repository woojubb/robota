---
'@robota-sdk/dag-framework': major
'@robota-sdk/dag-adapters-sqlite': major
---

Require host-selected storage and asset paths (or supplied ports) when composing the in-process DAG framework. The neutral factory no longer selects environment or product home-directory storage defaults; existing hosts can preserve their layout by passing the former paths explicitly.

Require a host-selected database path for both SQLite adapters. Callers that used the implicit `./configured database path` file can pass that path explicitly.
