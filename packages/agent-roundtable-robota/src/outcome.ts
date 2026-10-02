import type { ParticipantOutcome } from '@robota-sdk/agent-roundtable';

/**
 * Map a Session/ConversationAgent run's final text to a `ParticipantOutcome`. Text that is empty or
 * whitespace-only, after trimming, yields — the shared transcript never gains a blank turn.
 *
 * In practice the underlying execution pipeline already retries rather than settle on
 * whitespace-only text (it discards a blank round and forces a summary call), so this mostly
 * guards a host-supplied journal/provider combination that bypasses that pipeline.
 */
export function toCompletionOutcome(text: string): ParticipantOutcome {
  const trimmed = text.trim();
  return trimmed.length === 0 ? { kind: 'yield' } : { kind: 'speak', content: trimmed };
}
