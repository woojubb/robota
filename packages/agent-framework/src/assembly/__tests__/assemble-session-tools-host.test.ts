import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import { describe, expect, it, vi } from 'vitest';

import { assembleSessionTools } from '../assemble-session-tools.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type { ICreateSessionOptions } from '../create-session-types.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';

/**
 * The default tool tier is whatever the host builds. The framework names no tool package, so a host
 * that lends no `createDefaultTools` has no default tier, and `defaultTools` replaces the tier a host
 * does build.
 */
function namedTool(name: string): IToolWithEventService {
  return {
    schema: { name, description: name, parameters: { type: 'object', properties: {} } },
    setEventService: () => {},
    execute: async () => ({ success: true, data: name }),
    validate: () => true,
    validateParameters: () => ({ isValid: true, errors: [], warnings: [] }),
    getDescription: () => name,
    getName: () => name,
  } as unknown as IToolWithEventService;
}

function optionsOver(
  host: ICreateSessionOptions['host'],
  extra: object = {},
): ICreateSessionOptions {
  return { host, ...extra } as unknown as ICreateSessionOptions;
}

const namesOf = (tools: readonly IToolWithEventService[]): string[] =>
  tools.map((tool) => tool.getName());

describe('assembleSessionTools and the host default tier', () => {
  it('has no default tier when the host lends no factory', () => {
    expect(namesOf(assembleSessionTools(optionsOver({}), '/workspace').tools)).toEqual([]);
  });

  it('holds only what the session adds when the host lends no factory', () => {
    const options = optionsOver({}, { additionalTools: [namedTool('Mine')] });
    expect(namesOf(assembleSessionTools(options, '/workspace').tools)).toEqual(['Mine']);
  });

  it('is the tier the host builds, given the session root', () => {
    const createDefaultTools = vi.fn(() => [namedTool('FromHost')]);
    const host = createTestFrameworkHost({ createDefaultTools });
    const tools = assembleSessionTools(optionsOver(host), '/workspace').tools;
    expect(namesOf(tools)).toEqual(['FromHost']);
    expect(createDefaultTools).toHaveBeenCalledExactlyOnceWith({ cwd: '/workspace' });
  });

  it('gives the host the sandbox the session runs under', () => {
    const createDefaultTools = vi.fn(() => []);
    const sandboxClient = new InMemorySandboxClient();
    const host = createTestFrameworkHost({ createDefaultTools });
    assembleSessionTools(optionsOver(host, { sandboxClient }), '/workspace');
    expect(createDefaultTools).toHaveBeenCalledExactlyOnceWith({
      cwd: '/workspace',
      sandboxClient,
    });
  });

  it('puts the host tier ahead of contributed tools and keeps the host tool on a name collision', () => {
    const host = createTestFrameworkHost({ createDefaultTools: () => [namedTool('Read')] });
    const options = optionsOver(host, { additionalTools: [namedTool('Read'), namedTool('Mine')] });
    expect(namesOf(assembleSessionTools(options, '/workspace').tools)).toEqual(['Read', 'Mine']);
  });

  it('asks the host for nothing when the session replaces the tier', () => {
    const createDefaultTools = vi.fn(() => [namedTool('FromHost')]);
    const host = createTestFrameworkHost({ createDefaultTools });
    const options = optionsOver(host, { defaultTools: [namedTool('Replacement')] });
    expect(namesOf(assembleSessionTools(options, '/workspace').tools)).toEqual(['Replacement']);
    expect(createDefaultTools).not.toHaveBeenCalled();
  });
});
