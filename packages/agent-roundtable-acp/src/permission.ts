import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';

/** What an approver answers: let the tool call proceed this once, or refuse it. */
export type AcpPermissionDecision = 'allow' | 'reject';

/**
 * What the agent asks permission for, as a host sees it. Every value under `toolCall` is whatever
 * the agent sent and is untrusted data: a title or input can claim anything.
 */
export interface AcpPermissionRequest {
  readonly conversationId: string;
  readonly participantId: string;
  readonly toolCall: {
    readonly id: string;
    readonly title?: string;
    readonly kind?: string;
    readonly rawInput?: unknown;
    readonly locations?: readonly { readonly path: string; readonly line?: number }[];
  };
}

/**
 * The host's decision point for an agent's permission requests. `signal` aborts when the turn is
 * aborted, the session ends or the connection dies; an answer that arrives after that is ignored.
 * A throw, a rejection or any answer other than the two strings counts as `reject`.
 */
export interface AcpPermissionApprover {
  decide(
    request: AcpPermissionRequest,
    options: { signal: AbortSignal },
  ): AcpPermissionDecision | Promise<AcpPermissionDecision>;
}

export const cancelledPermission: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };

/**
 * The answer that refuses: the one-time reject option when the agent offers one, and a cancelled
 * outcome otherwise. Never an option that allows, and never one that remembers a decision, so the
 * agent never gains authority from this adapter by default.
 */
export function rejectPermission(request: RequestPermissionRequest): RequestPermissionResponse {
  const reject = request.options.find((option) => option.kind === 'reject_once');
  return reject
    ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

/**
 * The answer that lets the call proceed once: the one-time allow option, never one that remembers
 * the decision. An agent that offers no one-time allow option gets a refusal, because the host
 * approved a single call and nothing but "always" would be on offer.
 */
function allowPermission(request: RequestPermissionRequest): RequestPermissionResponse {
  const allow = request.options.find((option) => option.kind === 'allow_once');
  return allow
    ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
    : rejectPermission(request);
}

function toApproverRequest(
  context: { conversationId: string; participantId: string },
  request: RequestPermissionRequest,
): AcpPermissionRequest {
  const call = request.toolCall;
  return {
    conversationId: context.conversationId,
    participantId: context.participantId,
    toolCall: {
      id: call.toolCallId,
      ...(typeof call.title === 'string' ? { title: call.title } : {}),
      ...(typeof call.kind === 'string' ? { kind: call.kind } : {}),
      ...(call.rawInput !== undefined ? { rawInput: call.rawInput } : {}),
      ...(Array.isArray(call.locations)
        ? {
            locations: call.locations.map((location) => ({
              path: location.path,
              ...(typeof location.line === 'number' ? { line: location.line } : {}),
            })),
          }
        : {}),
    },
  };
}

/** Answers one turn's permission requests and knows which of them are still waiting on the host. */
export interface PermissionTracker {
  answer(request: RequestPermissionRequest): Promise<RequestPermissionResponse>;
  /** Aborts the signal every `decide` call got and answers every request still waiting, and every later one, as cancelled. */
  end(): void;
}

export function createPermissionTracker(
  approver: AcpPermissionApprover | undefined,
  context: { conversationId: string; participantId: string },
): PermissionTracker {
  const controller = new AbortController();
  const pending = new Set<() => void>();
  return {
    answer(request) {
      if (controller.signal.aborted) return Promise.resolve(cancelledPermission);
      if (approver === undefined) return Promise.resolve(rejectPermission(request));
      return new Promise<RequestPermissionResponse>((resolve) => {
        let settled = false;
        const finish = (response: RequestPermissionResponse): void => {
          if (settled) return;
          settled = true;
          pending.delete(cancel);
          resolve(response);
        };
        const cancel = (): void => finish(cancelledPermission);
        pending.add(cancel);
        let decision: AcpPermissionDecision | Promise<AcpPermissionDecision>;
        try {
          decision = approver.decide(toApproverRequest(context, request), {
            signal: controller.signal,
          });
        } catch {
          finish(rejectPermission(request));
          return;
        }
        Promise.resolve(decision).then(
          (answer) =>
            finish(answer === 'allow' ? allowPermission(request) : rejectPermission(request)),
          () => finish(rejectPermission(request)),
        );
      });
    },
    end() {
      controller.abort();
      for (const cancel of [...pending]) cancel();
    },
  };
}
