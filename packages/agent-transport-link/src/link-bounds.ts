/**
 * How large each kind of frame may be. A session frame carries one session-protocol message, and its
 * bound is the protocol's own inbound limit counted in UTF-8 bytes, the way the local attach path
 * counts it: a message within it is within the decoder's character limit too, so a sender never
 * emits what the receiving decoder must refuse. Owner frames carry short requests and replies. Both
 * ends bound what they send, and every frame they read before reading it, by these.
 */
import { LINK_FRAME_OVERHEAD_BYTES } from '@robota-sdk/agent-keyring';
import { MAX_INBOUND_FRAME_BYTES } from '@robota-sdk/agent-transport';

import { LENGTH_PREFIX_BYTES } from './link-stream.js';

export const SESSION_FRAME_MAX_BYTES = MAX_INBOUND_FRAME_BYTES;
export const OWNER_FRAME_MAX_BYTES = 1024 * 1024;
/** The largest sealed frame either end accepts, of any kind. */
export const SEALED_FRAME_MAX_BYTES =
  Math.max(SESSION_FRAME_MAX_BYTES, OWNER_FRAME_MAX_BYTES) + LINK_FRAME_OVERHEAD_BYTES;
/** A largest session frame and a largest owner frame may be pending on a client link. */
export const MAX_PENDING_CLIENT_BYTES =
  SEALED_FRAME_MAX_BYTES +
  OWNER_FRAME_MAX_BYTES +
  LINK_FRAME_OVERHEAD_BYTES +
  2 * LENGTH_PREFIX_BYTES;
/**
 * Owner requests and read grants one link may have waiting at once. A client refuses its own request
 * beyond it, so a well-behaved caller never loses its link; the runtime ends a link whose peer sends
 * one more.
 */
export const MAX_REQUESTS_IN_FLIGHT = 64;
