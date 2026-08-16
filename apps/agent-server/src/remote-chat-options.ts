/**
 * Request-body → `IChatOptions` validation for the remote chat routes (CORE-044).
 *
 * The handlers used to destructure `{ provider, messages, model }` and call
 * `provider.chat(messages, { model })`. The client had always sent `tools`; the server never read
 * them, so **an agent configured with tools reached the model with none** — silently, because
 * nothing fails when a model is simply never offered a tool. Every per-call option was in the same
 * position.
 *
 * This is a trust boundary: the body is anonymous network input on its way into a provider SDK, so
 * each field is validated rather than spread. An ill-typed field is REPORTED rather than dropped —
 * the handlers answer `400` with the list — because a silently ignored option is the exact defect
 * this module exists to end, and trading one silent drop for another would be no fix at all. Keys
 * the schema does not know are ignored rather than rejected: they carry no instruction, so they
 * cannot produce an answer nobody asked for.
 */

import type { IChatOptions, IToolSchema, TModelEffort, TToolChoice } from '@robota-sdk/agent-core';

const EFFORTS: readonly TModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const SIMPLE_TOOL_CHOICES = ['auto', 'none', 'required'] as const;

/** What the body asked for, and what could not be honoured. */
export interface IParsedChatOptions {
  options: IChatOptions;
  /** Fields present in the body that were not applied, with the reason. Never silently empty. */
  rejected: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseToolChoice(value: unknown): TToolChoice | undefined {
  if (typeof value === 'string' && (SIMPLE_TOOL_CHOICES as readonly string[]).includes(value)) {
    return value as TToolChoice;
  }
  if (isRecord(value) && typeof value['tool'] === 'string' && value['tool'].length > 0) {
    return { tool: value['tool'] };
  }
  return undefined;
}

function parseResponseFormat(value: unknown): IChatOptions['responseFormat'] | undefined {
  if (!isRecord(value)) return undefined;
  const type = value['type'];
  if (type === 'text' || type === 'json_object') {
    return { type };
  }
  if (type === 'json_schema' && isRecord(value['schema'])) {
    return {
      type: 'json_schema',
      ...(typeof value['name'] === 'string' && { name: value['name'] }),
      schema: value['schema'],
    };
  }
  return undefined;
}

/**
 * Validate the `tools` array a client sent.
 *
 * A tool missing its description is REJECTED rather than forwarded: the turn applies the same rule
 * locally (`resolveProviderAndTools`), and a remote agent whose tool list quietly differs from the
 * local one is the divergence class this seam already suffered from.
 */
function parseTools(value: unknown, rejected: string[]): IToolSchema[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    rejected.push('tools: not an array');
    return undefined;
  }
  const tools: IToolSchema[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry) || typeof entry['name'] !== 'string' || entry['name'].length === 0) {
      rejected.push(`tools[${index}]: missing a string "name"`);
      continue;
    }
    if (typeof entry['description'] !== 'string' || entry['description'].length === 0) {
      rejected.push(`tools[${index}] (${entry['name']}): missing a non-empty "description"`);
      continue;
    }
    if (!isRecord(entry['parameters'])) {
      rejected.push(`tools[${index}] (${entry['name']}): "parameters" must be an object schema`);
      continue;
    }
    tools.push(entry as unknown as IToolSchema);
  }
  return tools.length > 0 ? tools : undefined;
}

/**
 * Build the `IChatOptions` for a remote chat call from the request body.
 *
 * `model` comes from its own top-level field because the route selects on it; everything else comes
 * from the body's `options` object, which is how the client sends it (see `wire-chat-options.ts` in
 * `@robota-sdk/agent-remote-client` for the matching projection).
 */
export function parseChatOptionsFromBody(
  body: unknown,
  model: string | undefined,
): IParsedChatOptions {
  const rejected: string[] = [];
  const source = isRecord(body) ? body : {};

  const tools = parseTools(source['tools'], rejected);

  const raw = source['options'];
  if (raw !== undefined && !isRecord(raw)) {
    rejected.push('options: not an object');
  }
  const wire = isRecord(raw) ? raw : {};

  const options: IChatOptions = {
    ...(model !== undefined && { model }),
    ...(tools && { tools }),
  };

  if (wire['maxTokens'] !== undefined) {
    if (typeof wire['maxTokens'] === 'number' && Number.isFinite(wire['maxTokens'])) {
      options.maxTokens = wire['maxTokens'];
    } else {
      rejected.push('options.maxTokens: not a finite number');
    }
  }
  if (wire['temperature'] !== undefined) {
    if (typeof wire['temperature'] === 'number' && Number.isFinite(wire['temperature'])) {
      options.temperature = wire['temperature'];
    } else {
      rejected.push('options.temperature: not a finite number');
    }
  }
  if (wire['effort'] !== undefined) {
    if (
      typeof wire['effort'] === 'string' &&
      (EFFORTS as readonly string[]).includes(wire['effort'])
    ) {
      options.effort = wire['effort'] as TModelEffort;
    } else {
      rejected.push(`options.effort: not one of ${EFFORTS.join(', ')}`);
    }
  }
  if (wire['toolChoice'] !== undefined) {
    const toolChoice = parseToolChoice(wire['toolChoice']);
    if (toolChoice !== undefined) {
      options.toolChoice = toolChoice;
    } else {
      rejected.push('options.toolChoice: not auto | none | required | { tool: string }');
    }
  }
  if (wire['responseFormat'] !== undefined) {
    const responseFormat = parseResponseFormat(wire['responseFormat']);
    if (responseFormat !== undefined) {
      options.responseFormat = responseFormat;
    } else {
      rejected.push('options.responseFormat: unrecognised shape');
    }
  }
  for (const key of ['nativeWebTools', 'openai', 'anthropic', 'google'] as const) {
    if (wire[key] === undefined) continue;
    if (isRecord(wire[key])) {
      Object.assign(options, { [key]: wire[key] });
    } else {
      rejected.push(`options.${key}: not an object`);
    }
  }

  return { options, rejected };
}
