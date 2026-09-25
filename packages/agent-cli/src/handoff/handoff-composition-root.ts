/**
 * Where handoff orchestration meets domain authority and wire codecs (HANDOFF-001, issue #1864).
 *
 * Session mobility owns handoff orchestration, offers, and authority transactions. `agent-transport`
 * seals and verifies payload bytes and owns chunking; `agent-session` decodes the restored record.
 * The root supplies those collaborators without adding transport or codec dependencies to mobility.
 *
 * This file is that root. It is the ONLY place the two names appear together, which is what makes
 * the boundary checkable by reading one file rather than by trusting a rule.
 */

import type { IHandoffComposition } from '@robota-sdk/agent-interface-session-mobility';
import { decodeInteractiveSessionRecord } from '@robota-sdk/agent-session';
import { HandoffChunkAssembler, chunkHandoffPayload } from '@robota-sdk/agent-transport';
import { sealHandoffRecord, verifyHandoffPayload } from '@robota-sdk/agent-transport/node';

/** Supply wire effects and the session decoder to mobility-owned handoff orchestration. */
export function createHandoffComposition(): IHandoffComposition {
  return {
    sealRecord: sealHandoffRecord,
    chunk: (handoffId, serialized) => chunkHandoffPayload(handoffId, serialized),
    verifyPayload: (serialized, integrity) => verifyHandoffPayload(serialized, integrity),
    // One assembler per transfer, as the wire package requires: a shared one would have to key
    // everything by transfer and would then be a place two transfers can be confused for each other.
    createAssembler: (handoffId) => {
      const assembler = new HandoffChunkAssembler(handoffId);
      return { accept: (chunk) => assembler.accept(chunk) };
    },
    decodeRecord: decodeInteractiveSessionRecord,
  };
}
