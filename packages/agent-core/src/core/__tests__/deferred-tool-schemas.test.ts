/**
 * CLI-1990 — deferred tool schemas and tool search, at the execution seam.
 *
 * The tool list handed to the provider used to be a per-run SNAPSHOT: `resolveProviderAndTools` read
 * the registry once and every round spread the same array. A tool registered — or loaded — in round
 * N was therefore invisible to round N+1, which is precisely the property a search tool needs.
 *
 * These cases drive a real `Robota` turn against the scripted provider and read the `IChatOptions`
 * it recorded, because the defect lives in WHEN the registry is read, and a test that calls the
 * round helper directly cannot see that. The search tool here is a test-local driver of the real
 * `IToolExecutionContext.deferredTools` port — agent-core owns the port and the residency mechanism,
 * the shipped `ToolSearch` builtin lives one layer up in agent-tools, and this package cannot import
 * it. What is exercised is the mechanism: the per-round read, the projection, the load state, the
 * unknown-tool remedy, the forced-tool preload, and the permission gate's indifference to load state.
 */

import { describe, expect, it } from 'vitest';

import { AbstractTool } from '../../abstracts/abstract-tool';
import { TOOL_SEARCH_TOOL_NAME } from '../../interfaces/tool-search';
import { UNKNOWN_TOOL_ERROR_CODE } from '../../services/tool-execution-service';
import { evaluatePermission } from '../../permissions/permission-gate';
import { createScriptedProvider, type TScriptedTurn } from '../../testing/scripted-provider';
import { Robota } from '../robota';

import type { IToolWithEventService } from '../../abstracts/abstract-tool';
import type { IAgentConfig, IToolMessage } from '../../interfaces/agent';
import type { IToolExecutionContext, IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';
import type { TToolSearchSetting } from '../../interfaces/tool-search';
import type { TToolArgs } from '../../permissions/permission-gate';

const PROVIDER_NAME = 'scripted-test-provider';

const RESIDENT_SCHEMA: IToolSchema = {
  name: 'echo_tool',
  description: 'echoes its input back',
  parameters: { type: 'object', properties: {} },
};

const DEFERRED_PROBE_SCHEMA: IToolSchema = {
  name: 'deferred_probe',
  description: 'probes a deferred target',
  parameters: {
    type: 'object',
    properties: { target: { type: 'string', description: 'what to probe' } },
  },
  deferLoading: true,
};

/** Named `Grep` so the by-name load below reads exactly as the spec's TC-03 states it. */
const DEFERRED_GREP_SCHEMA: IToolSchema = {
  name: 'Grep',
  description: 'searches file contents with a regular expression',
  parameters: {
    type: 'object',
    properties: { pattern: { type: 'string', description: 'the regular expression' } },
  },
  deferLoading: true,
};

class SchemaTool extends AbstractTool {
  constructor(override readonly schema: IToolSchema) {
    super();
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: { ran: this.schema.name } };
  }
}

/**
 * The model-facing half of the mechanism, reduced to what agent-core owns: a tool that loads deferred
 * schemas through the catalog port the runtime injects. Matching here is a substring over name and
 * description — the ranking the shipped builtin adds is agent-tools' contract, tested there.
 */
class LocalToolSearch extends AbstractTool {
  override readonly schema: IToolSchema = {
    name: TOOL_SEARCH_TOOL_NAME,
    description: 'loads deferred tools by query or by name',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'text matched against name and description' },
        names: { type: 'array', items: { type: 'string' }, description: 'exact names to load' },
      },
    },
  };

  protected override async executeImpl(
    parameters: TToolParameters,
    context: IToolExecutionContext,
  ): Promise<IToolResult> {
    const catalog = context.deferredTools;
    if (catalog === undefined) {
      throw new Error('the runtime did not inject the deferred-tool catalog port');
    }
    const names = parameters['names'];
    const query = parameters['query'];
    const matched = Array.isArray(names)
      ? names.map(String)
      : catalog
          .listDeferredTools()
          .filter((schema) =>
            `${schema.name} ${schema.description}`
              .toLowerCase()
              .includes(String(query ?? '').toLowerCase()),
          )
          .map((schema) => schema.name);
    const loaded = catalog.loadDeferredTools(matched);
    return {
      success: true,
      data: {
        loaded: loaded.map(({ name, description }) => ({ name, description })),
        unavailableSources: [],
      },
    };
  }
}

