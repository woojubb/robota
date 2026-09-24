/**
 * Opt-in tool argument and output content: captured only for the owner turn's own tool calls —
 * those whose permission or body events reached this turn's collector — and bounded per turn.
 */
import { TOOL_BODY_EVENTS, TOOL_PERMISSION_EVENTS } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';
import { collectSpanEntries } from '../interactive-session-execution.js';
import {
  LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES,
  LivePromptContentAccumulator,
} from '../interactive-session-live-prompt-content.js';

import type { IEventService } from '@robota-sdk/agent-core';
import type {
  ILivePromptContentBatch,
  ILivePromptContentPolicy,
  ILivePromptTraceBatch,
} from '@robota-sdk/agent-interface-analytics';
import type { ISubmitOptions } from '@robota-sdk/agent-interface-session';

type TListener = (event: string, data: Record<string, unknown>) => void;

interface IEndEvent {
  type: 'start' | 'end';
  toolName: string;
  toolArgs?: Record<string, unknown>;
  success?: boolean;
  denied?: boolean;
  toolResultData?: string;
  executionId?: string;
}

interface IDriver {
  emit(event: string, data: Record<string, unknown>): void;
  end(event: Omit<IEndEvent, 'type'>): void;
  /** One call through the same event order the permission wrapper produces. */
  call(options: {
    id: string;
    name?: string;
    args?: Record<string, unknown>;
    decision: 'allowed' | 'denied' | 'hook-blocked';
    output?: string;
    crash?: boolean;
  }): void;
}

const AT = '2026-09-24T00:00:00.000Z';

function createMockSession(run: (driver: IDriver) => Promise<string>) {
  let listener: TListener | undefined;
  let execCtrl: { handleToolExecution(event: IEndEvent): void } | undefined;
  const history: Array<{ role: string; content: string }> = [];
  const driver: IDriver = {
    emit: (event, data) => listener?.(event, data),
    end: (event) => execCtrl?.handleToolExecution({ type: 'end', ...event }),
    call: ({ id, name = 'Bash', args = { command: 'ls' }, decision, output = 'out', crash }) => {
      driver.emit(`tool.${TOOL_PERMISSION_EVENTS.DECIDED}`, { executionId: id, decidedAt: AT, decision });
      if (decision === 'hook-blocked') return;
      if (decision === 'denied') {
        driver.end({ toolName: name, toolArgs: args, success: false, denied: true, executionId: id });
        return;
      }
      execCtrl?.handleToolExecution({ type: 'start', toolName: name, toolArgs: args, executionId: id });
      driver.emit(`tool.${TOOL_BODY_EVENTS.COMPLETED}`, {
        executionId: id, startedAt: AT, endedAt: AT, outcome: crash ? 'failure' : 'success',
      });
      if (crash) driver.end({ toolName: name, toolArgs: args, success: false, executionId: id });
      else driver.end({ toolName: name, toolArgs: args, success: true, toolResultData: output, executionId: id });
    },
  };
  const session = {
    run: vi.fn().mockImplementation(() => run(driver)),
    abort: vi.fn(),
    getHistory: vi.fn().mockImplementation(() => history),
    getContextState: vi.fn().mockReturnValue({ usedPercentage: 10, usedTokens: 1000, maxTokens: 200000 }),
    clearHistory: vi.fn(),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    getProviderId: vi.fn().mockReturnValue('test-provider'),
    getModelId: vi.fn().mockReturnValue('test-model'),
    getEventService: vi.fn().mockReturnValue({
      subscribe: vi.fn((callback: TListener) => void (listener = callback)),
      unsubscribe: vi.fn(() => void (listener = undefined)),
    }),
    getSessionId: vi.fn().mockReturnValue('session.1'),
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getMessageCount: vi.fn().mockReturnValue(0),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    compact: vi.fn(),
    injectMessage: vi.fn(),
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  };
  return { session, bind: (ctrl: typeof execCtrl) => void (execCtrl = ctrl) };
}

const TOOLS: ILivePromptContentPolicy = {
  userPrompts: false, assistantResponses: false, toolArguments: true, toolOutput: true, maxBytes: 2048,
};

