import { describe, expect, it } from 'vitest';

import { createTestAgentJobHost } from '../agent-job-host-double.js';
import { createTestCommandHost, createTestSessionRuntime } from '../command-host-double.js';

/**
 * ARCH-029: an override may replace a member, never remove one.
 *
 * Review raised this twice. First as a possibility, then — after a `NonNullable` mapped type was
 * added and its docblock claimed the hole was closed — as a false guarantee, measured: `NonNullable`
 * strips `undefined` from the value type, but `?` re-admits it unless `exactOptionalPropertyTypes`
 * is on, and this repo does not set it. So the enforcement is at merge time, and these cases are
 * what make that claim checkable rather than asserted.
 *
 * Every call below is written WITHOUT a cast, and that is load-bearing. An earlier revision reached
 * for `as never`, which review measured as unnecessary — and it would have been worse than noise:
 * a cast makes these cases pass whether or not the hole is reachable in ordinary typed code, so it
 * would hide the very property the docblock asserts.
 */
describe('a double ignores an override whose value is undefined', () => {
  it('keeps the host member an explicit undefined would have removed', () => {
    const host = createTestCommandHost({ overrides: { setPlan: undefined } });

    expect(host.setPlan).toBeTypeOf('function');
  });

  it('keeps the session-runtime member', () => {
    const runtime = createTestSessionRuntime({ getModelId: undefined });

    expect(runtime.getModelId).toBeTypeOf('function');
  });

  it('keeps the agent-job member', () => {
    const jobs = createTestAgentJobHost({ listSchedules: undefined });

    expect(jobs.listSchedules).toBeTypeOf('function');
  });

  it('still applies an override that supplies a real value', () => {
    const host = createTestCommandHost({ overrides: { getCwd: () => '/elsewhere' } });

    expect(host.getCwd()).toBe('/elsewhere');
  });
});
