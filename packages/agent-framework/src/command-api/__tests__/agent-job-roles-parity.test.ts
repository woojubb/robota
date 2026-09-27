import { describe, expectTypeOf, it } from 'vitest';

import type { IAgentJobDispatch } from '../agent-job-roles.js';
import type { ISessionAgentJobs } from '@robota-sdk/agent-interface-session';

/**
 * #3282 §4: `InteractiveSession` implements both `IAgentJobHostContext` (command-layer,
 * `IAgentJobDispatch` here) and the transport-layer `ISessionAgentJobs` — two independently
 * declared role interfaces the same class satisfies. Neither `implements` clause alone catches a
 * signature drift between them (a wider actual return type still satisfies a narrower declared
 * one), so the agent-switcher trio is pinned here: this file stops compiling the moment either
 * side's signature moves without the other.
 */
describe('IAgentJobDispatch / ISessionAgentJobs parity (#3282 §4)', () => {
  it('the agent-switcher trio is identical across both role surfaces', () => {
    expectTypeOf<IAgentJobDispatch['listAgentDefinitions']>().toEqualTypeOf<
      ISessionAgentJobs['listAgentDefinitions']
    >();
    expectTypeOf<IAgentJobDispatch['getDefaultAgentType']>().toEqualTypeOf<
      ISessionAgentJobs['getDefaultAgentType']
    >();
    expectTypeOf<IAgentJobDispatch['setDefaultAgentType']>().toEqualTypeOf<
      ISessionAgentJobs['setDefaultAgentType']
    >();
  });
});
