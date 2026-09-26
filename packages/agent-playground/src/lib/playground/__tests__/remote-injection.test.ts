import { describe, expect, it } from 'vitest';
import type { IPlaygroundConfig } from '../config-validation';
import { injectRemoteExecutor } from '../remote-injection';

const config: IPlaygroundConfig = {
  enabled: true,
  serverUrl: 'http://localhost:3001',
  apiUrl: 'http://localhost:3001',
  features: { remoteExecution: true, streaming: false, tools: false },
};

describe('injectRemoteExecutor', () => {
  it.each([
    ['OpenAIProvider', '@robota-sdk/agent-provider-openai', 'openai'],
    ['AnthropicProvider', '@robota-sdk/agent-provider-anthropic', 'anthropic'],
    ['GoogleProvider', '@robota-sdk/agent-provider-gemini/google', 'google'],
  ])('maps %s imported from %s onto the playground SDK globals', (name, packageName, ns) => {
    const code = injectRemoteExecutor(`import { ${name} } from '${packageName}';\n`, config);

    expect(code).toContain(`const ${name} = window.__ROBOTA_SDK__?.${ns}?.${name}`);
  });
});
