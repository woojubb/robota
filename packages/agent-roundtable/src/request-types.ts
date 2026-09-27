import type { JsonValue } from './json-value';

interface RequestIdentity {
  id: string;
  reason: string;
}

/** A settled runtime request. IDs remain stable across checkpoint restoration. */
export type ParticipantRequest = RequestIdentity &
  (
    | { kind: 'input'; participantId: string }
    | { kind: 'approval' | 'reconciliation'; data: JsonValue }
  );

interface ConversationRequestIdentity extends RequestIdentity {
  participantId: string;
  groupId: string;
  turnId: string;
}

export interface InputRequest extends ConversationRequestIdentity {
  kind: 'input';
  /** Present when input is private to an unfinished member until its group commits. */
  memberId?: string;
}

export interface ActionRequest extends ConversationRequestIdentity {
  kind: 'approval' | 'reconciliation';
  memberId: string;
  /** Runtime-owned target/action details; never interpreted as permission by the scheduler. */
  data: JsonValue;
}

export type ConversationRequest = InputRequest | ActionRequest;

export type RequestResponse =
  | { kind: 'input'; content: string }
  | { kind: 'approval'; approved: boolean }
  | { kind: 'reconciliation'; data: JsonValue };

export interface ResumeRequest {
  requestId: string;
  responseId: string;
  expectedRevision: number;
  response: RequestResponse;
}

export interface ResponseReceipt {
  revision: number;
  requestId: string;
  responseId: string;
}

/** An authenticated host response, still subject to the runtime's current authorization checks. */
export interface ParticipantResponse {
  request: ConversationRequest;
  responseId: string;
  response: RequestResponse;
}
