/**
 * `GET /prompts` and `POST /prompts/:id` — reading and answering the permission and ask prompts a
 * prompt-receiving `/submit` stream forwarded.
 *
 * Split from `routes.ts` for the same reason `/submit` is: these routes carry a decision of their own
 * (is this id open here, and is this answer the right kind for it), not just a mount.
 */

import { decodeClientMessage } from '@robota-sdk/agent-transport';

import type { IHttpOpenPrompts } from './open-prompts.js';
import type { TSessionFactory } from './submit-route.js';
import type { TTurnAttribution } from './submit-stream.js';
import type { ITurnClaims } from './turn-claims.js';
import type { Context } from 'hono';

export interface IPromptRouteDeps {
  readonly sessionFactory: TSessionFactory;
  readonly claims: ITurnClaims;
  readonly openPrompts: IHttpOpenPrompts;
  readonly attribution?: TTurnAttribution;
}

/** The open prompts of the request's session, oldest first: what a client that came later reads. */
export function listPromptsHandler(deps: IPromptRouteDeps) {
  return async (c: Context) => {
    const session = await deps.sessionFactory(c);
    const key = deps.claims.keyFor(session);
    return c.json({ prompts: key === undefined ? [] : deps.openPrompts.list(key) });
  };
}

/**
 * Answer one open prompt by id.
 *
 * The id must be one this session's prompt-receiving stream forwarded and that is still open. An id
 * that never was and one already settled get the same 404: the client cannot act differently on the
 * two, and the registry forgets a prompt once it settles.
 *
 * The answerer is the HOST's `attribution.driverId`, never the request, for the same reason `/submit`
 * attribution is: a client must not record its answer as another surface's.
 *
 * Nothing awaits between the lookup and the resolve. The session settles synchronously and emits
 * `prompt_resolved`, which the stream forwards and the registry forgets, so a second answer for the
 * same id finds nothing open and is refused rather than reported as accepted.
 */
export function answerPromptHandler(deps: IPromptRouteDeps) {
  const { sessionFactory, claims, openPrompts, attribution } = deps;
  return async (c: Context) => {
    const session = await sessionFactory(c);
    const id = c.req.param('id') ?? '';
    let body: { result?: unknown; response?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'the body must be a JSON object' }, 400);
    }

    const key = claims.keyFor(session);
    const frame = key === undefined ? undefined : openPrompts.find(key, id);
    if (frame === undefined) {
      return c.json({ error: 'no open prompt with this id' }, 404);
    }

    if (frame.type === 'permission_request') {
      const decoded = decodeClientMessage({
        type: 'permission-response',
        id,
        result: body?.result,
      });
      if (!decoded.ok || decoded.message.type !== 'permission-response') {
        return c.json(
          { error: 'result must be true, false, "allow-session" or "allow-project"' },
          400,
        );
      }
      session.resolvePermission(id, decoded.message.result, attribution?.driverId);
    } else {
      const decoded = decodeClientMessage({ type: 'ask-response', id, response: body?.response });
      if (!decoded.ok || decoded.message.type !== 'ask-response') {
        return c.json(
          {
            error:
              'response must be { "type": "answer", "values": string[], "text"?: string } or ' +
              '{ "type": "cancelled" }',
          },
          400,
        );
      }
      session.resolveAsk(id, decoded.message.response, attribution?.driverId);
    }
    return c.json({ ok: true });
  };
}
