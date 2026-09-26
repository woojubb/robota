/**
 * SELFHOST-004 P6: a service set on the permission wrapper reaches the tool it wraps.
 *
 * `Object.create(tool)` would shadow a `setEventService` call onto the wrapper instance, and the
 * wrapper runs the original tool's `execute`. This test proves the injected bus still receives the
 * tool's span: a wrapped, permitted tool emits `SPAN_EVENTS.COMPLETED` on it when it runs.
 */

import { describe, it, expect, vi } from 'vitest';

import { FunctionTool, ObservableEventService, SPAN_EVENTS } from '@robota-sdk/agent-core';

import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IPermissionEnforcerOptions } from '../permission-types.js';
import type {
  IBaseEventData,
  IToolSchema,
  ITerminalOutput,
  IToolWithEventService,
} from '@robota-sdk/agent-core';

function makeNoopTerminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn().mockResolvedValue(''),
    select: vi.fn().mockResolvedValue(0),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

function makeEnforcer(overrides: Partial<IPermissionEnforcerOptions> = {}): PermissionEnforcer {
  return new PermissionEnforcer({
    sessionId: 'test-session',
    cwd: '/tmp',
    getPermissionMode: () => 'default',
    config: { permissions: { allow: ['spantool'], deny: [] } },
    terminal: makeNoopTerminal(),
    ...overrides,
  });
}

function makeTool(): FunctionTool {
  const schema: IToolSchema = {
    name: 'spantool',
    description: 'span tool',
    parameters: { type: 'object', properties: {}, required: [] },
  };
  return new FunctionTool(schema, async () => 'ok');
}

describe('SELFHOST-004 P6 — permission wrapper forwards setEventService', () => {
  it('a wrapped, permitted tool emits a span-completion event on the injected bus', async () => {
    const enforcer = makeEnforcer();
    const bus = new ObservableEventService();
    const seen: Array<{ type: string; data: IBaseEventData }> = [];
    bus.subscribe((type, data) => seen.push({ type, data }));

    const [wrapped] = enforcer.wrapTools([makeTool() as IToolWithEventService]);
    // Inject on the WRAPPER — must reach the original tool that originalExecute runs.
    wrapped!.setEventService(bus);
    await wrapped!.execute({}, { toolName: 'spantool', parameters: {}, executionId: 'e1' });

    const spans = seen.filter((e) => e.type === SPAN_EVENTS.COMPLETED);
    expect(spans).toHaveLength(1);
    expect((spans[0]!.data as { op?: string }).op).toBe('spantool');
  });

  it('emits nothing when no event service is injected (opt-in preserved)', async () => {
    const enforcer = makeEnforcer();
    const [wrapped] = enforcer.wrapTools([makeTool() as IToolWithEventService]);
    // no setEventService → original tool's bus stays unset; execute must still succeed
    await expect(
      wrapped!.execute({}, { toolName: 'spantool', parameters: {}, executionId: 'e1' }),
    ).resolves.toMatchObject({
      success: true,
    });
  });

  it('preserves a failed admitted result with no data instead of crashing during size logging', async () => {
    const enforcer = makeEnforcer();
    const schema = makeTool().schema;
    const tool: IToolWithEventService = {
      schema,
      getName: () => schema.name,
      getDescription: () => schema.description,
      validate: () => true,
      validateParameters: () => ({ isValid: true, errors: [] }),
      execute: async () => ({
        success: false,
        error: 'Tool failure details: tool-result:abcdefghijklmnopqrstuv',
      }),
      setEventService: () => undefined,
    };
    const [wrapped] = enforcer.wrapTools([tool]);
    const result = await wrapped!.execute({}, { toolName: schema.name, parameters: {} });
    expect(result.error).toContain('tool-result:abcdefghijklmnopqrstuv');
  });
});
