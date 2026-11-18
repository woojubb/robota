import { describe, expect, it, vi } from 'vitest';
import {
  CONNECTOR_TOOL_NAMES,
  ConnectorRefusedError,
  createConnectorTools,
} from '@robota-sdk/agent-product/personal';

import { captureCaseAction, createCaseAction } from '../case-action.js';

import type { ConnectorRegistry, IFeedItem } from '@robota-sdk/agent-product/personal';
import type { ICaseActionPort, ICaseActionSnapshot } from '../case-action.js';

const snapshot: ICaseActionSnapshot = {
  caseId: 'case-one',
  feedItemId: 'feed-one',
  connectorId: 'connector-mail',
  bindingGeneration: 'binding-one',
  scopeGeneration: 'scope-one',
  tools: ['send'],
};
const args = {
  connector: 'connector-mail',
  tool: 'send',
  argumentsJson: '{"to":"person@example.invalid"}',
};
const receipt = () => Promise.resolve({ approval: { state: 'approved' } } as IFeedItem);
const schema = createConnectorTools({} as ConnectorRegistry).find(
  (tool) => tool.getName() === CONNECTOR_TOOL_NAMES.act,
)!.schema;

function fixture() {
  const sent: string[] = [];
  let scope = snapshot.scopeGeneration;
  let wireArguments: string | undefined;
  const port: ICaseActionPort = {
    call: vi.fn(async (_connector, tool, data, admission) => {
      const started = await admission(
        async () => {
          sent.push(tool);
        },
        {
          tool,
          argumentsJson: wireArguments ?? JSON.stringify(data),
        },
      );
      await started.response;
      return { text: 'done', isError: false };
    }),
    dispatch: vi.fn(async (chosen, _tool, send) => {
      if (chosen.scopeGeneration !== scope)
        throw new ConnectorRefusedError('The case action scope changed');
      return { response: send() };
    }),
  };
  const action = createCaseAction(snapshot, schema, port);
  const execute = (id: string, parameters = args) =>
    action.tool.execute(parameters, {
      toolName: CONNECTOR_TOOL_NAMES.act,
      parameters,
      executionId: id,
    });
  return {
    action,
    execute,
    port,
    sent,
    changeScope: () => {
      scope = 'scope-two';
    },
    wire: (value: string) => {
      wireArguments = value;
    },
  };
}

describe('the case-scoped connector action', () => {
  it('captures only the choices present before the answer, and falls back to read-only on failure', async () => {
    const tools = ['send'];
    const source = {
      binding: async () => ({
        connectorId: snapshot.connectorId,
        generation: snapshot.bindingGeneration,
      }),
      scope: async () => ({ generation: snapshot.scopeGeneration, tools }),
    };
    const captured = await captureCaseAction(snapshot.caseId, snapshot.feedItemId, source);
    tools.push('delete');
    expect(captured).toEqual(snapshot);
    expect(
      await captureCaseAction(snapshot.caseId, snapshot.feedItemId, {
        ...source,
        binding: async () => undefined,
      }),
    ).toBeUndefined();
    expect(
      await captureCaseAction(snapshot.caseId, snapshot.feedItemId, {
        ...source,
        scope: async () => {
          throw new Error('unavailable');
        },
      }),
    ).toBeUndefined();
  });

  it('requires a recorded approval and consumes it at most once', async () => {
    const f = fixture();
    expect((await f.execute('missing')).data).toEqual({
      error: expect.stringContaining('approval'),
    });
    f.action.approved('one', args, receipt());
    expect((await f.execute('one')).data).toContain('Service result');
    expect((await f.execute('one')).data).toEqual({ error: expect.stringContaining('approval') });
    expect(f.sent).toEqual(['send']);
  });

  it('waits for the approval record and refuses a different call or connector', async () => {
    const f = fixture();
    let record!: (item: IFeedItem) => void;
    const pending = new Promise<IFeedItem>((resolve) => {
      record = resolve;
    });
    f.action.approved('one', args, pending);
    const running = f.execute('one');
    await Promise.resolve();
    expect(f.port.call).not.toHaveBeenCalled();
    record({ approval: { state: 'approved' } } as IFeedItem);
    await running;
    f.action.approved('two', args, receipt());
    expect((await f.execute('two', { ...args, connector: 'connector-other' })).data).toEqual({
      error: expect.stringContaining('outside'),
    });
    f.action.approved('three', args, receipt());
    expect(
      (await f.execute('three', { ...args, argumentsJson: '{"to":"other@example.invalid"}' })).data,
    ).toEqual({ error: expect.stringContaining('outside') });
    expect(f.sent).toEqual(['send']);
  });

  it('refuses changed wire arguments and a revoked scope before sending', async () => {
    const f = fixture();
    f.action.approved('one', args, receipt());
    f.wire('{"to":"other@example.invalid"}');
    expect((await f.execute('one')).data).toEqual({ error: expect.stringContaining('differs') });
    f.wire(args.argumentsJson);
    f.action.approved('two', args, receipt());
    f.changeScope();
    expect((await f.execute('two')).data).toEqual({ error: expect.stringContaining('changed') });
    expect(f.sent).toEqual([]);
  });

  it('does not send when the approval record fails or the tool is outside the saved scope', async () => {
    const f = fixture();
    f.action.approved('one', args, Promise.reject(new Error('approval could not be recorded')));
    await expect(f.execute('one')).rejects.toThrow(/approval could not be recorded/u);
    const other = { ...args, tool: 'delete' };
    f.action.approved('two', other, receipt());
    expect((await f.execute('two', other)).data).toEqual({
      error: expect.stringContaining('outside'),
    });
    f.action.approved('three', args, receipt());
    f.action.approved('three', args, receipt());
    expect((await f.execute('three')).data).toEqual({ error: expect.stringContaining('approval') });
    expect(f.sent).toEqual([]);
  });
});
