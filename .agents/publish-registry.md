# Publish Registry

Parent: [project-structure.md](project-structure.md)

Packages marked **publish** are published to npm under `@robota-sdk/` scope. All others are `private: true` and must NOT be published until explicitly approved.

| Package                          | Publish | npm tag | Notes                               |
| -------------------------------- | ------- | ------- | ----------------------------------- |
| auth                             | no      | —       | private: true, beta contracts       |
| credits                          | no      | —       | private: true, beta contracts       |
| agent-core                       | yes     | beta    | Foundation — zero @robota-sdk deps  |
| agent-runtime                    | yes     | beta    | Runtime lifecycle/ports for SDK     |
| agent-sessions                   | yes     | beta    | Session management                  |
| agent-tools                      | yes     | beta    | Built-in tool implementations       |
| agent-provider-anthropic         | yes     | beta    | Anthropic provider                  |
| agent-provider-deepseek          | yes     | beta    | DeepSeek OpenAI-compatible provider |
| agent-provider-openai            | yes     | beta    | OpenAI provider                     |
| agent-provider-openai-compatible | yes     | beta    | OpenAI-compatible provider base     |
| agent-provider-gemma             | yes     | beta    | Gemma OpenAI-compatible provider    |
| agent-provider-qwen              | yes     | beta    | Qwen OpenAI-compatible provider     |
| agent-provider-gemini            | yes     | beta    | Canonical Gemini API provider       |
| agent-sdk                        | yes     | beta    | Assembly layer for CLI              |
| agent-cli                        | yes     | beta    | CLI binary (`robota` command)       |
| agent-event-service              | no      | —       | private: true                       |
| agent-plugin-\* (11 pkgs)        | no      | —       | private: true, unused by CLI        |
| agent-provider-bytedance         | no      | —       | private: true                       |
| agent-provider-google            | yes     | beta    | Compatibility wrapper for Gemini    |
| agent-command-\* (18 pkgs)       | yes     | beta    | Default CLI command modules         |
| agent-remote                     | no      | —       | private: true                       |
| agent-remote-server-core         | no      | —       | private: true                       |
| agent-team                       | no      | —       | private: true                       |
| agent-playground                 | no      | —       | private: true                       |
| agent-tool-mcp                   | no      | —       | private: true                       |

**Rules:**

- Only packages in the **publish=yes** list may be published. Adding a new package to this list requires explicit user approval.
- Published packages must have `"private": false` and `"publishConfig": { "access": "public" }` in package.json.
- Non-published packages must have `"private": true`.
- Use `pnpm publish -r --tag <tag>` for batch publishing (never `npm publish`).
