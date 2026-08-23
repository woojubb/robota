/**
 * Where the hand-off orchestration meets the wire layer (HANDOFF-001, issue #1864).
 *
 * `agent-framework` owns the orchestration and declares what it needs as `IHandoffComposition`.
 * `agent-transport-protocol` owns the manifest, the integrity seal, the chunker and the ownership
 * transaction. The framework deliberately does not depend on the wire package — every consumer of
 * it is a transport package or a composition root, and ARCH-021 is the precedent for keeping an
 * assembly package clear of an edge like this by having the root supply the collaborator instead.
 *
 * This file is that root. It is the ONLY place the two names appear together, which is what makes
 * the boundary checkable by reading one file rather than by trusting a rule.
 */

import type { IHandoffComposition, IHandoffTransactionPort } from '@robota-sdk/agent-framework';
import type { IHandoffManifest } from '@robota-sdk/agent-interface-session-mobility';
import {
  HandoffChunkAssembler,
  advanceHandoff,
  beginHandoff,
  buildHandoffManifest,
  chunkHandoffPayload,
  commitHandoff,
  sourceStillOwns,
  verifyHandoffPayload,
  type IHandoffTransaction,
} from '@robota-sdk/agent-transport-protocol';

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

/** The wire operations the hand-off orchestration composes. */
export function createHandoffComposition(): IHandoffComposition {
  return {
    buildManifest: (request) => buildHandoffManifest(request),
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
