import { createDefaultTools } from '@robota-sdk/agent-tools/defaults';

import { createNodeFrameworkHost } from '../node.js';

import type { IFrameworkHost } from '../host/framework-host.js';

/**
 * The host a test passes as `host`: the Node host with the real default tools, so a session built
 * from it behaves as a CLI session does. An override replaces its member outright, and an explicit
 * `undefined` removes the member, which is how a test runs against a host that lacks it.
 */
export function createTestFrameworkHost(overrides: Partial<IFrameworkHost> = {}): IFrameworkHost {
  return { ...createNodeFrameworkHost({ createDefaultTools }), ...overrides };
}
