---
'@robota-sdk/agent-tools': major
'@robota-sdk/agent-session': major
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-subagent-runner': major
---

**BREAKING — ARCH-010: the execution root is a required contract field, and the containment guard now fails closed.**

The file-tool containment guard was fail-open: with no root configured it answered "allowed". A tool
built with no `cwd` therefore had no boundary — measured, a `Read` constructed that way returned the
contents of `/etc/hostname` — and the child-process subagent worker called `createDefaultTools()` with
no argument at all, so subagents got exactly that. Three independent auditors found three different
symptoms of this one missing field.

**Removed — seven context-free tool singletons.** `readTool`, `writeTool`, `editTool`, `globTool`,
`grepTool`, `shellTool`, `bashTool` are gone from `@robota-sdk/agent-tools`. A module-level instance is
bound at import time and can carry no containment root, so after the guard was inverted they could only
refuse everything.

Migrate to the factory of the same name, passing the directory the tool is allowed to work in:

```ts
// before
import { readTool, globTool } from '@robota-sdk/agent-tools';
const tools = [readTool, globTool];

// after
import { createReadTool, createGlobTool } from '@robota-sdk/agent-tools';
const cwd = process.cwd(); // or the workspace this agent is scoped to
const tools = [createReadTool({ cwd }), createGlobTool({ cwd })];
```

`webFetchTool`, `webSearchTool` and `askUserQuestionTool` are unchanged — they touch no filesystem, so
there is no root to contain them by.

**`cwd` is now REQUIRED** on `ISandboxToolOptions`, `IContainedBuiltinToolOptions` (and everything
extending them), `ICreateDefaultToolsOptions`, `ISessionOptions` and `ISubagentOptions`. The `= {}`
default parameter was removed from every builtin factory — that default was the mechanism by which
"forgot the root" was legal. `new Session({...})` without `cwd` no longer compiles, and also throws at
construction, because a required field is only required to a TypeScript caller.

**`Session` no longer reads `process.cwd()`.** It uses the root it was given, and `getCwd()` exposes it
so a fork or subagent asks the session instead of re-deriving a root that can disagree with it.

**Behavioural change even for callers that already passed a root**: a tool that somehow reaches the
guard with no root now REFUSES with an explicit error ("no containment root is configured … this is an
assembly bug, not a path problem") instead of allowing the access.
