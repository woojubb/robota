import { describe, expect, it } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node/index.js';

/**
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"); what needs a Node host
 * is on `./node`. The platform gate bundles the main entry and fails on a Node reach; this pins
 * which side each export is on, so a move is a visible test failure.
 */
describe('transport entry surfaces', () => {
  const admission = [
    'resolveAdmission',
    'bearerCredential',
    'credentialMatches',
    'mintTransportToken',
  ];

  it.each(admission)('%s is on the main entry and not on ./node', (name) => {
    expect(Object.keys(MainEntry)).toContain(name);
    expect(Object.keys(NodeEntry)).not.toContain(name);
  });

  const nodeOnly = [
    'sealHandoffRecord',
    'verifyHandoffPayload',
    'createAccessTokenVerifier',
    'createBearerResourceServer',
    'receiveFileOverChannel',
    'sendFileOverChannel',
    'attachStdioCarrier',
  ];

  it.each(nodeOnly)('%s is on ./node and not on the main entry', (name) => {
    expect(Object.keys(NodeEntry)).toContain(name);
    expect(Object.keys(MainEntry)).not.toContain(name);
  });

  it('keeps the wire protocol, delivery and chunking on the main entry', () => {
    for (const name of [
      'createSessionMessageHandler',
      'createOutboundDelivery',
      'decodeClientMessage',
      'decodeFrame',
      'ResumeBuffer',
      'SessionResumeBridge',
      'createPeerMessageLedger',
      'chunkHandoffPayload',
      'HandoffChunkAssembler',
    ]) {
      expect(Object.keys(MainEntry)).toContain(name);
    }
  });
});
