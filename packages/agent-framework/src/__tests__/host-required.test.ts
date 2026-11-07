import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { createSession } from '../assembly/create-session.js';
import { createSubagentSession } from '../assembly/create-subagent-session.js';
import { createInteractiveRuntime } from '../interaction/createInteractiveRuntime.js';
import { InteractiveSession } from '../interactive/interactive-session.js';
import { createQuery } from '../query.js';
import { createAgentRuntime } from '../runtime/session-runtime.js';
import { createStatelessRuntime } from '../runtime/stateless-runtime.js';
import { buildRuntimeSession } from '../runtime/runtime-host.js';
import { createInProcessSubagentRunner } from '../subagents/in-process-subagent-runner.js';
import { createTestFrameworkHost } from '../testing/framework-host.js';
import { HeadlessInteractionChannel } from '../transport-host/headless/HeadlessInteractionChannel.js';
import { createProgrammaticAgent } from '../transport-host/programmatic/createProgrammaticAgent.js';

import type { ICreateSessionOptions } from '../assembly/create-session-types.js';
import type { ISubagentOptions } from '../assembly/create-subagent-session.js';
import type { IInteractiveRuntimeOptions } from '../interaction/createInteractiveRuntime.js';
import type { ICreateQueryOptions } from '../query.js';
import type { IAgentRuntimeConfig } from '../runtime/session-runtime.js';
import type { IStatelessRuntimeConfig } from '../runtime/stateless-runtime.js';
import type { TInteractiveSessionOptions } from '../interactive/interactive-session-options.js';
import type { IInProcessSubagentRunnerDeps } from '../subagents/in-process-subagent-runner.js';
import type { IHeadlessInteractionChannelOptions } from '../transport-host/headless/HeadlessInteractionChannel.js';
import type { ICreateProgrammaticAgentOptions } from '../transport-host/programmatic/createProgrammaticAgent.js';

/**
 * The framework has no platform default: a caller that composes a session, a runtime or a query
 * says what the platform lends. A JavaScript caller is not type-checked, so the missing `host` is
 * refused at construction, and the refusal says what to pass.
 */
const provider = createScriptedProvider([]).provider;
const cwd = process.cwd();
const REFUSAL = /requires `host`[\s\S]*createNodeFrameworkHost[\s\S]*pass `\{\}`/u;

describe('a missing host is refused where the framework is composed', () => {
  it('InteractiveSession names itself and what to pass', () => {
    const options = { cwd, provider } as unknown as TInteractiveSessionOptions;
    expect(() => new InteractiveSession(options)).toThrow(/^InteractiveSession requires `host`/u);
    expect(() => new InteractiveSession(options)).toThrow(REFUSAL);
  });

  it('buildRuntimeSession refuses it through the session it builds', () => {
    const options = { cwd, provider } as unknown as TInteractiveSessionOptions;
    expect(() => buildRuntimeSession(options)).toThrow(/^InteractiveSession requires `host`/u);
  });

  it('createSession rejects before it assembles anything', async () => {
    const options = { cwd, provider } as unknown as ICreateSessionOptions;
    await expect(createSession(options)).rejects.toThrow(/^createSession requires `host`/u);
  });

  it('createSubagentSession throws', () => {
    const options = { cwd, provider } as unknown as ISubagentOptions;
    expect(() => createSubagentSession(options)).toThrow(/^createSubagentSession requires `host`/u);
  });

  it('createQuery throws', () => {
    const options = { cwd, provider } as unknown as ICreateQueryOptions;
    expect(() => createQuery(options)).toThrow(/^createQuery requires `host`/u);
  });

  it('createAgentRuntime throws', () => {
    const config = { cwd, provider } as unknown as IAgentRuntimeConfig;
    expect(() => createAgentRuntime(config)).toThrow(/^createAgentRuntime requires `host`/u);
  });

  it('createStatelessRuntime names itself, not the runtime it wraps', () => {
    const config = { cwd, provider } as unknown as IStatelessRuntimeConfig;
    expect(() => createStatelessRuntime(config)).toThrow(
      /^createStatelessRuntime requires `host`/u,
    );
  });

  it('createInteractiveRuntime throws when it is called, not when its session starts', () => {
    const options = { cwd, provider, commandModules: [] } as unknown as IInteractiveRuntimeOptions;
    expect(() => createInteractiveRuntime(options)).toThrow(
      /^createInteractiveRuntime requires `host`/u,
    );
  });

  it('createProgrammaticAgent names itself, not the runtime it wraps', () => {
    const options = { cwd, provider } as unknown as ICreateProgrammaticAgentOptions;
    expect(() => createProgrammaticAgent(options)).toThrow(
      /^createProgrammaticAgent requires `host`/u,
    );
  });

  it('HeadlessInteractionChannel throws at construction, not when it runs', () => {
    const options = {
      cwd,
      provider,
      outputFormat: 'text',
      shellExec: async () => '',
    } as unknown as IHeadlessInteractionChannelOptions;
    expect(() => new HeadlessInteractionChannel(options)).toThrow(
      /^HeadlessInteractionChannel requires `host`/u,
    );
  });

  it('createInProcessSubagentRunner throws when it is built, not when a job starts', () => {
    const deps = { cwd, provider } as unknown as IInProcessSubagentRunnerDeps;
    expect(() => createInProcessSubagentRunner(deps)).toThrow(
      /^createInProcessSubagentRunner requires `host`/u,
    );
  });

  it('refuses a host that is not an object', () => {
    const config = { cwd, provider, host: 'node' } as unknown as IAgentRuntimeConfig;
    expect(() => createAgentRuntime(config)).toThrow(REFUSAL);
  });
});

describe('a host that lends nothing is a valid host', () => {
  it('an empty host composes a runtime and a Node host composes one too', () => {
    expect(createAgentRuntime({ host: {}, cwd, provider }).cwd).toBe(cwd);
    expect(createAgentRuntime({ host: createTestFrameworkHost(), cwd, provider }).cwd).toBe(cwd);
    expect(createStatelessRuntime({ host: {}, cwd, provider }).cwd).toBe(cwd);
  });
});
