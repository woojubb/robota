import { describe, expect, it, vi } from 'vitest';

import { createSession } from '../../assembly/create-session.js';
import { createSubagentSession } from '../../assembly/create-subagent-session.js';
import { AdvisorController } from '../advisor-controller.js';
import { ADVISOR_SYSTEM_PROMPT, buildAdvisorRequest } from '../advisor-request.js';
import { parseAdvisorSpec, resolveStartupAdvisorSpec } from '../advisor-spec.js';
import {
  ADVISOR_TOOL_NAME,
  bindAdvisorTools,
  createAdvisorTool,
  labelAdvisorToolStart,
} from '../advisor-tool.js';

import type { IAdvisorControllerOptions, IAdvisorConsultRequest } from '../advisor-controller.js';
import type { IAdvisorSessionAccess } from '../advisor-tool.js';
import type { ICreateSessionOptions } from '../../assembly/create-session-types.js';
import type { IAIProvider, IHistoryEntry, TUniversalMessage } from '@robota-sdk/agent-core';

type TChat = ReturnType<typeof vi.fn>;

function provider(
  name: string,
  content: string | null = 'Check the failing test first.',
  metadata: Record<string, string | number> = { inputTokens: 1200, outputTokens: 80 },
): IAIProvider & { chat: TChat } {
  return {
    name,
    version: 'test',
    chat: vi.fn(async () => ({
      id: 'advice',
      role: 'assistant' as const,
      content,
      state: 'complete' as const,
      timestamp: new Date(),
      metadata,
    })),
    generateResponse: async () => ({ content: '' }),
    supportsTools: () => false,
    validateConfig: () => true,
  } as unknown as IAIProvider & { chat: TChat };
}

function message(role: 'user' | 'assistant', content: string): TUniversalMessage {
  return { id: `${role}-${content}`, role, content, state: 'complete', timestamp: new Date() };
}

function controller(
  advisor: IAIProvider,
  overrides: Partial<IAdvisorControllerOptions> = {},
): AdvisorController {
  const granted = new Set<string>();
  return new AdvisorController({
    spec: { profile: 'strong' },
    resolveTarget: () => ({ provider: advisor, model: 'strong-model', vendor: 'vendor-a' }),
    consent: { has: (vendor) => granted.has(vendor), grant: (vendor) => granted.add(vendor) },
    ...overrides,
  });
}

function request(overrides: Partial<IAdvisorConsultRequest> = {}): IAdvisorConsultRequest {
  return {
    history: [message('user', 'fix the build')],
    systemPrompt: 'You are the main agent.',
    mainVendor: 'vendor-a',
    sessionId: 'session_main',
    ...overrides,
  };
}

describe('advisor spec', () => {
  it('reads a profile, a profile:model, and off', () => {
    expect(parseAdvisorSpec('strong')).toEqual({ profile: 'strong' });
    expect(parseAdvisorSpec('strong:model:v2')).toEqual({ profile: 'strong', model: 'model:v2' });
    expect(parseAdvisorSpec('off')).toBe('off');
  });

  it('lets the flag win over the saved setting, including a flag of off', () => {
    expect(resolveStartupAdvisorSpec('flag', 'saved')).toEqual({ profile: 'flag' });
    expect(resolveStartupAdvisorSpec(undefined, 'saved')).toEqual({ profile: 'saved' });
    expect(resolveStartupAdvisorSpec('off', 'saved')).toBeUndefined();
  });
});

describe('advisor request', () => {
  const history = [message('user', 'A'.repeat(4_000)), message('user', 'recent question')];

  it('keeps the system prompt and drops the oldest messages to fit the window', () => {
    const built = buildAdvisorRequest({
      systemPrompt: 'SYSTEM PROMPT',
      history,
      contextWindow: 2_048 + 400 + Math.ceil(ADVISOR_SYSTEM_PROMPT.length / 4),
    });
    expect(built?.prompt).toContain('SYSTEM PROMPT');
    expect(built?.prompt).toContain('recent question');
    expect(built?.prompt).not.toContain('AAAA');
    expect(built?.omittedMessages).toBe(1);
  });

  it('is no request when the system prompt alone does not fit', () => {
    expect(
      buildAdvisorRequest({ systemPrompt: 'S'.repeat(40_000), history, contextWindow: 4_096 }),
    ).toBeUndefined();
  });
});

