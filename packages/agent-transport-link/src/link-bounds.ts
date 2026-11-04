/**
 * How large each kind of frame may be. A session frame carries one session-protocol message, which
 * the protocol bounds in characters; three bytes per character covers any of them in UTF-8. Owner
 * frames carry short requests and replies. Both ends bound every frame by these before reading it.
 */
import { LINK_FRAME_OVERHEAD_BYTES } from '@robota-sdk/agent-keyring';
import { MAX_INBOUND_FRAME_BYTES } from '@robota-sdk/agent-transport';

const UTF8_BYTES_PER_CHARACTER = 3;

export const SESSION_FRAME_MAX_BYTES = UTF8_BYTES_PER_CHARACTER * MAX_INBOUND_FRAME_BYTES;
export const OWNER_FRAME_MAX_BYTES = 1024 * 1024;
/** The largest sealed frame either end accepts, of any kind. */
export const SEALED_FRAME_MAX_BYTES =
  Math.max(SESSION_FRAME_MAX_BYTES, OWNER_FRAME_MAX_BYTES) + LINK_FRAME_OVERHEAD_BYTES;
