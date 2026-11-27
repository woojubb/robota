import { errorMessage, RoundtableError } from './errors';
import { canonicalJson } from './json';
import { increments } from './policies';
import { isThenable } from './usage-validation';
import type { ContextAssembly, ContextPolicy, ParticipantTurn, SharedMessage } from './types';

/** A summary stands in for consumed messages, so it is bounded rather than a second transcript. */
export const maxSummaryLength = 32_768;

function invalid(message: string): never {
  throw new RoundtableError('invalid-context', message);
}

function sameContent(a: unknown, b: unknown): boolean {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
}

/** Reject a policy that cannot be saved, loaded again, or kept free of model calls. */
export function requireContextPolicy(policy: ContextPolicy): void {
  const { reference } = policy;
  if (
    typeof reference?.id !== 'string' ||
    !reference.id ||
    typeof reference.version !== 'string' ||
    !reference.version
  )
    throw new RoundtableError(
      'invalid-config',
      'A context policy requires a versioned reference to be saved with the conversation',
    );
  if (typeof policy.assemble !== 'function')
    throw new RoundtableError('invalid-config', 'A context policy requires an assemble function');
  if (policy.modelCalls !== undefined && policy.modelCalls !== 'none')
    throw new RoundtableError(
      'invalid-config',
      'A context policy must make no model calls: only modelCalls "none" is admitted',
    );
  // Loading resolves this id to the built-in policy, so a different policy cannot use it.
  if (reference.id === increments().reference.id && policy !== increments())
    throw new RoundtableError(
      'invalid-config',
      `The context policy id is reserved for the built-in policy: ${reference.id}`,
    );
}

/**
 * Offer a participant its view of the transcript. The policy sees a copy and its result is checked
 * against the original, so no result can add, alter or repeat a message before it becomes a stored
 * turn context; the cursor later records exactly the messages and ids stored here.
 */
export function assembleContext(
  policy: ContextPolicy,
  input: {
    participantId: string;
    transcript: readonly SharedMessage[];
    delivered: readonly string[];
    baseRevision: number;
    purpose?: string;
  },
): ParticipantTurn['context'] {
  const undelivered = input.transcript.filter(
    (message) =>
      message.participantId !== input.participantId && !input.delivered.includes(message.id),
  );
  const byId = new Map(undelivered.map((message) => [message.id, message]));
  let assembly: ContextAssembly;
  try {
    assembly = policy.assemble({
      recipient: { kind: 'participant', id: input.participantId },
      undelivered: structuredClone(undelivered),
      ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    });
  } catch (error) {
    return invalid(`Context policy failed for ${input.participantId}: ${errorMessage(error)}`);
  }
  if (isThenable(assembly)) {
    // The result is abandoned, so its rejection must not escape later as an unhandled one.
    void Promise.resolve(assembly).catch(() => {});
    invalid(`Context policy must return its result synchronously: ${input.participantId}`);
  }
  if (assembly === null || typeof assembly !== 'object')
    invalid(`Context policy returned no result for ${input.participantId}`);
  const { messages, summary, consumed } = assembly;
  if (!Array.isArray(messages) || !Array.isArray(consumed))
    invalid(`Context policy result needs messages and consumed lists for ${input.participantId}`);
  const offered = new Set<string>();
  const context: ParticipantTurn['context'] = {
    baseRevision: input.baseRevision,
    messages: messages.map((message: SharedMessage) => {
      const original = byId.get(message?.id);
      if (!original || !sameContent(message, original))
        invalid(`Context policy offered a message that is not undelivered: ${message?.id}`);
      if (offered.has(original.id))
        invalid(`Context policy offered a message twice: ${original.id}`);
      offered.add(original.id);
      return original;
    }),
  };
  if (summary !== undefined) {
    if (typeof summary !== 'string' || !summary || summary.length > maxSummaryLength)
      invalid(`Context summary must be non-empty text of at most ${maxSummaryLength} characters`);
    context.summary = summary;
  }
  const ids = new Set<string>();
  for (const id of consumed) {
    if (typeof id !== 'string' || !byId.has(id))
      invalid(`Context policy consumed a message that is not undelivered: ${String(id)}`);
    if (offered.has(id) || ids.has(id))
      invalid(`Context policy consumed a message it already accounted for: ${id}`);
    ids.add(id);
  }
  if (ids.size) context.consumed = [...ids];
  return context;
}
