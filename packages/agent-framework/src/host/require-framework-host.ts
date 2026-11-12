import type { IFrameworkHost } from './framework-host.js';

/**
 * The host a session, runtime or query runs on. REQUIRED, with no platform default.
 *
 * The framework is platform-neutral, so it cannot reach for the files, git or environment of the
 * process it happens to run in; whoever composes it says what the platform lends. A JavaScript
 * consumer is not type-checked, so without a runtime check an omitted `host` would be `undefined`
 * and every capability would read as absent without anyone having decided so. Silence is not
 * success: refuse instead, and say what to pass.
 */
export function requireFrameworkHost(host: unknown, owner: string): IFrameworkHost {
  if (typeof host !== 'object' || host === null || Array.isArray(host)) {
    throw new Error(
      `${owner} requires \`host\`: the platform capabilities it may use (files, git, the ` +
        'environment, processes). On Node pass `createNodeFrameworkHost({ createDefaultTools })` ' +
        'from `@robota-sdk/agent-framework/node`, with `createDefaultTools` from ' +
        '`@robota-sdk/agent-tools/defaults`; pass `{}` for a host that lends nothing.',
    );
  }
  return host as IFrameworkHost;
}
