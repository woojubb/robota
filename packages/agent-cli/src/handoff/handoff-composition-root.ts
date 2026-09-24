/**
 * Where handoff orchestration meets domain authority and wire codecs (HANDOFF-001, issue #1864).
 *
 * `agent-framework` owns the orchestration and declares what it needs as `IHandoffComposition`.
 * Session mobility owns the offer and authority transaction; `agent-transport` seals and verifies
 * payload bytes and owns chunking. The framework does not depend on the wire package — every consumer of it
 * is a transport package or a composition root. The root supplies that collaborator here.
 *
 * This file is that root. It is the ONLY place the two names appear together, which is what makes
 * the boundary checkable by reading one file rather than by trusting a rule.
 */

import type { IHandoffComposition, IHandoffTransactionPort } from '@robota-sdk/agent-framework';
import {
  advanceHandoff,
  beginHandoff,
  commitHandoff,
  sourceStillOwns,
  assessHandoffReadiness,
  prepareHandoffOffer,
  type IHandoffTransaction,
  type IHandoffManifest,
} from '@robota-sdk/agent-interface-session-mobility';
import { HandoffChunkAssembler, chunkHandoffPayload } from '@robota-sdk/agent-transport';
import { sealHandoffRecord, verifyHandoffPayload } from '@robota-sdk/agent-transport/node';

/**
 * Wrap one transaction so the orchestration holds a thing with an identity rather than five loose
 * functions it could accidentally apply to the wrong transfer.
 */
function transactionPort(transaction: IHandoffTransaction): IHandoffTransactionPort {
  return {
    get state() {
      return transaction;
    },
    advance: (next, detail) => advanceHandoff(transaction, next, detail),
    commit: (ack) => commitHandoff(transaction, ack),
    sourceStillOwns: () => sourceStillOwns(transaction),
  };
}

/** Compose mobility decisions and wire effects for handoff orchestration. */
export function createHandoffComposition(): IHandoffComposition {
  return {
    buildManifest: (request) => {
      const readiness = assessHandoffReadiness(request.runtime);
      if (!readiness.ready) {
        return { built: false, refusal: readiness.refusal, detail: readiness.detail };
      }
      const { serialized, integrity } = sealHandoffRecord(request.record);
      const offer = prepareHandoffOffer({ ...request, integrity });
      return offer.built ? { built: true, manifest: offer.manifest, serialized } : offer;
    },
    beginTransaction: (manifest: IHandoffManifest) => transactionPort(beginHandoff(manifest)),
    chunk: (handoffId, serialized) => chunkHandoffPayload(handoffId, serialized),
    verifyPayload: (serialized, integrity) => verifyHandoffPayload(serialized, integrity),
    // One assembler per transfer, as the wire package requires: a shared one would have to key
    // everything by transfer and would then be a place two transfers can be confused for each other.
    createAssembler: (handoffId) => {
      const assembler = new HandoffChunkAssembler(handoffId);
      return { accept: (chunk) => assembler.accept(chunk) };
    },
  };
}
