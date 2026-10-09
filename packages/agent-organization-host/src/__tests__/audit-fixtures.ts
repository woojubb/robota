import { sign } from 'node:crypto';
import {
  OrganizationAuditAppendConflict,
  organizationAuditGenesis,
  organizationAuditHash,
  organizationAuditSigningBytes,
} from '../audit.js';
import type {
  IOrganizationAuditHead,
  IOrganizationAuditEntry,
  IOrganizationAuditAnchor,
  IOrganizationAuditSink,
} from '../audit.js';
import type { IOrganizationEnvelope } from '../types.js';
import { keys } from './fixtures.js';

export function auditFixture(stream = 'company-audit') {
  const signer = keys();
  function signed(claims: IOrganizationAuditHead): IOrganizationEnvelope<IOrganizationAuditHead> {
    return {
      claims,
      signature: sign(null, organizationAuditSigningBytes(claims), signer.privateKey).toString(
        'base64url',
      ),
    };
  }
  const genesis = signed(organizationAuditGenesis(stream));
  const entries: IOrganizationAuditEntry[] = [];
  let stored = genesis;
  let anchored = genesis;
  let anchorAvailable = true;
  let loseAcknowledgement = false;
  const equal = (a: IOrganizationAuditHead, b: IOrganizationAuditHead) =>
    a.stream === b.stream && a.sequence === b.sequence && a.hash === b.hash;
  const sink: IOrganizationAuditSink = {
    async read(after) {
      return { entries: entries.filter((item) => item.sequence > after.sequence), head: stored };
    },
    async append(expected, event) {
      if (!equal(expected, stored.claims)) throw new OrganizationAuditAppendConflict();
      const sequence = expected.sequence + 1;
      const entry = {
        stream,
        sequence,
        previous: expected.hash,
        event,
        hash: organizationAuditHash(stream, sequence, expected.hash, event),
      };
      entries.push(entry);
      stored = signed({ version: 1, stream, sequence, hash: entry.hash });
      return { entry, head: stored };
    },
  };
  const anchor: IOrganizationAuditAnchor = {
    async load() {
      return anchored;
    },
    async compareAndSet(expected, next) {
      if (!anchorAvailable || !equal(expected, anchored.claims)) return false;
      anchored = next;
      if (loseAcknowledgement) throw new Error('acknowledgement lost');
      return true;
    },
  };
  return {
    stream,
    signer,
    genesis,
    signed,
    entries,
    sink,
    anchor,
    get stored() {
      return stored;
    },
    get anchored() {
      return anchored;
    },
    setStored(value: IOrganizationEnvelope<IOrganizationAuditHead>) {
      stored = value;
    },
    setAnchorAvailable(value: boolean) {
      anchorAvailable = value;
    },
    setLoseAcknowledgement(value: boolean) {
      loseAcknowledgement = value;
    },
  };
}
