import { describe, expect, it } from 'vitest';
import { analyzeCode, parseAgentConfig, validateEnvironment } from '../code-analyzer';

const validAgentCode = `
import { Robota, createFunctionTool, LoggingPlugin } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const weatherTool = createFunctionTool('weather', 'Get weather conditions', async () => {
  return { temperature: 21 };
});

const robota = new Robota({
  name: 'WeatherAgent',
  aiProviders: [new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })],
  defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
  tools: [weatherTool],
  systemMessage: 'Be concise',
  plugins: [new LoggingPlugin()],
});

await robota.destroy();
`;

describe('code analyzer', () => {
  it('accepts a complete Robota example and reports environment usage as informational', () => {
    const result = analyzeCode(validAgentCode);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        type: 'configuration',
        severity: 'info',
        message: 'Environment variable OPENAI_API_KEY is used',
      }),
    ]);
  });

  it('keeps existing syntax checks for malformed imports and bracket mismatch', () => {
    const result = analyzeCode(`
import { Robota }
const robota = new Robota({
  name: 'BrokenAgent',
  aiProviders: [],
  defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
await robota.destroy();
`);

    expect(result.errors).toEqual([
      expect.objectContaining({
        type: 'syntax',
        severity: 'error',
        message: 'Invalid import statement syntax',
        line: 2,
      }),
      expect.objectContaining({
        type: 'syntax',
        severity: 'error',
        message: 'Mismatched brackets - missing closing bracket',
      }),
    ]);
  });

  it('limits missing semicolon warnings to the first three matching lines', () => {
    const result = analyzeCode(`
import { Robota } from '@robota-sdk/agent-core';
const one = 1
const two = 2
const three = 3
const four = 4
const robota = new Robota({
  name: 'SemicolonAgent',
  aiProviders: [],
  defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
});
await robota.destroy();
`);

    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'syntax', message: 'Missing semicolon', line: 3 }),
      expect.objectContaining({ type: 'syntax', message: 'Missing semicolon', line: 4 }),
      expect.objectContaining({ type: 'syntax', message: 'Missing semicolon', line: 5 }),
    ]);
  });

  it('reports missing provider imports and required Robota configuration keys', () => {
    const result = analyzeCode(`
import { Robota } from '@robota-sdk/agent-core';
const robota = new Robota({
  name: 'IncompleteAgent',
  providers: [new OpenAIProvider({ apiKey: 'key' })],
});
`);

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'import',
          message: 'Missing OpenAIProvider import',
        }),
        expect.objectContaining({
          type: 'configuration',
          message: 'Missing aiProviders configuration',
        }),
        expect.objectContaining({
          type: 'configuration',
          message: 'Missing defaultModel configuration',
        }),
      ]),
    );
    expect(result.warnings).toEqual([
      expect.objectContaining({
        type: 'configuration',
        message: 'Missing cleanup call',
      }),
    ]);
  });
});

describe('environment validation', () => {
  it('warns for known provider API keys and leaves unknown providers empty', () => {
    expect(validateEnvironment('openai')).toEqual({
      errors: [],
      warnings: [
        expect.objectContaining({
          type: 'configuration',
          severity: 'warning',
          message: 'OPENAI_API_KEY should be set in environment',
          documentation: 'https://robota.dev/docs/providers/openai',
        }),
      ],
    });

    expect(validateEnvironment('unknown')).toEqual({ errors: [], warnings: [] });
  });
});

describe('agent config parser', () => {
  it('extracts agent metadata, tools, system prompt, and unique plugin names', () => {
    expect(parseAgentConfig(validAgentCode)).toEqual({
      name: 'WeatherAgent',
      model: 'gpt-4o-mini',
      systemMessage: 'Be concise',
      tools: [
        {
          name: 'weather',
          description: 'Get weather conditions',
        },
      ],
      plugins: ['LoggingPlugin'],
    });
  });

  it('uses existing defaults when optional config fields are absent', () => {
    expect(parseAgentConfig('const robota = new Robota({});')).toEqual({
      name: 'UnnamedAgent',
      model: 'gpt-3.5-turbo',
      tools: [],
      systemMessage: undefined,
      plugins: [],
    });
  });
});
