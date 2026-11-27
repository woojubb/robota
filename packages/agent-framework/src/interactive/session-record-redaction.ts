/**
 * Replacing text in a conversation that is saved or live, keeping its shape.
 *
 * A redaction changes only the text a person or a tool wrote. Every message, id, timestamp,
 * tool-call pairing, binary part and tool schema stays exactly as it was, so the record still
 * resumes and the next provider request is well formed.
 *
 * It lives beside the rename path and follows it: the stored record is read the way every writer
 * reads it, a record this process cannot read or another writer holds is reported and left as it
 * is, and a save keeps the provenance of what was read.
 */

import {
  decodeInteractiveSessionRecord,
  isSessionClaimedError,
  loadSessionForUpdate,
} from '@robota-sdk/agent-session';

import { provenanceOfOutcome } from './session-authorship-gate.js';

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface/session';

/** Maps one piece of text to its replacement; returns the same text when nothing in it matches. */
export type TTextRedactor = (value: string) => string;

/** What {@link persistSessionRedaction} did, or why it wrote nothing. */
export type TSessionRedactionStatus =
  | 'redacted'
  | 'unchanged'
  | 'missing'
  /** Another writer holds the record. */
  | 'held'
  /** The record is corrupt, written by a build this one does not read, or sealed beyond this process. */
  | 'unreadable'
  /** The record carries an execution a journal would replay, so its text would come back. */
  | 'pending-execution';

/** Keys whose strings identify, locate or classify rather than say something. */
const KEPT_KEY =
  /^(id|type|role|state|category|name|timestamp|metadata|mimeType|blob)$|(Id|Ids|At)$/;
/** Keys that hold a location; kept everywhere, tool arguments included. */
const LOCATION_KEY = /(uri|url|path|paths|cwd)$/i;
const BINARY_PART = new Set(['image_inline', 'audio_inline']);

interface ITally {
  changed: boolean;
}

function redactText(value: string, redact: TTextRedactor, tally: ITally): string {
  const next = redact(value);
  if (next !== value) tally.changed = true;
  return next;
}

/** Redacts the string values inside one tool call's JSON arguments; raw text when they do not parse. */
function redactArguments(raw: string, redact: TTextRedactor, tally: ITally): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // allow-fallback: arguments that are not JSON are still text the person may want gone.
    return redactText(raw, redact, tally);
  }
  const inner: ITally = { changed: false };
  const next = walk(parsed, undefined, redact, inner, true);
  if (!inner.changed) return raw;
  tally.changed = true;
  return JSON.stringify(next);
}

function walk(
  value: unknown,
  key: string | undefined,
  redact: TTextRedactor,
  tally: ITally,
  inArguments: boolean,
): unknown {
  if (typeof value === 'string') {
    if (key === undefined) return redactText(value, redact, tally);
    if (LOCATION_KEY.test(key)) return value;
    if (!inArguments && key === 'arguments') return redactArguments(value, redact, tally);
    if (!inArguments && KEPT_KEY.test(key)) return value;
    return redactText(value, redact, tally);
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, key, redact, tally, inArguments));
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  const source = value as Record<string, unknown>;
  const binary = typeof source['type'] === 'string' && BINARY_PART.has(source['type']);
  const next: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(source)) {
    next[name] = binary && name === 'data' ? child : walk(child, name, redact, tally, inArguments);
  }
  return next;
}

/**
 * Redacts the text in messages or display history entries, returning new values and whether any
 * text changed. The input is not modified.
 */
export function redactSessionContent<T>(
  value: T,
  redact: TTextRedactor,
): { readonly value: T; readonly changed: boolean } {
  const tally: ITally = { changed: false };
  const next = walk(value, undefined, redact, tally, false) as T;
  return { value: next, changed: tally.changed };
}

/**
 * The record with `redact` applied to its messages, tool-call arguments, tool results, display
 * history, name and system prompt; `undefined` when nothing in it changed, so nothing is saved.
 * A manifest describes the prompt it composed, so it is dropped when the prompt changed.
 */
export function redactSessionRecord(
  record: IInteractiveSessionRecord,
  redact: TTextRedactor,
): IInteractiveSessionRecord | undefined {
  const messages = redactSessionContent(record.messages, redact);
  const history = record.history ? redactSessionContent(record.history, redact) : undefined;
  const nameTally: ITally = { changed: false };
  const name = record.name === undefined ? undefined : redactText(record.name, redact, nameTally);
  const promptTally: ITally = { changed: false };
  const systemPrompt =
    record.systemPrompt === undefined
      ? undefined
      : redactText(record.systemPrompt, redact, promptTally);
  if (!messages.changed && !history?.changed && !nameTally.changed && !promptTally.changed) {
    return undefined;
  }
  const { systemPromptManifest, ...rest } = record;
  return {
    ...rest,
    messages: messages.value,
    ...(history ? { history: history.value } : {}),
    ...(name === undefined ? {} : { name }),
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
    ...(systemPromptManifest !== undefined && !promptTally.changed ? { systemPromptManifest } : {}),
  };
}

/**
 * Redacts the stored record of session `id`. Nothing is written for a record that is missing,
 * unchanged, held by another writer, unreadable here, or waiting on a pending execution; otherwise
 * the redacted record replaces it through the store's atomic owner-only save, with the provenance
 * of what was read and the time it was last updated.
 */
export async function persistSessionRedaction(
  sessionStore: IInteractiveSessionStore,
  sessionId: string,
  redact: TTextRedactor,
): Promise<{ status: TSessionRedactionStatus }> {
  try {
    const outcome = loadSessionForUpdate(sessionStore, sessionId);
    if (outcome.status === 'missing') return { status: 'missing' };
    if (outcome.status !== 'valid') return { status: 'unreadable' };
    // A journal would replay the parked round, and with it the text this removes.
    if (outcome.record.pendingExecution !== undefined) return { status: 'pending-execution' };
    const redacted = redactSessionRecord(outcome.record, redact);
    if (redacted === undefined) return { status: 'unchanged' };
    if (decodeInteractiveSessionRecord(redacted).status !== 'valid') {
      throw new Error(`redacting session ${sessionId} would leave a record that cannot be read`);
    }
    const provenance = provenanceOfOutcome(outcome);
    if (provenance === undefined) sessionStore.save(redacted);
    else sessionStore.save(redacted, { provenance });
    return { status: 'redacted' };
  } catch (error) {
    // allow-fallback: a writer this process does not run refuses the read or the write itself.
    if (isSessionClaimedError(error)) return { status: 'held' };
    throw error;
  }
}
