/**
 * MCP-005 Task Scenario 1 — the real `OpenAIProvider` with `strictTools: true` over a fake HTTP
 * client, proving the per-tool quarantine is audible (a `tool_schema_quarantined` warn on the
 * global-sink logger) and memoised (no repeat warn on an identical second call).
 *
 * Three tool schemas are registered, one of which carries a `__proto__` property name — a universal
 * rejection (prototype keys) regardless of provider profile. One `chat()` call is issued, then a
 * second, identical one. Exit non-zero on any deviation from the expected counts; the sink is removed
 * before exiting either way.
 */
import { setGlobalLoggerSink } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

import type { IToolSchema, ILogger, TUniversalMessage } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

function userMessage(content: string): TUniversalMessage {
  return {
    id: `tool-schema-projection-example-${Date.now()}`,
    role: 'user',
    content,
    state: 'complete',
    timestamp: new Date(),
  };
}

/** A property literally named `__proto__` — a computed key, not a literal, so it becomes an own property. */
function buildPrototypeKeyTool(): IToolSchema {
  return {
    name: 'malicious_tool',
    description: 'A tool whose schema carries a prototype-key property name.',
    parameters: {
      type: 'object',
      properties: {
        safe: { type: 'string' },
        ['__proto__']: { type: 'string' },
      },
      required: ['safe'],
    },
  };
}

const GOOD_TOOL_ONE: IToolSchema = {
  name: 'get_weather',
  description: 'Get the weather for a city',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
};

const GOOD_TOOL_TWO: IToolSchema = {
  name: 'get_time',
  description: 'Get the current time for a timezone',
  parameters: {
    type: 'object',
    properties: { timezone: { type: 'string' } },
    required: ['timezone'],
  },
};

interface IRecordedRequest {
  tools?: Array<{ name: string }>;
}

function fakeResponsesClient(recorded: IRecordedRequest[]): OpenAI {
  return {
    responses: {
      create: async (params: IRecordedRequest) => {
        recorded.push(params);
        return {
          id: 'resp-tool-schema-projection-scenario',
          model: 'gpt-4o',
          output_text: '',
          output: [],
          status: 'completed',
        };
      },
    },
  } as unknown as OpenAI;
}

function recordingSink(lines: string[]): ILogger {
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      lines.push(`${level} ${args.map((value) => String(value)).join(' ')}`);
    };
  return {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    log: record('log'),
  };
}

async function main(): Promise<void> {
  const recordedRequests: IRecordedRequest[] = [];
  const lines: string[] = [];
  setGlobalLoggerSink(recordingSink(lines));

  try {
    const provider = new OpenAIProvider({
      apiKey: 'sk-scenario',
      strictTools: true,
      client: fakeResponsesClient(recordedRequests),
    });

    const tools: IToolSchema[] = [GOOD_TOOL_ONE, GOOD_TOOL_TWO, buildPrototypeKeyTool()];

    await provider.chat([userMessage('hello')], { model: 'gpt-4o', tools });
    const sentAfterFirst = recordedRequests.at(-1)?.tools?.length ?? -1;
    const quarantinedAfterFirst = lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    ).length;

    await provider.chat([userMessage('hello')], { model: 'gpt-4o', tools });
    const quarantinedAfterSecond = lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    ).length;

    const sent = sentAfterFirst;
    const quarantined = quarantinedAfterFirst;
    const diagnostic = quarantinedAfterFirst > 0 ? 'tool_schema_quarantined' : 'none';
    const repeated = quarantinedAfterSecond - quarantinedAfterFirst;

    const expected = {
      sent: 2,
      quarantined: 1,
      diagnostic: 'tool_schema_quarantined',
      repeated: 0,
    };
    const actual = { sent, quarantined, diagnostic, repeated };

    const deviations = (Object.keys(expected) as Array<keyof typeof expected>).filter(
      (key) => expected[key] !== actual[key],
    );
    if (deviations.length > 0) {
      process.stderr.write(
        `FAIL: deviations in ${deviations.join(', ')} — expected ${JSON.stringify(
          expected,
        )}, got ${JSON.stringify(actual)}\n`,
      );
      process.exitCode = 1;
      return;
    }

    process.stdout.write(
      `result=provider=openai; sent=${sent}; quarantined=${quarantined}; diagnostic=${diagnostic}; repeated=${repeated}\n`,
    );
  } finally {
    setGlobalLoggerSink(undefined);
  }
}

void main();
