import { MAX_INBOUND_FRAME_BYTES } from './message-decoders.js';

import type { TOutboundDeliver } from './outbound-delivery.js';
import type { IProtocolSession } from './protocol-session.js';
import type { TClientMessage } from './ws-protocol.js';
import type {
  IPersonalUsageReport,
  IPersonalUsageRequest,
  IUsageBySourceReport,
} from '@robota-sdk/agent-interface-analytics';

type TJsonValue =
  string | number | boolean | null | readonly TJsonValue[] | { readonly [key: string]: TJsonValue };

export interface IUsageQueryReporters {
  readonly personalUsageReporter:
    | ((request: IPersonalUsageRequest) => IPersonalUsageReport | Promise<IPersonalUsageReport>)
    | undefined;
  readonly usageReporter:
    | ((session: IProtocolSession) => IUsageBySourceReport | Promise<IUsageBySourceReport>)
    | undefined;
  readonly storedSessionUsageReporter:
    ((sessionId: string) => IUsageBySourceReport | Promise<IUsageBySourceReport>) | undefined;
}

export type TMalformedUsageRequest =
  | { type: 'personal'; requestId: string }
  | { type: 'stored-session'; requestId: string; sessionId: string };

function isJsonObject(value: TJsonValue): value is { readonly [key: string]: TJsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNonEmptyString(value: TJsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function malformedUsageRequest(data: string): TMalformedUsageRequest | undefined {
  if (new TextEncoder().encode(data).byteLength > MAX_INBOUND_FRAME_BYTES) return undefined;
  try {
    const value = JSON.parse(data) as TJsonValue;
    if (!isJsonObject(value)) return undefined;
    const requestId = optionalNonEmptyString(value['requestId']);
    if (!requestId) return undefined;
    if (value['type'] === 'get-personal-usage-report') return { type: 'personal', requestId };
    const sessionId = optionalNonEmptyString(value['sessionId']);
    return value['type'] === 'get-stored-session-usage-report' && sessionId
      ? { type: 'stored-session', requestId, sessionId }
      : undefined;
  } catch {
    // allow-fallback: malformed JSON has no trustworthy request id to correlate, so the caller emits
    // the protocol's uncorrelated decode error without echoing attacker-controlled content.
    return undefined;
  }
}

export function handleUsageQueryMessage(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: TClientMessage,
  reporters: IUsageQueryReporters,
): boolean {
  if (msg.type === 'get-personal-usage-report') {
    handlePersonalUsageQuery(deliver, msg, reporters.personalUsageReporter);
    return true;
  }
  if (msg.type === 'get-stored-session-usage-report') {
    handleStoredSessionUsageQuery(deliver, msg, reporters.storedSessionUsageReporter);
    return true;
  }
  if (msg.type === 'get-usage-report') {
    handleCurrentUsageQuery(session, deliver, reporters.usageReporter);
    return true;
  }
  return false;
}

function handleCurrentUsageQuery(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  reporter: IUsageQueryReporters['usageReporter'],
): void {
  if (!reporter) {
    deliver({
      type: 'protocol_error',
      message: 'Per-session usage reporting is not available on this host.',
    });
    return;
  }
  try {
    void Promise.resolve(reporter(session)).then(
      (report) => deliver({ type: 'usage_report', report }),
      (error) => deliver({ type: 'protocol_error', message: failureMessage(error) }),
    );
  } catch (error) {
    deliver({
      type: 'protocol_error',
      message: failureMessage(error instanceof Error ? error : String(error)),
    });
  }
}

function handleStoredSessionUsageQuery(
  deliver: TOutboundDeliver,
  msg: Extract<TClientMessage, { type: 'get-stored-session-usage-report' }>,
  reporter: IUsageQueryReporters['storedSessionUsageReporter'],
): void {
  if (!reporter) {
    deliverStoredSessionUsageError(
      deliver,
      msg,
      'not_available',
      'Stored-session usage reporting is not available on this host.',
    );
    return;
  }
  try {
    void Promise.resolve(reporter(msg.sessionId)).then(
      (report) =>
        deliver({
          type: 'stored_session_usage_report',
          requestId: msg.requestId,
          sessionId: msg.sessionId,
          report,
        }),
      (error) =>
        deliverStoredSessionUsageError(deliver, msg, 'report_failed', failureMessage(error)),
    );
  } catch (error) {
    deliverStoredSessionUsageError(
      deliver,
      msg,
      'report_failed',
      failureMessage(error instanceof Error ? error : String(error)),
    );
  }
}

function deliverStoredSessionUsageError(
  deliver: TOutboundDeliver,
  msg: Extract<TClientMessage, { type: 'get-stored-session-usage-report' }>,
  code: 'not_available' | 'report_failed',
  message: string,
): void {
  deliver({
    type: 'stored_session_usage_report_error',
    requestId: msg.requestId,
    sessionId: msg.sessionId,
    code,
    message,
  });
}

function handlePersonalUsageQuery(
  deliver: TOutboundDeliver,
  msg: Extract<TClientMessage, { type: 'get-personal-usage-report' }>,
  reporter: IUsageQueryReporters['personalUsageReporter'],
): void {
  if (!reporter) {
    deliverPersonalUsageError(
      deliver,
      msg.requestId,
      'not_available',
      'Personal usage reporting is not available on this host.',
    );
    return;
  }
  try {
    void Promise.resolve(reporter({ period: msg.period, timezone: msg.timezone })).then(
      (report) => deliver({ type: 'personal_usage_report', requestId: msg.requestId, report }),
      (error) =>
        deliverPersonalUsageError(deliver, msg.requestId, 'report_failed', failureMessage(error)),
    );
  } catch (error) {
    deliverPersonalUsageError(
      deliver,
      msg.requestId,
      'report_failed',
      failureMessage(error instanceof Error ? error : String(error)),
    );
  }
}

function deliverPersonalUsageError(
  deliver: TOutboundDeliver,
  requestId: string,
  code: 'not_available' | 'report_failed',
  message: string,
): void {
  deliver({ type: 'personal_usage_report_error', requestId, code, message });
}

function failureMessage(error: Error | TJsonValue | undefined): string {
  return error instanceof Error ? error.message : String(error);
}
