/**
 * `AbstractAIProvider.projectionProfile()` / `projectTools()`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { loadToolSchemaProjectionFixtures } from '../../testing/tool-schema-projection-fixtures';
import { PERMISSIVE_TOOL_SCHEMA_PROFILE } from '../../schema/project-tool-schema';
import { setGlobalLoggerSink, type ILogger } from '../../utils/logger';
import { AbstractAIProvider } from '../abstract-ai-provider';

import type { IToolSchemaProjectionProfile } from '../../schema/project-tool-schema';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IParameterSchema, IToolSchema } from '../../interfaces/tool-schema';

const fixtures = loadToolSchemaProjectionFixtures();

/** A minimal recording sink — the same pattern the per-agent-logging test uses. */
function recordingSink(): { sink: ILogger; lines: string[] } {
  const lines: string[] = [];
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      lines.push(`${level} ${args.map((value) => String(value)).join(' ')}`);
    };
  return {
    lines,
    sink: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      log: record('log'),
    },
  };
}

/** Constructed WITHOUT a logger, so `this.logger` resolves to `SilentLogger` (abstract-ai-provider.ts:89). */
class NoLoggerTestProvider extends AbstractAIProvider {
  readonly name = 'no-logger-test-provider';
  readonly version = '1.0.0';
  private profile: IToolSchemaProjectionProfile | undefined;

  setProjectionProfile(profile: IToolSchemaProjectionProfile | undefined): void {
    this.profile = profile;
  }

  protected override projectionProfile(): IToolSchemaProjectionProfile | undefined {
    return this.profile;
  }

  callProjectTools(tools: IToolSchema[] | undefined, model: string): IToolSchema[] | undefined {
    return this.projectTools(tools, model);
  }

  async chat(): Promise<TUniversalMessage> {
    return {
      id: '1',
      role: 'assistant',
      content: 'test',
      state: 'complete',
      timestamp: new Date(),
    };
  }
}

const TEST_PROFILE: IToolSchemaProjectionProfile = {
  ...PERMISSIVE_TOOL_SCHEMA_PROFILE,
  providerName: 'no-logger-test-provider',
};

describe('per-tool quarantine, memoised, global-sink logger', () => {
  afterEach(() => {
    setGlobalLoggerSink(undefined);
  });

  it('omits exactly the rejected tool, reports it once, and leaves options.tools unchanged', () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);

    const provider = new NoLoggerTestProvider();
    provider.setProjectionProfile(TEST_PROFILE);

    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
    const before = JSON.parse(JSON.stringify(tools));

    const kept = provider.callProjectTools(tools, 'model-a');

    expect(kept?.map((tool) => tool.name)).toEqual(['good_tool_one', 'good_tool_two']);
    expect(tools).toEqual(before);

    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(1);
    expect(quarantineLines[0]).toContain('provider=no-logger-test-provider');
    expect(quarantineLines[0]).toContain('model=model-a');
    expect(quarantineLines[0]).toContain('tool=bad_tool');
    expect(quarantineLines[0]).toContain('path=');
    expect(quarantineLines[0]).toContain('reason=');
  });

  it('does not re-report the same tool/model/schema on a second call', () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);

    const provider = new NoLoggerTestProvider();
    provider.setProjectionProfile(TEST_PROFILE);
    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];

    provider.callProjectTools(tools, 'model-a');
    provider.callProjectTools(tools, 'model-a');

    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(1);
  });

  it('reports again when the same tool name reappears with a changed schema', () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);

    const provider = new NoLoggerTestProvider();
    provider.setProjectionProfile(TEST_PROFILE);
    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
    provider.callProjectTools(tools, 'model-a');

    // Same tool NAME (`bad_tool`), still rejected, but a DIFFERENT (and differently-shaped)
    // parameters value — a different cache identity.
    const changedTools: IToolSchema[] = tools.map((tool) =>
      tool.name === 'bad_tool' ? { ...tool, parameters: fixtures.prototypeKey.parameters } : tool,
    );
    provider.callProjectTools(changedTools, 'model-a');

    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(2);
  });
});

describe('no profile: unchanged, no diagnostics', () => {
  afterEach(() => {
    setGlobalLoggerSink(undefined);
  });

  it('passes every tool through unchanged (same array) and emits no warn', () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);

    const provider = new NoLoggerTestProvider();
    // `projectionProfile()` returns `undefined` — the default, never overridden here.
    const tools = [fixtures.subsetOnly, fixtures.arrayItemsObject];

    const result = provider.callProjectTools(tools, 'model-a');

    expect(result).toBe(tools);
    expect(recorder.lines.filter((line) => line.includes('tool_schema_quarantined'))).toHaveLength(
      0,
    );
  });
});

describe('a tool projection refuses is dropped from its request alone', () => {
  const healthy: IToolSchema = {
    name: 'healthy',
    description: 'A tool.',
    parameters: { type: 'object', properties: {} },
  };

  function toolWith(value: unknown): IToolSchema {
    return {
      name: 'refused',
      description: 'A tool.',
      parameters: { type: 'object', properties: { value: value as IParameterSchema } },
    };
  }

  function cycle(link: (node: Record<string, unknown>) => void): unknown {
    const node: Record<string, unknown> = { type: 'object' };
    link(node);
    return node;
  }

  function deepChain(): unknown {
    let node: unknown = { type: 'string' };
    for (let level = 0; level < 100_000; level += 1) node = { type: 'array', items: node };
    return node;
  }

  function sharedSubtrees(): unknown {
    let node: unknown = { type: 'string' };
    for (let level = 0; level < 40; level += 1) {
      node = { type: 'object', properties: { a: node, b: node } };
    }
    return node;
  }

  function wideSharedList(): unknown {
    const names = Array.from({ length: 2000 }, (_, index) => `${'n'.repeat(100)}${index}`);
    const shared = { type: 'string', required: names };
    const properties: Record<string, unknown> = {};
    for (let index = 0; index < 4900; index += 1) properties[`p${index}`] = shared;
    return { type: 'object', properties };
  }

  it.each([
    [
      'a cycle through properties',
      () =>
        cycle((node) => {
          node.properties = { self: node };
        }),
    ],
    [
      'a cycle through additionalProperties',
      () =>
        cycle((node) => {
          node.additionalProperties = node;
        }),
    ],
    ['a chain far past the ceiling', deepChain],
    ['a graph that multiplies through shared subtrees', sharedSubtrees],
    ['a wide graph sharing one long list', wideSharedList],
  ])('%s', (_name, build) => {
    const provider = new NoLoggerTestProvider();
    provider.setProjectionProfile(TEST_PROFILE);
    const kept = provider.callProjectTools([toolWith(build()), healthy], 'model');
    expect(kept?.map((tool) => tool.name)).toEqual(['healthy']);
  });
});