function build(run: (driver: IDriver) => Promise<string>, policy: ILivePromptContentPolicy = TOOLS) {
  const traces: ILivePromptTraceBatch[] = [];
  const contents: ILivePromptContentBatch[] = [];
  const mock = createMockSession(run);
  const session = new InteractiveSession({
    session: mock.session as never,
    cwd: '/tmp',
    livePromptTrace: {
      enqueue: (batch) => void traces.push(batch),
      content: { policy, enqueue: (batch) => void contents.push(batch) },
    },
  });
  mock.bind((session as unknown as { execCtrl: Parameters<typeof mock.bind>[0] }).execCtrl);
  return { session, traces, contents };
}

function toolSpan(trace: ILivePromptTraceBatch, callId: string): string | undefined {
  for (const child of trace.children) {
    if (child.kind === 'tool' && child.trace.toolCallId === callId) return child.trace.spanId;
  }
  return undefined;
}

describe('live tool content capture', () => {
  it('captures arguments and output of an allowed call, on its tool-body span', async () => {
    const { session, contents, traces } = build(async (driver) => {
      driver.call({ id: 'call_1', args: { command: 'cat notes', password: 'hunter22' }, decision: 'allowed', output: 'file body' });
      return 'done';
    });
    await session.submit('go');
    const spanId = toolSpan(traces[0]!, 'call_1');
    expect(spanId).toMatch(/^[0-9a-f]{16}$/u);
    expect(contents[0]!.items).toEqual([
      {
        kind: 'tool-arguments', text: '{"command":"cat notes","password":"[redacted]"}',
        originalBytes: 47, truncated: false,
        tool: { callId: 'call_1', name: 'Bash', outcome: 'success', spanId },
      },
      {
        kind: 'tool-output', text: 'file body', originalBytes: 9, truncated: false,
        tool: { callId: 'call_1', name: 'Bash', outcome: 'success', spanId },
      },
    ]);
    expect(JSON.stringify(traces)).not.toMatch(/cat notes|file body/u);
  });

  it('captures only arguments of a denied call, on the root span', async () => {
    const { session, contents } = build(async (driver) => {
      driver.call({ id: 'call_d', decision: 'denied' });
      return 'done';
    });
    await session.submit('go');
    expect(contents[0]!.items).toEqual([{
      kind: 'tool-arguments', text: '{"command":"ls"}', originalBytes: 16, truncated: false,
      tool: { callId: 'call_d', name: 'Bash', outcome: 'denied' },
    }]);
  });

  it('captures arguments and an empty output for a crashed body, as a failure', async () => {
    const { session, contents } = build(async (driver) => {
      driver.call({ id: 'call_c', decision: 'allowed', crash: true });
      return 'done';
    });
    await session.submit('go');
    expect(contents[0]!.items.map((item) => [item.kind, item.text, item.tool?.outcome])).toEqual([
      ['tool-arguments', '{"command":"ls"}', 'failure'],
      ['tool-output', '', 'failure'],
    ]);
  });

  it('captures nothing for a hook-blocked call, an unknown tool, or a call before its body ran', async () => {
    const { session, contents } = build(async (driver) => {
      driver.call({ id: 'call_h', decision: 'hook-blocked' });
      // An unknown tool never reaches the wrapper; a stray end without any event is not ours.
      driver.end({ toolName: 'Nope', toolArgs: { a: 1 }, success: false, executionId: 'call_u' });
      // Allowed, then aborted before the body ran: the crash announcement has no body behind it.
      driver.emit(`tool.${TOOL_PERMISSION_EVENTS.DECIDED}`, { executionId: 'call_a', decidedAt: AT, decision: 'allowed' });
      driver.end({ toolName: 'Bash', toolArgs: { a: 1 }, success: false, executionId: 'call_a' });
      return 'done';
    });
    await session.submit('go');
    expect(contents).toHaveLength(0);
  });

  it('never captures a call whose events did not reach this turn, even under a colliding id', async () => {
    const { session, contents } = build(async (driver) => {
      // The owner call is allowed; while its body runs, another run reports a call with the same id.
      driver.emit(`tool.${TOOL_PERMISSION_EVENTS.DECIDED}`, { executionId: 'call_1', decidedAt: AT, decision: 'allowed' });
      driver.end({ toolName: 'Bash', toolArgs: { command: 'child secret' }, success: true, toolResultData: 'child out', executionId: 'call_1' });
      driver.end({ toolName: 'Bash', toolArgs: { command: 'other' }, success: true, toolResultData: 'x', executionId: 'call_other' });
      driver.emit(`tool.${TOOL_BODY_EVENTS.COMPLETED}`, { executionId: 'call_1', startedAt: AT, endedAt: AT, outcome: 'success' });
      driver.end({ toolName: 'Bash', toolArgs: { command: 'mine' }, success: true, toolResultData: 'my out', executionId: 'call_1' });
      // A second end for an id already captured is not captured again.
      driver.end({ toolName: 'Bash', toolArgs: { command: 'late' }, success: true, toolResultData: 'late', executionId: 'call_1' });
      return 'done';
    });
    await session.submit('go');
    expect(contents[0]!.items.map((item) => item.text)).toEqual(['{"command":"mine"}', 'my out']);
    expect(JSON.stringify(contents)).not.toMatch(/child|other|late/u);
  });

  it('honours each tool gate on its own', async () => {
    const run = async (driver: IDriver) => {
      driver.call({ id: 'call_1', decision: 'allowed' });
      return 'done';
    };
    const args = build(run, { ...TOOLS, toolOutput: false });
    await args.session.submit('go');
    expect(args.contents[0]!.items.map((item) => item.kind)).toEqual(['tool-arguments']);
    const output = build(run, { ...TOOLS, toolArguments: false });
    await output.session.submit('go');
    expect(output.contents[0]!.items.map((item) => item.kind)).toEqual(['tool-output']);
  });

  it.each<[string, ISubmitOptions]>([
    ['a remote co-driver', { driverId: 'device-42' }],
    ['an agent wakeup', { turnSource: 'agent-wakeup', driverId: 'agent' }],
  ])('captures nothing for %s turn', async (_label, options) => {
    const { session, contents } = build(async (driver) => {
      driver.call({ id: 'call_1', decision: 'allowed' });
      return 'done';
    });
    await session.submit('not the owner', undefined, undefined, options);
    expect(contents).toHaveLength(0);
  });

  it('captures nothing from tool events that arrive after the turn ended', async () => {
    let late: IDriver | undefined;
    const { session, contents } = build(async (driver) => {
      late = driver;
      return 'done';
    });
    await session.submit('go');
    late!.call({ id: 'call_late', decision: 'allowed' });
    expect(contents).toHaveLength(0);
  });

  it('slices output before measuring it, keeping its true size', async () => {
    const output = 'é'.repeat(1_000_000);
    const { session, contents } = build(async (driver) => {
      driver.call({ id: 'call_1', decision: 'allowed', output });
      return 'done';
    });
    await session.submit('go');
    const item = contents[0]!.items[1]!;
    expect(item.truncated).toBe(true);
    expect(item.originalBytes).toBe(2_000_000);
    expect(Buffer.byteLength(item.text)).toBeLessThanOrEqual(2048 + LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES);
  });

  it('keeps the prompt and response when 64 allowed calls fill the tool item limit', async () => {
    const { session, contents } = build(async (driver) => {
      for (let index = 0; index < 65; index += 1) driver.call({ id: `call_${index}`, decision: 'allowed' });
      return 'the answer';
    }, { ...TOOLS, userPrompts: true, assistantResponses: true });
    await session.submit('go');
    const items = contents[0]!.items;
    expect(items.slice(0, 2).map((item) => item.kind)).toEqual(['user-prompt', 'assistant-response']);
    expect(items[1]!.text).toBe('the answer');
    expect(items.slice(2)).toHaveLength(128);
    expect(items.at(-1)!.tool!.callId).toBe('call_63');
    expect(contents[0]!.omitted).toEqual({ 'tool-arguments': 1, 'tool-output': 1 });
  });

  it('falls back to the root span when the trace dropped the call at its child limit', async () => {
    const { session, contents, traces } = build(async (driver) => {
      // 250 decisions for calls this turn never runs leave room for three owner calls' children.
      for (let index = 0; index < 250; index += 1) {
        driver.call({ id: `blocked_${index}`, decision: 'hook-blocked' });
      }
      for (let index = 0; index < 4; index += 1) driver.call({ id: `call_${index}`, decision: 'allowed' });
      return 'done';
    }, { ...TOOLS, toolOutput: false });
    await session.submit('go');
    const items = contents[0]!.items;
    expect(traces[0]!.children).toHaveLength(256);
    expect(items).toHaveLength(4);
    expect(items[2]!.tool!.spanId).toBe(toolSpan(traces[0]!, 'call_2'));
    expect(items[2]!.tool!.spanId).toBeDefined();
    expect(toolSpan(traces[0]!, 'call_3')).toBeUndefined();
    expect(items[3]!.tool!.spanId).toBeUndefined();
  });
});