/** TC-10: the shape the session layer's permission wrapper gives a tool, over the real gate. */
class GatedDeferredTool extends SchemaTool {
  protected override async executeImpl(parameters: TToolParameters): Promise<IToolResult> {
    const decision = evaluatePermission(this.schema.name, parameters as TToolArgs, 'default', {
      deny: [this.schema.name],
    });
    if (decision === 'deny') {
      throw new Error(`Permission denied: ${this.schema.name}`);
    }
    return super.executeImpl(parameters);
  }
}

function defaultTools(): IToolWithEventService[] {
  return [
    new SchemaTool(RESIDENT_SCHEMA),
    new SchemaTool(DEFERRED_PROBE_SCHEMA),
    new SchemaTool(DEFERRED_GREP_SCHEMA),
    new LocalToolSearch(),
  ];
}

function buildAgent(
  turns: readonly TScriptedTurn[],
  options: { tools?: IToolWithEventService[]; toolSearch?: TToolSearchSetting } = {},
): { robota: Robota; scripted: ReturnType<typeof createScriptedProvider> } {
  const scripted = createScriptedProvider(turns);
  const config: IAgentConfig = {
    name: 'Deferred Tools Agent',
    aiProviders: [scripted.provider],
    defaultModel: { provider: PROVIDER_NAME, model: 'test-model' },
    tools: options.tools ?? defaultTools(),
    toolSearch: options.toolSearch ?? 'on',
    logging: { level: 'silent', enabled: false },
  };
  return { robota: new Robota(config), scripted };
}

function toolNames(scripted: ReturnType<typeof createScriptedProvider>, round: number): string[] {
  return (scripted.chatOptions[round]?.tools ?? []).map((tool) => tool.name);
}

function toolMessages(robota: Robota): IToolMessage[] {
  return robota.getHistory().filter((message): message is IToolMessage => message.role === 'tool');
}

