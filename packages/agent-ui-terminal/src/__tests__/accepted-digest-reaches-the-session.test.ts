/**
 * The digest of the record bytes a person accepted as theirs reaches the session that resumes them.
 * The render projection copies field by field, and a spread skips the excess-property check, so a
 * field dropped on the way compiles and silently makes the resumed session refuse its own record.
 * Without a digest nothing changes: no key is added anywhere along the way.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInProcessChannelFactory, toChannelOptions } from '../render.js';
import { buildTuiSessionOptions } from '../tui-session-options.js';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';

import type { IChannelServices, IRenderOptions } from '../render.js';

const testHost = createTestFrameworkHost();

const constructed = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('../TuiInteractionChannel.js', () => ({
  TuiInteractionChannel: class {
    constructor(options: Record<string, unknown>) {
      constructed.push(options);
    }
  },
}));

const DIGEST = 'ab'.repeat(32);

const options = { host: testHost, cwd: '/work', provider: {} as never } as unknown as IRenderOptions;
const services = { terminalHandoff: {}, attention: {} } as unknown as IChannelServices;

describe('toChannelOptions', () => {
  it('carries the accepted digest into the channel and the session options', () => {
    const channel = toChannelOptions(options, 'session-b', DIGEST);

    expect(channel.acceptedDigest).toBe(DIGEST);
    expect(buildTuiSessionOptions(channel)).toMatchObject({
      resumeSessionId: 'session-b',
      acceptedDigest: DIGEST,
    });
  });

  it('adds no acceptedDigest key without one, so the session options are exactly what they were', () => {
    for (const channel of [
      toChannelOptions(options),
      toChannelOptions(options, 'session-b'),
      toChannelOptions(options, 'session-b', undefined),
    ]) {
      expect('acceptedDigest' in channel).toBe(false);
      expect('acceptedDigest' in buildTuiSessionOptions(channel)).toBe(false);
    }
  });
});

describe('the in-process channel factory', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('builds the channel for a picked record with the digest the person accepted for it', () => {
    createInProcessChannelFactory(options, services)('session-b', DIGEST);

    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ resumeSessionId: 'session-b', acceptedDigest: DIGEST });
  });

  it('builds a channel with no acceptedDigest key when none was accepted', () => {
    const createChannel = createInProcessChannelFactory(options, services);
    createChannel('session-b');
    createChannel();

    expect(constructed).toHaveLength(2);
    for (const channelOptions of constructed)
      expect('acceptedDigest' in channelOptions).toBe(false);
  });
});
