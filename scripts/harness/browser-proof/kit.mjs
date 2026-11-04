/**
 * What a scenario is written with. This module is bundled into every scenario's bundle and runs in
 * the same web-only realm as the library under proof, so it too uses web-standard globals only.
 *
 * A scenario is `export default async function (t) { ... }`. It records what it observes through
 * `t`; it never throws to report a result, and a throw it did not expect is itself a failed check.
 */
import { jsonResponse, sseResponse } from './fetch-stub.mjs';
import { stub } from './install.mjs';

export { jsonResponse, sseResponse };

/** A value with its keys in a fixed order, so two equal values serialise to the same text. */
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

const show = (value) => {
  const text = JSON.stringify(canonical(value));
  return text === undefined ? String(value) : text.length > 400 ? `${text.slice(0, 400)}...` : text;
};

const matches = (text, pattern) =>
  pattern instanceof RegExp ? pattern.test(text) : text.includes(String(pattern));

/** The failure a thrown value reports, with the stack so the runner can name the source file. */
export function describeThrown(error, depth = 0) {
  return {
    name: error?.name ?? typeof error,
    message: String(error?.message ?? error),
    stack: typeof error?.stack === 'string' ? error.stack : undefined,
    ...(depth < 4 && error?.cause !== undefined
      ? { cause: describeThrown(error.cause, depth + 1) }
      : {}),
  };
}

/**
 * A provider that answers from a declared script, so a turn through the real agent loop needs no
 * network. A turn is `{ text }` or `{ toolCalls: [{ name, args }] }`. `requests` holds the messages
 * of every `chat` call.
 */
export function scriptedProvider(turns) {
  const requests = [];
  let cursor = 0;
  const provider = {
    name: 'scripted',
    version: 'proof',
    async chat(messages, options) {
      requests.push(messages.map((message) => ({ ...message })));
      const turn = turns[cursor];
      if (turn === undefined)
        throw new Error(`scripted provider: script of ${turns.length} turn(s) is exhausted`);
      cursor += 1;
      const base = {
        id: `scripted-${cursor}`,
        role: 'assistant',
        state: 'complete',
        timestamp: new Date(),
      };
      if ('text' in turn) {
        options?.onTextDelta?.(turn.text);
        return { ...base, content: turn.text };
      }
      return {
        ...base,
        content: null,
        toolCalls: turn.toolCalls.map((call, index) => ({
          id: `call-${cursor}-${index}`,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      };
    },
    async generateResponse() {
      return { content: 'scripted provider does not implement raw responses' };
    },
    supportsTools: () => true,
    validateConfig: () => true,
  };
  return { provider, requests };
}

/** A user message as the providers take it. */
export function userMessage(content) {
  return { id: 'proof-message', role: 'user', content, state: 'complete', timestamp: new Date() };
}

/** Runs a scenario and returns what it recorded, as JSON text (the only thing that leaves the realm). */
export async function runScenario(scenario) {
  globalThis.fetch = stub.fetch;
  const checks = [];
  const record = (label, ok, detail) =>
    checks.push(detail === undefined ? { label, ok } : { label, ok, detail });
  const t = {
    /** `actual` equals `expected`, compared as JSON with sorted keys. */
    equal(label, actual, expected) {
      const [a, b] = [show(actual), show(expected)];
      record(label, a === b, a === b ? undefined : `expected ${b}, got ${a}`);
    },
    ok(label, condition, detail) {
      record(label, Boolean(condition), condition ? undefined : detail);
    },
    /** `actual` is text that contains `pattern` (a string) or matches it (a RegExp). */
    match(label, actual, pattern) {
      const text = String(actual);
      const ok = matches(text, pattern);
      record(label, ok, ok ? undefined : `expected ${String(pattern)} in ${show(text)}`);
    },
    /** `run` throws, and its message contains or matches `pattern`. */
    async rejects(label, run, pattern) {
      try {
        await run();
        record(label, false, 'it did not throw');
      } catch (error) {
        const { message } = describeThrown(error);
        const ok = matches(message, pattern);
        record(label, ok, ok ? undefined : `expected ${String(pattern)} in ${show(message)}`);
      }
    },
    /** The fetch stub: `t.fetch.on(match, reply)` answers, `t.fetch.requests` is what it received. */
    fetch: stub,
  };
  let failure;
  try {
    await scenario(t);
  } catch (error) {
    failure = describeThrown(error);
    record('the scenario ran to completion', false, `${failure.name}: ${failure.message}`);
  }
  return JSON.stringify({ checks, failure, requests: stub.requests.length });
}