describe('AdvisorController', () => {
  it('registers the tool only when an advisor is configured at start and not killed', () => {
    const advisor = provider('vendor-a');
    expect(controller(advisor).isRegistered()).toBe(true);
    expect(controller(advisor, { spec: undefined }).isRegistered()).toBe(false);
    expect(controller(advisor, { killSwitch: true }).isRegistered()).toBe(false);
    expect(controller(advisor, { allowedProfiles: ['other'] }).isRegistered()).toBe(false);
  });

  it('sends one serialized prompt with tool calls, results and peer provenance, and no tools', async () => {
    const advisor = provider('vendor-a');
    const history: TUniversalMessage[] = [
      { ...message('user', 'from a peer'), metadata: { driverId: 'peer:session_x' } },
      {
        id: 'a1',
        role: 'assistant',
        state: 'complete',
        timestamp: new Date(),
        content: null,
        toolCalls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'Shell', arguments: '{"command":"ls"}' },
          },
        ],
      },
      {
        id: 't1',
        role: 'tool',
        content: 'README.md',
        toolCallId: 'c1',
        name: 'Shell',
        state: 'complete',
        timestamp: new Date(),
      },
    ];
    const result = await controller(advisor).consult(request({ history, question: 'next?' }));
    expect(result.outcome).toBe('answered');
    const [messages, options] = advisor.chat.mock.calls[0]!;
    expect(options).toMatchObject({ model: 'strong-model', toolChoice: 'none' });
    expect(options.tools).toBeUndefined();
    expect(messages).toHaveLength(2);
    const prompt = (messages as TUniversalMessage[])[1]!.content as string;
    expect(prompt).toContain('You are the main agent.');
    expect(prompt).toContain('user [from peer:session_x]: from a peer');
    expect(prompt).toContain('assistant tool call Shell [c1]: {"command":"ls"}');
    expect(prompt).toContain('tool result Shell [c1]: README.md');
    expect(prompt).toContain('The agent asks: next?');
  });

  it('frames the answer as guidance to verify', async () => {
    const result = await controller(provider('vendor-a')).consult(request());
    expect(result.text).toContain('Advisor (strong-model) guidance');
    expect(result.text).toContain('check it against');
    expect(result.text).toContain('Check the failing test first.');
  });

  it('declines when the conversation cannot fit the advisor window', async () => {
    const advisor = provider('vendor-a');
    const c = controller(advisor, {
      resolveTarget: () => ({
        provider: advisor,
        model: 'tiny',
        vendor: 'vendor-a',
        contextWindow: 3_000,
      }),
    });
    const result = await c.consult(request({ systemPrompt: 'S'.repeat(40_000) }));
    expect(result).toMatchObject({ outcome: 'declined' });
    expect(result.text).toContain('declined (context too large)');
    expect(advisor.chat).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
  ])('reads an %s answer as declined', async (_label, content) => {
    const result = await controller(provider('vendor-a', content)).consult(request());
    expect(result.outcome).toBe('declined');
    expect(result.text).toContain('declined');
  });

  it('reads a refusal as declined', async () => {
    const refusing = provider('vendor-a', 'I cannot help with that.', { stopReason: 'refusal' });
    expect((await controller(refusing).consult(request())).outcome).toBe('declined');
  });

  it('allows two calls per turn, and a new turn resets that', async () => {
    const advisor = provider('vendor-a');
    const c = controller(advisor);
    expect((await c.consult(request({ question: 'one' }))).outcome).toBe('answered');
    expect((await c.consult(request({ question: 'two' }))).outcome).toBe('answered');
    expect((await c.consult(request({ question: 'three' }))).outcome).toBe('limit');
    expect(advisor.chat).toHaveBeenCalledTimes(2);
    const nextTurn = [message('user', 'fix the build'), message('user', 'now the tests')];
    expect((await c.consult(request({ history: nextTurn, question: 'three' }))).outcome).toBe(
      'answered',
    );
  });

  it('stops at the per-session limit', async () => {
    const c = controller(provider('vendor-a'), { maxCallsPerSession: 1 });
    await c.consult(request({ question: 'one' }));
    const turn2 = [message('user', 'a'), message('user', 'b')];
    const result = await c.consult(request({ history: turn2, question: 'two' }));
    expect(result.outcome).toBe('limit');
    expect(result.text).toContain('per session');
  });

  it('returns the earlier answer for a repeated question in the same turn', async () => {
    const advisor = provider('vendor-a');
    const c = controller(advisor);
    const first = await c.consult(request({ question: 'Is this right?' }));
    const again = await c.consult(request({ question: '  is this   right? ' }));
    expect(again).toEqual({ outcome: 'repeated', text: first.text });
    expect(advisor.chat).toHaveBeenCalledTimes(1);
  });

  it('turns off and retargets without touching the tool schema', async () => {
    const strong = provider('vendor-a');
    const other = provider('vendor-a', 'Other advice.');
    const c = controller(strong, {
      resolveTarget: (spec) =>
        spec.profile === 'other'
          ? { provider: other, model: 'other-model', vendor: 'vendor-a' }
          : { provider: strong, model: 'strong-model', vendor: 'vendor-a' },
    });
    const tool = createAdvisorTool(c);
    const schemaBefore = JSON.stringify(tool.schema);

    expect(c.set('off')).toMatchObject({ success: true, saved: 'off' });
    expect(await c.consult(request())).toMatchObject({ outcome: 'disabled' });
    expect(c.set('other')).toMatchObject({ success: true, saved: 'other' });
    const result = await c.consult(request());
    expect(result.text).toContain('Other advice.');
    expect(strong.chat).not.toHaveBeenCalled();

    expect(JSON.stringify(tool.schema)).toBe(schemaBefore);
    const [bound] = bindAdvisorTools([tool], () => undefined);
    expect(bound!.schema).toBe(tool.schema);
  });

  it('keeps a saved advisor when the main model changes vendor', async () => {
    const advisor = provider('vendor-a');
    const c = controller(advisor, {
      consent: { has: () => true, grant: () => undefined },
    });
    await c.consult(request({ mainVendor: 'vendor-z' }));
    expect(advisor.chat.mock.calls[0]![1]).toMatchObject({ model: 'strong-model' });
  });

  it('applies the organization allowlist', async () => {
    const advisor = provider('vendor-a');
    const c = controller(advisor, { allowedProfiles: ['strong'] });
    expect(c.set('elsewhere')).toMatchObject({ success: false });
    expect(c.set('elsewhere').message).toContain('organization policy');
    const blocked = controller(advisor, { allowedProfiles: ['other'] });
    expect((await blocked.consult(request())).text).toContain('organization policy');
    expect(advisor.chat).not.toHaveBeenCalled();
  });

  it('asks once per vendor before sending history to a different vendor', async () => {
    const advisor = provider('vendor-b');
    const granted = new Set<string>();
    const c = controller(advisor, {
      resolveTarget: () => ({ provider: advisor, model: 'b-model', vendor: 'vendor-b' }),
      consent: { has: (v) => granted.has(v), grant: (v) => granted.add(v) },
    });

    const refused = await c.consult(request());
    expect(refused.outcome).toBe('declined');
    expect(refused.text).toContain('consent');
    expect(advisor.chat).not.toHaveBeenCalled();

    const ask = vi.fn(async () => ({ type: 'answer' as const, values: ['yes'] }));
    expect((await c.consult(request({ ask, question: 'q1' }))).outcome).toBe('answered');
    expect(granted.has('vendor-b')).toBe(true);
    await c.consult(request({ ask, question: 'q2' }));
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('does not ask when the advisor is on the same vendor', async () => {
    const ask = vi.fn();
    await controller(provider('vendor-a')).consult(request({ ask }));
    expect(ask).not.toHaveBeenCalled();
  });

  it('is off under the kill switch and cannot be turned on', async () => {
    const c = controller(provider('vendor-a'), { killSwitch: true });
    expect((await c.consult(request())).outcome).toBe('disabled');
    expect(c.set('strong').success).toBe(false);
  });

  it('records usage under the advisor model', async () => {
    const recorded: IHistoryEntry[] = [];
    await controller(provider('vendor-a')).consult(
      request({ recordUsage: (entry) => recorded.push(entry) }),
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      type: 'usage-summary',
      data: {
        promptTokens: 1200,
        completionTokens: 80,
        source: { scope: 'tool', id: 'advisor:strong-model', label: 'Advisor (strong-model)' },
      },
    });
  });
});