describe('live tool content per-turn text budget', () => {
  it('drops tool items past the text budget but never the prompt or response', () => {
    const accumulator = new LivePromptContentAccumulator(
      { ...TOOLS, userPrompts: true, assistantResponses: true, maxBytes: 256 },
      { textBudgetBytes: 4 * (256 + LIVE_CONTENT_PRETRUNCATE_MARGIN_BYTES) },
    );
    accumulator.addPrompt('p'.repeat(5000));
    const big = 'x'.repeat(5000);
    for (let index = 0; index < 4; index += 1) {
      accumulator.addToolCall({ callId: `c${index}`, name: 'Read', outcome: 'success', args: { big }, output: big });
    }
    accumulator.addResponse('r'.repeat(5000), false);
    const batch = accumulator.finish({ traceId: 't', spanId: 's', endedAt: AT }, new Map());
    expect(batch!.items.map((item) => item.kind)).toEqual([
      'user-prompt', 'assistant-response', 'tool-arguments', 'tool-output',
    ]);
    expect(batch!.omitted).toEqual({ 'tool-arguments': 3, 'tool-output': 3 });
  });
});

describe('live tool content argument rendering failures', () => {
  it('counts arguments whose getter throws as omitted and still captures the output', () => {
    const accumulator = new LivePromptContentAccumulator(TOOLS);
    const args = {
      get command(): string {
        throw new Error('getter boom');
      },
    };
    expect(() =>
      accumulator.addToolCall({ callId: 'c1', name: 'Bash', outcome: 'success', args, output: 'kept' }),
    ).not.toThrow();
    const batch = accumulator.finish({ traceId: 't', spanId: 's', endedAt: AT });
    expect(batch!.items.map((item) => [item.kind, item.text])).toEqual([['tool-output', 'kept']]);
    expect(batch!.omitted).toEqual({ 'tool-arguments': 1 });
  });

  it('keeps the turn settling when arguments throw during a real turn', async () => {
    const { session, contents } = build(async (driver) => {
      const args = Object.defineProperty({}, 'command', {
        enumerable: true,
        get: () => {
          throw new Error('getter boom');
        },
      }) as Record<string, unknown>;
      // The end event alone: the TUI's start projection reads arguments on its own path.
      driver.emit(`tool.${TOOL_PERMISSION_EVENTS.DECIDED}`, { executionId: 'call_1', decidedAt: AT, decision: 'allowed' });
      driver.emit(`tool.${TOOL_BODY_EVENTS.COMPLETED}`, { executionId: 'call_1', startedAt: AT, endedAt: AT, outcome: 'success' });
      driver.end({ toolName: 'Bash', toolArgs: args, success: true, toolResultData: 'kept', executionId: 'call_1' });
      return 'done';
    });
    const handle = await session.submit('go');
    await expect(handle.completed).resolves.toBeDefined();
    expect(contents[0]!.items.map((item) => item.kind)).toEqual(['tool-output']);
    expect(contents[0]!.omitted).toEqual({ 'tool-arguments': 1 });
  });
});

describe('collectSpanEntries owner-call observation', () => {
  it('reports every permission and tool-body event with a string id, even malformed ones', () => {
    let listener: TListener | undefined;
    const bus = {
      subscribe: (callback: TListener) => void (listener = callback),
      unsubscribe: () => void (listener = undefined),
    } as unknown as IEventService;
    const observed: Array<[string, string]> = [];
    const collector = collectSpanEntries(bus, { onToolCallObserved: (id, phase) => void observed.push([id, phase]) });
    listener!(`tool.${TOOL_PERMISSION_EVENTS.DECIDED}`, { executionId: 'a', decidedAt: AT, decision: 'allowed' });
    listener!(`tool.${TOOL_PERMISSION_EVENTS.DECIDED}`, { executionId: 'b', decision: 'denied' });
    listener!(`tool.${TOOL_BODY_EVENTS.COMPLETED}`, { executionId: 'a', startedAt: 'bad' });
    listener!(`tool.${TOOL_BODY_EVENTS.COMPLETED}`, { executionId: 7, startedAt: AT, endedAt: AT, outcome: 'success' });
    expect(observed).toEqual([['a', 'allowed'], ['b', 'denied'], ['a', 'body-completed']]);
    collector.dispose();
  });
});
