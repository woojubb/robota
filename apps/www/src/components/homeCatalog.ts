/**
 * Locale-neutral homepage structure: feature areas, permission modes, library layers and package
 * groups. Identifiers here are code names shown verbatim; their descriptions live in homeCopy.ts.
 */

export const featureCatalog = [
  {
    group: 'models',
    items: [
      { id: 'providers', guide: 'guide/providers', tags: ['Anthropic', 'OpenAI', 'Gemini', 'DeepSeek', 'Qwen', 'Gemma', 'baseURL'] },
      { id: 'fallback', guide: 'guide/cli', tags: ['FallbackProvider', '--fallback-model', '--advisor', '--effort'] },
      { id: 'local', guide: 'guide/local-llm', tags: ['Ollama', 'LM Studio', 'vLLM'] },
      { id: 'media', guide: 'guide/providers', tags: ['agent-provider-gemini', 'agent-provider-bytedance'] },
    ],
  },
  {
    group: 'safety',
    items: [
      { id: 'tools', guide: 'guide/building-agents', tags: ['createZodFunctionTool', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch'] },
      { id: 'permissions', guide: 'guide/permissions-and-hooks', tags: ['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions'] },
      { id: 'hooks', guide: 'guide/permissions-and-hooks', tags: ['PreToolUse', 'PostToolUse', 'SessionStart', 'UserPromptSubmit'] },
      { id: 'sandbox', guide: 'guide/permissions-and-hooks', tags: ['bubblewrap', 'Seatbelt', '/sandbox'] },
      { id: 'trust', guide: 'guide/cli', tags: ['AGENTS.md', 'CLAUDE.md', '--safe-mode'] },
    ],
  },
  {
    group: 'sessions',
    items: [
      { id: 'sessions', guide: 'guide/sessions-and-daemon', tags: ['InteractiveSession', '/resume', '/fork', '/compact'] },
      { id: 'daemon', guide: 'guide/sessions-and-daemon', tags: ['daemon start', '--attach', 'session start --background'] },
      { id: 'subagents', guide: 'guide/cli', tags: ['/agent', '/background', 'agent-executor', 'agent-subagent-runner'] },
      { id: 'automation', guide: 'guide/cli', tags: ['/loop', '/schedule', '/monitor', '/plan'] },
      { id: 'checkpoints', guide: 'guide/cli', tags: ['/rewind', '/memory', '/context', '/cost'] },
      { id: 'workflows', guide: 'guide/cli', tags: ['/workflows create', '/workflows run', '.workflows/'] },
      { id: 'roundtable', guide: 'packages', tags: ['agent-roundtable', 'agent-roundtable-robota'] },
    ],
  },
  {
    group: 'extend',
    items: [
      { id: 'mcp', guide: 'guide/mcp', tags: ['agent-mcp', 'OAuth', '/mcp approve', 'mcp serve', 'agent-transport-mcp'] },
      { id: 'skills', guide: 'guide/cli', tags: ['.agents/skills', '.claude/skills', '.claude/commands', '/skills'] },
      { id: 'plugins', guide: 'guide/plugins', tags: ['/plugin marketplace add', '/plugin install', 'agent-plugin', 'webhooks'] },
      { id: 'events', guide: 'guide/cli', tags: ['--external-event-grant', '/events'] },
    ],
  },
  {
    group: 'interfaces',
    items: [
      { id: 'terminal', guide: 'guide/cli', tags: ['React + Ink', '@path', 'Ctrl+R', '--screen-reader', 'keybindings.json'] },
      { id: 'print', guide: 'guide/cli', tags: ['-p', '--output-format json', '--json-schema', '--goal'] },
      { id: 'gui', guide: 'guide/gui', tags: ['--serve --open', 'agent-app'] },
      { id: 'http', guide: 'guide/cli', tags: ['--serve --http-port', 'SSE', 'OAuth', 'ws · http · mcp · webrtc'] },
      { id: 'devices', guide: 'guide/devices-and-remote', tags: ['/peers', '/handoff', '/devices', '/remote-control'] },
      { id: 'ci', guide: 'integrations/github-action', tags: ['GitHub Actions', '-p', 'eval'] },
    ],
  },
  {
    group: 'build',
    items: [
      { id: 'core', guide: 'guide/building-agents', tags: ['ConversationAgent', 'run', 'runStream', 'structured output'] },
      { id: 'framework', guide: 'guide/sdk', tags: ['createQuery', 'InteractiveSession', 'createAgentRuntime'] },
      { id: 'embedding', guide: 'guide/embedding', tags: ['createAgentRuntime', 'sessionStore', 'resumeSessionId', 'createStatelessRuntime'] },
      { id: 'channels', guide: 'guide/deployment', tags: ['TransportRegistry', 'agent-transport-*'] },
      { id: 'product', guide: 'guide/architecture', tags: ['assembleProduct', 'ICapabilityPack', 'createCodingPack', 'presets'] },
      { id: 'productHost', source: 'packages/agent-cli/README.md#build-a-separate-product-from-npm-packages', tags: ['agent-cli/host', 'createProductCliHost', 'agent-cli/desktop-host', 'buildProductNativeBinary'] },
      { id: 'analytics', guide: 'guide/cli', tags: ['doctor', 'usage', 'usage export', 'session analyze', 'eval'] },
    ],
  },
] as const;

export type FeatureGroupId = (typeof featureCatalog)[number]['group'];
export type FeatureId = (typeof featureCatalog)[number]['items'][number]['id'];

export const permissionModes = ['plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions'] as const;
export type PermissionMode = (typeof permissionModes)[number];

export const architectureLayers = [
  { id: 'interface', packages: ['agent-cli'] },
  { id: 'composition', packages: ['agent-product', 'pack-coding', 'agent-command', 'agent-preset'] },
  { id: 'surfaces', packages: ['agent-ui-terminal', 'agent-transport-ws', 'agent-transport-http', 'agent-transport-mcp', 'agent-transport-webrtc'] },
  { id: 'assembly', packages: ['agent-framework'] },
  { id: 'runtime', packages: ['agent-session', 'agent-executor', 'agent-tools', 'agent-tool-defaults', 'agent-mcp', 'agent-plugin'] },
  { id: 'providers', packages: ['agent-provider-*'] },
  { id: 'contracts', packages: ['agent-interface-*'] },
  { id: 'foundation', packages: ['agent-core'] },
] as const;
export type ArchitectureLayerId = (typeof architectureLayers)[number]['id'];

export const packageGroups = [
  {
    id: 'start',
    packages: ['agent-core', 'agent-provider-anthropic', 'agent-provider-openai', 'agent-provider-openai-compatible', 'agent-provider-gemini', 'agent-provider-bytedance', 'agent-tools'],
  },
  {
    id: 'assembly',
    packages: ['agent-framework', 'agent-session', 'agent-executor', 'agent-subagent-runner', 'agent-tool-defaults', 'agent-builtin-providers', 'agent-mcp', 'agent-plugin', 'agent-session-analytics', 'agent-telemetry-otel', 'agent-process', 'agent-file-authority'],
  },
  { id: 'multiAgent', packages: ['agent-roundtable', 'agent-roundtable-robota'] },
  { id: 'composition', packages: ['agent-product', 'agent-capability-pack', 'pack-coding', 'agent-command', 'agent-preset'] },
  {
    id: 'transports',
    packages: ['agent-transport', 'agent-transport-ws', 'agent-transport-http', 'agent-transport-mcp', 'agent-transport-webrtc', 'agent-remote-pairing', 'agent-ui-terminal'],
  },
  {
    id: 'contracts',
    packages: ['agent-interface-session', 'agent-interface-session-mobility', 'agent-interface-command', 'agent-interface-execution', 'agent-interface-analytics', 'agent-interface-transport', 'agent-interface-tui'],
  },
  { id: 'cli', packages: ['agent-cli'] },
] as const;
export type PackageGroupId = (typeof packageGroups)[number]['id'];

export const packageScope = '@robota-sdk/';
