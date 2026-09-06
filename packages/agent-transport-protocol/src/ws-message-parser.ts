import { decodeClientMessage, decodeFrame } from './message-decoders.js';
import { malformedUsageRequest } from './ws-usage-messages.js';

import type { TOutboundDeliver } from './outbound-delivery.js';
import type { TClientMessage } from './ws-protocol.js';

/** Decode a client frame and preserve validated usage-request correlation on malformed payloads. */
export function parseClientMessage(data: string, deliver: TOutboundDeliver): TClientMessage | null {
  const decoded = decodeFrame(data, decodeClientMessage);
  if (decoded.ok) return decoded.message;
  const malformedUsage = malformedUsageRequest(data);
  if (malformedUsage?.type === 'personal') {
    deliver({
      type: 'personal_usage_report_error',
      requestId: malformedUsage.requestId,
      code: 'report_failed',
      message: 'Invalid personal usage report request.',
    });
    return null;
  }
  if (malformedUsage?.type === 'stored-session') {
    deliver({
      type: 'stored_session_usage_report_error',
      requestId: malformedUsage.requestId,
      sessionId: malformedUsage.sessionId,
      code: 'report_failed',
      message: 'Invalid stored-session usage report request.',
    });
    return null;
  }
  deliver({ type: 'protocol_error', message: decoded.reason });
  return null;
}
