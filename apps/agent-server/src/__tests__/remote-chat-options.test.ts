import { describe, expect, it } from 'vitest';

import { parseChatOptionsFromBody } from '../remote-chat-options';

/**
 * CORE-044 — what the remote chat handlers actually forward into `provider.chat`.
 *
 * The handlers destructured `{ provider, messages, model }` and called `provider.chat(messages,
 * { model })`. The client had always sent `tools`. So a remote-executor agent configured with tools
 * reached the model with **none** — and nothing failed, because a model that is never offered a tool
 * simply never calls one. The per-call options were dropped by the same line.
 *
 * The tool case is first because it is the user-facing one: an agent that appears to work and
 * quietly cannot act.
 */
describe('remote chat options (CORE-044)', () => {
  it('forwards the tools the client sent — the drop that made a remote agent toolless', () => {
    const { options, rejected } = parseChatOptionsFromBody(
      {
        provider: 'openai',
        messages: [],
        tools: [
          {
            name: 'get_weather',
            description: 'Get the weather for a city',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      },
      'gpt-4',
    );

    expect(options.tools?.map((t) => t.name)).toEqual(['get_weather']);
    expect(rejected).toEqual([]);
  });

  it('forwards every per-call option the wire carries', () => {
    const { options, rejected } = parseChatOptionsFromBody(
      {
        options: {
          maxTokens: 512,
          temperature: 0.2,
          effort: 'low',
          toolChoice: 'required',
          responseFormat: { type: 'json_schema', name: 'Weather', schema: { type: 'object' } },
          openai: { user: 'u-1' },
        },
      },
      'gpt-4',
    );

    expect(options).toMatchObject({
      model: 'gpt-4',
      maxTokens: 512,
      temperature: 0.2,
      effort: 'low',
      toolChoice: 'required',
      responseFormat: { type: 'json_schema', name: 'Weather', schema: { type: 'object' } },
      openai: { user: 'u-1' },
    });
    expect(rejected).toEqual([]);
  });

  it('carries a named tool directive, not just the simple ones', () => {
    const { options } = parseChatOptionsFromBody(
      { options: { toolChoice: { tool: 'get_weather' } } },
      'gpt-4',
    );
    expect(options.toolChoice).toEqual({ tool: 'get_weather' });
  });

  it('distinguishes "did not ask" from "asked for nothing"', () => {
    // An omitted option must stay omitted rather than becoming an explicit undefined, because the
    // provider adapters read presence: `temperature: undefined` and no temperature at all are
    // different requests.
    const { options } = parseChatOptionsFromBody({ options: {} }, 'gpt-4');
    expect('temperature' in options).toBe(false);
    expect('toolChoice' in options).toBe(false);
  });

  describe('the body is anonymous network input, so it is validated rather than spread', () => {
    it('rejects an ill-typed option and SAYS SO instead of dropping it quietly', () => {
      // Replacing one silent drop with another would not be a fix, which is why `rejected` exists
      // and why the handlers return it to the caller.
      const { options, rejected } = parseChatOptionsFromBody(
        { options: { maxTokens: 'lots', effort: 'turbo', toolChoice: 'sometimes' } },
        'gpt-4',
      );

      expect(options.maxTokens).toBeUndefined();
      expect(options.effort).toBeUndefined();
      expect(options.toolChoice).toBeUndefined();
      expect(rejected).toHaveLength(3);
      expect(rejected.join(' ')).toMatch(/maxTokens/);
      expect(rejected.join(' ')).toMatch(/effort/);
      expect(rejected.join(' ')).toMatch(/toolChoice/);
    });

    it('rejects a tool whose description is missing, the same rule the local turn applies', () => {
      const { options, rejected } = parseChatOptionsFromBody(
        {
          tools: [
            { name: 'ok_tool', description: 'fine', parameters: { type: 'object' } },
            { name: 'bad_tool', parameters: { type: 'object' } },
          ],
        },
        'gpt-4',
      );

      expect(options.tools?.map((t) => t.name)).toEqual(['ok_tool']);
      expect(rejected.join(' ')).toMatch(/bad_tool.*description/);
    });

    it('rejects a non-object options field rather than throwing on it', () => {
      const { rejected } = parseChatOptionsFromBody({ options: 'everything' }, 'gpt-4');
      expect(rejected.join(' ')).toMatch(/options: not an object/);
    });

    it('survives a body that is not an object at all', () => {
      const { options, rejected } = parseChatOptionsFromBody('not a body', 'gpt-4');
      expect(options).toEqual({ model: 'gpt-4' });
      expect(rejected).toEqual([]);
    });
  });
});
