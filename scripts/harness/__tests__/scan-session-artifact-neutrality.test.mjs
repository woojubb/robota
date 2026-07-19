import { describe, expect, it } from 'vitest';

import { findForbiddenTokens } from '../scan-session-artifact-neutrality.mjs';

/**
 * SELFHOST-014 TC-05 — the session-artifact neutrality floor: no sharing/cloud/access/field-policy in the envelope.
 */

describe('findForbiddenTokens', () => {
  it('flags sharing/cloud/access tokens in code', () => {
    expect(findForbiddenTokens('const url = "https://share.example/x";')).toContain('https://');
    expect(findForbiddenTokens('await fetch(endpoint);').length).toBeGreaterThan(0);
    expect(findForbiddenTokens('const accessControl = load();')).toContain('accessControl');
    expect(findForbiddenTokens('const shareLink = make();')).toContain('shareLink');
  });

  it('is clean for a pure serialize/deserialize module', () => {
    const pure = `
      export function serializeSessionArtifact(record, options) {
        const payload = options.redact ? options.redact(record) : record;
        return JSON.stringify({ schemaVersion: 1, record: payload });
      }
    `;
    expect(findForbiddenTokens(pure)).toEqual([]);
  });

  it('exempts comments — a doc that NAMES the forbidden words (no cloud/upload/access) stays clean', () => {
    const withDoc = `
      /** This module carries no link, no cloud/upload, and no access-control policy. */
      // not a permissions module
      export const SESSION_ARTIFACT_SCHEMA_VERSION = 1;
    `;
    expect(findForbiddenTokens(withDoc)).toEqual([]);
  });
});
