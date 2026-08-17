/**
 * The remote STREAMING request — CORE-046.
 *
 * ## The one spelling
 *
 * `${baseUrl}/chat/stream`, matching `REMOTE_CHAT_STREAM_PATH` in the server's route table and the
 * route named in `apps/agent-server/docs/SPEC.md`. The predecessor of this file posted to
 * `${baseUrl}/stream` while a sibling module named `/chat/stream` and the server served neither, so
 * every call was a 404 — and the client tests were green because they mocked `fetch`, which cannot
 * notice that the far end does not exist. That is why the test for this lives against the real route
 * table rather than a mock.
 *
 * ## The client does NOT assemble
 *
 * The wire carries text deltas plus ONE terminal assembled message, because the server calls
 * `provider.chat(messages, { onTextDelta })` and the provider's own contract requires it to stream
 * internally and still return the complete message. So this reads deltas, hands each to the caller's
 * `onTextDelta`, and returns the terminal message unchanged.
 *
 * That division is the reason the capability could be restored at all: the removed client yielded
 * RAW provider chunks and relied on a fragment assembler that CORE-042 deleted. Re-implementing an
 * accumulator here would put a second assembler in the world, against a fragmentation behaviour no
 * in-repo test can observe — the failure class CORE-042 existed to end.
 */

import { toWireChatOptions } from './wire-chat-options.js';

import type { IBasicMessage, IResponseMessage } from '../types/message-types';
import type { IChatOptions, IToolSchema } from '@robota-sdk/agent-core';
import type { ILogger } from '@robota-sdk/agent-core';

/** The path this client posts to. Exported so a contract test can compare it to the server's. */
export const REMOTE_CHAT_STREAM_SUFFIX = '/chat/stream';

interface ISseFrame {
  event: string;
  data: string;
}

/**
 * Split an SSE byte stream into frames.
 *
 * A generator over the stream rather than a whole-body parse, because a frame is exactly what the
 * caller must be handed AS IT ARRIVES — buffering to the end would make this a slower non-streaming
 * call wearing a stream's content type.
 *
 * Takes a READER rather than an async iterable. `ReadableStream` is async-iterable in Node but not
 * in the DOM lib TypeScript resolves here, so consuming it that way needs a blind
 * `as unknown as AsyncIterable<…>` — an assertion that is not merely untidy but wrong outside Node,
 * where the runtime would not honour it. `getReader()` is the typed, portable API and needs no cast.
 */
export async function* readSseFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ISseFrame> {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = block.split('\n');
      const event = lines
        .find((l) => l.startsWith('event:'))
        ?.slice('event:'.length)
        .trim();
      const data = lines
        .find((l) => l.startsWith('data:'))
        ?.slice('data:'.length)
        .trim();
      if (event !== undefined && data !== undefined) yield { event, data };
      boundary = buffer.indexOf('\n\n');
    }
  }
}

/**
 * Post a streaming chat request and return the terminal assembled message.
 *
 * @param onDelta - called once per text delta as it arrives
 * @throws when the server frames an `error`, or when the stream ends without a terminal message —
 *   a stream that stopped early is a FAILED turn, and returning a partial message as though it were
 *   complete is how a truncation becomes an answer nobody can tell from a real one.
 */
export async function executeChatStreamRequest(
  baseUrl: string,
  headers: Record<string, string>,
  logger: ILogger,
  messages: IBasicMessage[],
  provider: string,
  model: string,
  onDelta: (delta: string) => void,
  tools?: IToolSchema[],
  options?: IChatOptions,
): Promise<IResponseMessage> {
  const wireOptions = toWireChatOptions(options);
  const requestData: Record<string, unknown> = {
    messages,
    provider,
    model,
    ...(tools && tools.length > 0 && { tools }),
    ...(wireOptions && { options: wireOptions }),
  };

  logger.debug('HTTP streaming request', {
    toolCount: tools?.length ?? 0,
    optionKeys: wireOptions ? Object.keys(wireOptions) : [],
  });

  const response = await fetch(`${baseUrl}${REMOTE_CHAT_STREAM_SUFFIX}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(requestData),
    // Same rule as the non-streaming path: a signal cannot be serialized, so cancelling the HTTP
    // request IS the cancellation on this seam. The server closes its provider call when the socket
    // drops, so an abort stops work at both ends rather than only at this one.
    ...(options?.signal && { signal: options.signal }),
  });

  if (!response.ok) {
    // A validation refusal arrives as an ordinary JSON 400, because the server validates BEFORE
    // opening the stream. Reading it as such keeps `rejected` legible instead of hiding a 400 behind
    // "the stream produced no message".
    const body = await response.text();
    throw new Error(`Remote streaming chat failed (${response.status}): ${body}`);
  }
  if (!response.body) {
    throw new Error('Remote streaming chat returned no body');
  }

  let terminal: IResponseMessage | undefined;
  for await (const frame of readSseFrames(response.body.getReader())) {
    if (frame.event === 'delta') {
      onDelta((JSON.parse(frame.data) as { text: string }).text);
      continue;
    }
    if (frame.event === 'message') {
      terminal = JSON.parse(frame.data) as IResponseMessage;
      continue;
    }
    if (frame.event === 'error') {
      throw new Error((JSON.parse(frame.data) as { error: string }).error);
    }
  }

  if (!terminal) {
    throw new Error(
      'Remote streaming chat ended without a terminal message — the turn did not complete',
    );
  }
  return terminal;
}