describe('CLI-1990 — deferred tool schemas reach the model only once loaded', () => {
  it('TC-02: a deferred tool is withheld in round 0 and offered in round 1 after ToolSearch loads it', async () => {
    const { robota, scripted } = buildAgent([
      { toolCalls: [{ name: TOOL_SEARCH_TOOL_NAME, args: { query: 'deferred' } }] },
      { text: 'done' },
    ]);

    await robota.run('find me the probe');

    const round0 = toolNames(scripted, 0);
    expect(round0).toContain(TOOL_SEARCH_TOOL_NAME);
    expect(round0).toContain(RESIDENT_SCHEMA.name);
    expect(round0).not.toContain(DEFERRED_PROBE_SCHEMA.name);

    // The per-round read: the schema loaded by the round-0 tool call is on the wire in round 1,
    // with its full parameters — not a name, not a summary.
    const round1 = scripted.chatOptions[1]?.tools ?? [];
    const probe = round1.find((tool) => tool.name === DEFERRED_PROBE_SCHEMA.name);
    expect(probe).toBeDefined();
    expect(probe?.parameters).toEqual(DEFERRED_PROBE_SCHEMA.parameters);
    // The query matched only the probe: the other deferred tool stays withheld, so a load is
    // exactly what the search returned and nothing more.
    expect(round1.map((tool) => tool.name)).not.toContain(DEFERRED_GREP_SCHEMA.name);
  });

  it('TC-01 companion: with nothing deferred the projection is the identity', async () => {
    const { robota, scripted } = buildAgent([{ text: 'done' }], {
      tools: [new SchemaTool(RESIDENT_SCHEMA), new LocalToolSearch()],
      toolSearch: 'auto',
    });

    await robota.run('hello');

    expect(toolNames(scripted, 0)).toEqual([RESIDENT_SCHEMA.name, TOOL_SEARCH_TOOL_NAME]);
  });

  it('TC-03: ToolSearch({ names }) loads exactly the named tool', async () => {
    const { robota, scripted } = buildAgent([
      { toolCalls: [{ name: TOOL_SEARCH_TOOL_NAME, args: { names: ['Grep'] } }] },
      { text: 'done' },
    ]);

    await robota.run('load grep');

    const round1 = toolNames(scripted, 1);
    expect(round1).toContain('Grep');
    expect(round1).not.toContain(DEFERRED_PROBE_SCHEMA.name);
  });

  it('TC-03: an empty match is a normal result, and the next round is unchanged', async () => {
    const { robota, scripted } = buildAgent([
      { toolCalls: [{ name: TOOL_SEARCH_TOOL_NAME, args: { query: 'nothing matches this' } }] },
      { text: 'done' },
    ]);

    await robota.run('search for nothing');

    const [searchResult] = toolMessages(robota);
    expect(searchResult).toBeDefined();
    expect(JSON.parse(String(searchResult?.content))).toEqual({
      loaded: [],
      unavailableSources: [],
    });
    expect(toolNames(scripted, 1)).toEqual(toolNames(scripted, 0));
  });

  it('TC-03: an unknown entry in names is an error naming the entry', async () => {
    const { robota } = buildAgent([
      { toolCalls: [{ name: TOOL_SEARCH_TOOL_NAME, args: { names: ['NoSuchTool'] } }] },
      { text: 'done' },
    ]);

    await robota.run('load a tool that does not exist');

    const [searchResult] = toolMessages(robota);
    expect(String(searchResult?.content)).toMatch(/^Error:/);
    expect(String(searchResult?.content)).toContain('NoSuchTool');
  });

  it('TC-06: calling an unloaded deferred tool yields the unknown-tool error naming ToolSearch, without a forced summary', async () => {
    const { robota, scripted } = buildAgent([
      { toolCalls: [{ name: DEFERRED_PROBE_SCHEMA.name, args: { target: 'x' } }] },
      { text: 'recovered' },
    ]);

    const response = await robota.run('probe without loading');

    const [probeResult] = toolMessages(robota);
    expect(probeResult?.metadata?.['errorCode']).toBe(UNKNOWN_TOOL_ERROR_CODE);
    expect(String(probeResult?.content)).toContain(TOOL_SEARCH_TOOL_NAME);
    expect(String(probeResult?.content)).toContain(DEFERRED_PROBE_SCHEMA.name);
    // Not force-summarised on the first such round: the script holds exactly two turns, so a third
    // provider call would have thrown "script exhausted" instead of returning the model's text.
    expect(response).toBe('recovered');
    expect(scripted.chatOptions).toHaveLength(2);
    // A failed call loads nothing.
    expect(toolNames(scripted, 1)).not.toContain(DEFERRED_PROBE_SCHEMA.name);
  });

  it('TC-07: a run forcing a deferred tool loads it before the first request instead of throwing', async () => {
    const { robota, scripted } = buildAgent([
      { toolCalls: [{ name: DEFERRED_PROBE_SCHEMA.name, args: { target: 'forced' } }] },
      { text: 'done' },
    ]);

    await expect(
      robota.run('probe now', { toolChoice: { tool: DEFERRED_PROBE_SCHEMA.name } }),
    ).resolves.toBe('done');

    expect(toolNames(scripted, 0)).toContain(DEFERRED_PROBE_SCHEMA.name);
    expect(scripted.chatOptions[0]?.toolChoice).toEqual({ tool: DEFERRED_PROBE_SCHEMA.name });
    const [probeResult] = toolMessages(robota);
    expect(JSON.parse(String(probeResult?.content))).toEqual({ ran: DEFERRED_PROBE_SCHEMA.name });
  });

  it('TC-10: a loaded deferred tool is permission-gated identically to a resident one', async () => {
    const gate = (): string =>
      evaluatePermission(DEFERRED_PROBE_SCHEMA.name, { target: 'x' }, 'default', {
        deny: [DEFERRED_PROBE_SCHEMA.name],
      });
    // The gate decides by NAME and never consults the registry: the answer is the same before any
    // load, which is what "deferral never widens authority" means.
    expect(gate()).toBe('deny');

    const { robota, scripted } = buildAgent(
      [
        {
          toolCalls: [
            { name: TOOL_SEARCH_TOOL_NAME, args: { names: [DEFERRED_PROBE_SCHEMA.name] } },
          ],
        },
        { toolCalls: [{ name: DEFERRED_PROBE_SCHEMA.name, args: { target: 'x' } }] },
        { text: 'done' },
      ],
      {
        tools: [
          new SchemaTool(RESIDENT_SCHEMA),
          new GatedDeferredTool(DEFERRED_PROBE_SCHEMA),
          new LocalToolSearch(),
        ],
      },
    );

    await robota.run('load it, then call it');

    expect(toolNames(scripted, 1)).toContain(DEFERRED_PROBE_SCHEMA.name);
    const [, probeResult] = toolMessages(robota);
    expect(String(probeResult?.content)).toContain('Permission denied');
    expect(gate()).toBe('deny');
  });
});
