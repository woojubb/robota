# WebFetch Tool

## What

Add a WebFetch built-in tool to agent-tools/builtins/ that fetches content from URLs and returns the response body as text.

## Why

Claude Code provides WebFetch as a built-in tool. Without it, the agent cannot access web content (documentation, APIs, etc.) during conversations.

## Scope

- Implement WebFetch tool in `@robota-sdk/agent-tools/builtins/`
- Accept URL, optional headers, optional method (GET/POST)
- Return response body as text (HTML stripped or raw)
- Respect permission system (requires approval in default mode)
- Add to Session's tool registration in agent-sessions
