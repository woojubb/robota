/**
 * The remote STREAMING chat route — CORE-046.
 *
 * ## Why this did not exist
 *
 * The client used to post to `${baseUrl}/stream`, a second module named `/chat/stream`, and both
 * `app.ts` and this app's SPEC claimed the route was inlined — while **no server here served either
 * spelling**. Every remote streaming call was a 404 dressed as a capability, and the suite stayed
 * green because the client's tests drove a mocked `fetch`. CORE-044 deleted the client rather than
 * inventing a route, because the thing it depended on was gone: it yielded RAW provider chunks and
 * relied on an assembler that CORE-042 deleted with the second execution engine.
 *
 * ## Why it can exist now: the server owns assembly
 *
 * This handler calls `provider.chat(messages, { …options, onTextDelta })`. That is not a new
 * contract — `IChatOptions.onTextDelta` already requires every provider to "stream internally, call
 * this for each text chunk, and still return the complete assembled message". So the provider
 * assembles, and the wire carries **text deltas plus one terminal assembled message**.
 *
 * Tool-call FRAGMENTS therefore never reach the wire. That is the whole reason this is safe to
 * restore: there is one assembler in the world and it is the provider's, rather than a second one
 * re-implemented in the client against a fragmentation behaviour no in-repo test could observe.
 *
 * ## One spelling
 *
 * `/api/v1/remote/chat/stream` — here, in the client, and in `apps/agent-server/docs/SPEC.md`. The
 * three-spellings state is what made the gap survivable for as long as it lasted.
 *
 * ## Transport
 *
 * SSE, chosen over chunked transfer because it frames messages for us: a delta and the terminal
 * message are different kinds of thing, and `event:` says which without the client having to invent
 * a delimiter. Frames are `delta`, `message`, `done` and `error`.
 */

import { createLogger } from '@robota-sdk/agent-core';

import { requireOperatorKeyAuth } from '../middleware/require-operator-key-auth.js';
import { parseChatOptionsFromBody } from '../remote-chat-options.js';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { Express, Response } from 'express';

const routeLogger = createLogger('agent-server');

/** The one spelling. Imported by the route table and asserted by the client's contract test. */
export const REMOTE_CHAT_STREAM_PATH = '/api/v1/remote/chat/stream';

function writeFrame(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Register the streaming counterpart of `/api/v1/remote/chat`. */
export function registerProviderChatStreamRoute(
  app: Express,
  providers: Record<string, IAIProvider>,
): void {
  // SEC-008: authenticated for the same reason the non-streaming route is — it spends the
  // OPERATOR's provider credit. A streaming route that skipped the gate would be the same hole with
  // a different content type.
  app.post(REMOTE_CHAT_STREAM_PATH, requireOperatorKeyAuth, async (req, res) => {
    const { provider: providerName, messages, model } = req.body;
    if (!providerName || typeof providerName !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "provider" field' });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res
        .status(400)
        .json({ error: 'Missing or invalid "messages" field: must be a non-empty array' });
      return;
    }
    const provider = providers[providerName];
    if (!provider) {
      res.status(400).json({ error: `Unknown provider: ${providerName}` });
      return;
    }
    // CORE-044's rule, unchanged: refusing beats applying part of what was asked. Validation runs
    // BEFORE the SSE headers go out, so a rejected request is an ordinary 400 a client can read as
    // one, rather than an error frame inside a 200 stream.
    const { options, rejected } = parseChatOptionsFromBody(
      req.body,
      typeof model === 'string' ? model : undefined,
    );
    if (rejected.length > 0) {
      res.status(400).json({ error: 'Invalid request options', rejected });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Proxies that buffer defeat the point of streaming at all.
      'X-Accel-Buffering': 'no',
    });

    // Cancellation, matching the non-streaming path CORE-044 wired: the client aborting its request
    // closes the socket, and the provider call is aborted rather than left running to completion at
    // the operator's expense.
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const assembled = await provider.chat(messages, {
        ...options,
        signal: controller.signal,
        onTextDelta: (delta: string) => writeFrame(res, 'delta', { text: delta }),
      });
      writeFrame(res, 'message', assembled);
      writeFrame(res, 'done', '[DONE]');
    } catch (err) {
      // The headers are already sent, so the failure has to travel as a frame. It is named `error`
      // rather than folded into `done`, so a client cannot mistake a failed stream for a finished
      // one — which is the shape of every defect this route's history is made of.
      const message = err instanceof Error ? err.message : String(err);
      routeLogger.error('Remote chat stream failed', new Error(message));
      writeFrame(res, 'error', { error: message });
    } finally {
      res.end();
    }
  });
}
