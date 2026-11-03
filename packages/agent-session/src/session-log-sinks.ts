import { sha256Hex, utf8ByteLength } from '@robota-sdk/agent-core';

import { assertSafeSessionId } from './session-id.js';

import type { IExternalPayloadReference } from './session-log-reference-types.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function assertContentAddress(sha256: string, serialized: string): void {
  const actualSha256 = sha256Hex(serialized);
  if (!SHA256_PATTERN.test(sha256) || sha256 !== actualSha256) {
    throw new Error('Invalid sha256: external JSON payloads require their exact content digest.');
  }
}

/** Canonical validation and construction for every session-log external-payload reference. */
export function createSessionLogExternalPayloadReference(
  sessionId: string,
  sha256: string,
  serialized: string,
): IExternalPayloadReference {
  assertSafeSessionId(sessionId);
  assertContentAddress(sha256, serialized);
  return {
    kind: 'external-payload',
    encoding: 'json',
    sha256,
    byteLength: utf8ByteLength(serialized),
    // Always `/`: the reference is read back on any platform, and every reader accepts either slash.
    relativePath: `${sessionId}.payloads/${sha256}.json`,
  };
}

/** Workspace-neutral sink for content-addressed external JSON payloads. */
export interface IExternalPayloadSink {
  writeJson(sessionId: string, sha256: string, serialized: string): IExternalPayloadReference;
}

/** Workspace-neutral append sink for session-log bytes. */
export interface ISessionLogSink {
  append(sessionId: string, text: string): void;
  readonly externalPayloadSink?: IExternalPayloadSink;
}