describe('Advisor tool in assembled sessions', () => {
  const terminal = {
    write: () => undefined,
    writeLine: () => undefined,
    writeMarkdown: () => undefined,
    writeError: () => undefined,
    prompt: async () => '',
    select: async () => 0,
    spinner: () => ({ stop: () => undefined, update: () => undefined }),
  };

  function options(extra: Partial<ICreateSessionOptions> = {}): ICreateSessionOptions {
    return {
      config: {
        defaultTrustLevel: 'safe',
        provider: { name: 'vendor-a', model: 'main-model', apiKey: undefined },
        permissions: { allow: [], deny: [] },
        env: {},
      },
      context: { agentsMd: '', projectNotesMd: '' },
      terminal,
      provider: provider('vendor-a'),
      defaultTools: [],
      permissionMode: 'bypassPermissions',
      ...extra,
    };
  }

  function lastPrompt(advisor: { chat: TChat }): string {
    const calls = advisor.chat.mock.calls;
    return ((calls[calls.length - 1]![0] as TUniversalMessage[])[1]!.content as string) ?? '';
  }

  it('reads the conversation of the session that holds it and records usage there', async () => {
    const advisor = provider('vendor-a');
    const { session } = await createSession(
      options({ additionalTools: [createAdvisorTool(controller(advisor))] }),
    );
    expect(session.getToolSchemas().map((schema) => schema.name)).toContain(ADVISOR_TOOL_NAME);
    session.injectMessage('user', 'the main conversation');
    const result = await session.invokeRuntimeTool(ADVISOR_TOOL_NAME, { question: 'ok?' });
    expect(result.success).toBe(true);
    expect(lastPrompt(advisor)).toContain('user: the main conversation');
    expect(session.getSessionTokenUsage()).toEqual({ inputTokens: 1200, outputTokens: 80 });
  });

  it('is absent when the host added none', async () => {
    const { session } = await createSession(options());
    expect(session.getToolSchemas().map((schema) => schema.name)).not.toContain(ADVISOR_TOOL_NAME);
  });

  it('is inherited by an in-process subagent, bound to the subagent conversation', async () => {
    const advisor = provider('vendor-a');
    const parent: IAdvisorSessionAccess = {
      getHistory: () => [message('user', 'parent conversation')],
      getSystemMessage: () => 'parent',
      getProviderId: () => 'vendor-a',
      getSessionId: () => 'parent',
      addHistoryEntry: () => undefined,
    };
    const parentTools = bindAdvisorTools([createAdvisorTool(controller(advisor))], () => parent);
    const base = options();
    const child = createSubagentSession({
      agentDefinition: { name: 'worker', description: 'w', systemPrompt: 'Work.' },
      parentConfig: base.config,
      parentContext: base.context,
      parentTools,
      provider: base.provider!,
      terminal,
      cwd: process.cwd(),
      permissionMode: 'bypassPermissions',
    });
    child.injectMessage('user', 'child conversation');
    await child.invokeRuntimeTool(ADVISOR_TOOL_NAME, {});
    expect(lastPrompt(advisor)).toContain('child conversation');
    expect(lastPrompt(advisor)).not.toContain('parent conversation');
  });

  it('shows the advisor model on the tool line', () => {
    const tools = [createAdvisorTool(controller(provider('vendor-a')))];
    const event = labelAdvisorToolStart(tools, {
      type: 'start' as const,
      toolName: ADVISOR_TOOL_NAME,
      toolArgs: { question: 'q' },
    });
    expect(Object.values(event.toolArgs ?? {})[0]).toBe('strong-model');
  });
});
