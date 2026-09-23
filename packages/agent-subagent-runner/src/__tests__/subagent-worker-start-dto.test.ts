import { describe, expect, it } from 'vitest';

import { projectStartPayload } from '../child-process-subagent-projection.js';
import {
  AGENT_DEFINITION_DTO_FIELDS,
  PARENT_CONTEXT_DTO_FIELDS,
  decodeAgentDefinitionDto,
  decodeParentContextDto,
  encodeAgentDefinition,
  encodeParentContext,
  restoreAgentDefinition,
  restoreParentContext,
} from '../subagent-worker-start-dto.js';

import type { ISubagentJobStart } from '@robota-sdk/agent-executor';
import type { IAgentDefinition, IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';

type ILoadedContext = IInProcessSubagentRunnerDeps['context'];

/**
 * ARCH-044 (issue #2047): the start payload's agent definition and parent context are JSON-safe DTOs
 * owned by the process boundary. Every variant round-trips encode → JSON → decode → restore, arrays
 * are rejected where records are required, and a malformed nested value fails with a reason.
 */
const ipc = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

const FULL_DEFINITION: IAgentDefinition = {
  name: 'tester',
  description: 'Runs tests.',
  systemPrompt: 'Run tasks.',
  model: 'sonnet',
  role: 'qa',
  maxTurns: 5,
  tools: ['Read'],
  disallowedTools: ['Bash'],
  effort: 'high',
};
const MINIMAL_DEFINITION: IAgentDefinition = { name: 'a', description: 'b', systemPrompt: 'c' };

const FULL_CONTEXT: ILoadedContext = {
  agentsMd: '# agents',
  projectNotesMd: '# notes',
  memoryMd: 'mem',
  taskContext: 'task',
  compactInstructions: 'compact',
  agentsFileEntries: [{ filePath: 'AGENTS.md', content: 'x', contentHash: 'h' }],
  projectNotesFileEntries: [],
};
const MINIMAL_CONTEXT: ILoadedContext = { agentsMd: '', projectNotesMd: '' };

describe('subagent worker start DTOs (ARCH-044, issue #2047)', () => {
  it.each([FULL_DEFINITION, MINIMAL_DEFINITION])(
    'agent definition round-trips %#',
    (definition) => {
      const decoded = decodeAgentDefinitionDto(ipc(encodeAgentDefinition(definition)));
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(restoreAgentDefinition(decoded.value)).toEqual(definition);
    },
  );

  it.each([FULL_CONTEXT, MINIMAL_CONTEXT])('parent context round-trips %#', (context) => {
    const decoded = decodeParentContextDto(ipc(encodeParentContext(context)));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(restoreParentContext(decoded.value)).toEqual(context);
  });

  it('the encoder projects ONLY declared fields — a live collaborator on the source never crosses', () => {
    const leaky = { ...FULL_DEFINITION, provider: { call: () => 1 }, extra: 'x' };
    expect(Object.keys(encodeAgentDefinition(leaky))).toEqual(
      Object.keys(AGENT_DEFINITION_DTO_FIELDS),
    );
    const leakyContext = { ...FULL_CONTEXT, loader: () => 1 };
    expect(Object.keys(encodeParentContext(leakyContext))).toEqual(
      Object.keys(PARENT_CONTEXT_DTO_FIELDS),
    );
  });

  it.each<[string, unknown]>([
    ['an array where the record is required', [FULL_DEFINITION]],
    ['null', null],
    ['a missing description', { name: 'a', systemPrompt: 'c' }],
    ['a numeric name', { ...MINIMAL_DEFINITION, name: 1 }],
    ['a string maxTurns', { ...MINIMAL_DEFINITION, maxTurns: '5' }],
    ['a NaN maxTurns', { ...MINIMAL_DEFINITION, maxTurns: Number.NaN }],
    ['an invalid effort', { ...MINIMAL_DEFINITION, effort: 'turbo' }],
    ['tools with a non-string', { ...MINIMAL_DEFINITION, tools: ['Read', 2] }],
    ['tools as an object', { ...MINIMAL_DEFINITION, tools: { Read: true } }],
  ])('agent definition decode rejects %s with a typed reason', (_label, value) => {
    const result = decodeAgentDefinitionDto(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^agentDefinition/);
  });

  it.each<[string, unknown]>([
    ['an array where the record is required', [MINIMAL_CONTEXT]],
    ['a missing projectNotesMd', { agentsMd: '' }],
    ['a numeric agentsMd', { agentsMd: 1, projectNotesMd: '' }],
    [
      'a file entry missing contentHash',
      { ...MINIMAL_CONTEXT, agentsFileEntries: [{ filePath: 'a', content: 'b' }] },
    ],
    ['file entries as a record', { ...MINIMAL_CONTEXT, agentsFileEntries: { filePath: 'a' } }],
    ['a nested array in file entries', { ...MINIMAL_CONTEXT, projectNotesFileEntries: [['a']] }],
  ])('parent context decode rejects %s with a typed reason', (_label, value) => {
    const result = decodeParentContextDto(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^parentContext/);
  });

  it('field-coverage guard: every DTO key is in its field table (compile-time via Record<keyof Dto>)', () => {
    // The tables are `Record<keyof Dto, rule>`; a DTO field missing from a table is a compile error.
    // This runtime mirror asserts the tables drive the encoder, so no field crosses uncovered.
    expect(Object.keys(encodeAgentDefinition(FULL_DEFINITION)).sort()).toEqual(
      Object.keys(AGENT_DEFINITION_DTO_FIELDS).sort(),
    );
    expect(Object.keys(encodeParentContext(FULL_CONTEXT)).sort()).toEqual(
      Object.keys(PARENT_CONTEXT_DTO_FIELDS).sort(),
    );
  });
});

describe('child-process effort projection (BEHAVIOR-009)', () => {
  const DEPS: IInProcessSubagentRunnerDeps = {
    config: {
      defaultTrustLevel: 'moderate',
      currentProvider: 'openai',
      provider: { name: 'openai', model: 'test-model', apiKey: 'k' },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: '', projectNotesMd: '' },
    tools: [],
    terminal: {
      write: () => {},
      writeLine: () => {},
      writeMarkdown: () => {},
      writeError: () => {},
      prompt: () => Promise.resolve(''),
      select: () => Promise.resolve(0),
      spinner: () => ({ stop: () => {}, update: () => {} }),
    },
    provider: {} as IInProcessSubagentRunnerDeps['provider'],
    customAgentRegistry: () => ({
      ...MINIMAL_DEFINITION,
      effort: 'medium',
    }),
  };

  it('request effort overrides the definition effort before encoding', async () => {
    const payload = await projectStartPayload(
      {
        taskId: 'agent_1',
        request: {
          agentType: 'a',
          label: 'effort',
          mode: 'background',
          parentSessionId: 'parent',
          depth: 1,
          cwd: '/workspace',
          prompt: 'Continue.',
          permissionPolicy: 'inherit-allowlist',
          effort: 'high',
        },
      },
      DEPS,
      {},
    );

    expect(payload.agentDefinition.effort).toBe('high');
  });
});

/**
 * CLI-1994 TC-06 — a FORK job's start payload is the plain job's payload plus one string.
 *
 * The whole ARCH-044 argument for Alternative 1 (spec § Decision) is that a forked conversation
 * never crosses the child-process wire: the parent writes the copy to the session store and sends
 * the child an id, which the child resolves on its own side. That is a property of the payload
 * PRODUCER, so it is measured here against `projectStartPayload` — the one function that builds it —
 * as a key-set difference: exactly `resumeSessionId` is added, nowhere does a message array appear,
 * and no text of the copied conversation reaches the wire.
 */
describe('a fork job adds ONE key to the start payload (CLI-1994 TC-06, ARCH-044)', () => {
  const FORK_SESSION_ID = 'session_cli-1994-fork';
  /** Text that exists ONLY in the forked record; finding it on the wire is the failure. */
  const COPIED_CONVERSATION_TEXT = 'Remember the number 42.';

  const DEPS: IInProcessSubagentRunnerDeps = {
    config: {
      defaultTrustLevel: 'moderate',
      currentProvider: 'openai',
      provider: {
        name: 'openai',
        model: 'test-model',
        apiKey: 'k',
        baseURL: 'http://localhost/v1',
      },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    // The parent's loaded context, file entries included — #2317 narrows it, and a fork must not
    // widen it back: the entries carry the full text of every AGENTS.md and CLAUDE.md.
    context: {
      agentsMd: '# agents',
      projectNotesMd: '# claude',
      agentsFileEntries: [
        { filePath: 'AGENTS.md', content: 'THE PARENT AGENTS.MD BODY', contentHash: 'h1' },
      ],
      projectNotesFileEntries: [
        { filePath: 'CLAUDE.md', content: 'THE PARENT CLAUDE.MD BODY', contentHash: 'h2' },
      ],
    },
    tools: [],
    terminal: {
      write: () => {},
      writeLine: () => {},
      writeMarkdown: () => {},
      writeError: () => {},
      prompt: () => Promise.resolve(''),
      select: () => Promise.resolve(0),
      spinner: () => ({ stop: () => {}, update: () => {} }),
    },
    // Never called: this suite projects a payload, it does not run a job. The deps type requires it.
    provider: {
      name: 'unused-in-projection',
      chat: () =>
        Promise.resolve({ role: 'assistant' as const, content: '', timestamp: new Date() }),
    } as unknown as IInProcessSubagentRunnerDeps['provider'],
    customAgentRegistry: () => MINIMAL_DEFINITION,
  };

  function job(resumeSessionId: string | undefined): ISubagentJobStart {
    return {
      taskId: 'agent_1',
      request: {
        agentType: 'a',
        label: 'fork',
        mode: 'background',
        parentSessionId: 'session_parent',
        depth: 1,
        cwd: '/workspace',
        prompt: 'Continue.',
        permissionPolicy: 'inherit-allowlist',
        ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
      },
    };
  }

  /** Every array reachable in the payload, so "carries a message array" is checkable, not assumed. */
  function everyArray(value: unknown, found: unknown[][] = []): unknown[][] {
    if (Array.isArray(value)) {
      found.push(value);
      for (const item of value) everyArray(item, found);
    } else if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) everyArray(item, found);
    }
    return found;
  }

  it('the fork payload key set equals the plain one, and its request adds exactly resumeSessionId', async () => {
    const plain = await projectStartPayload(job(undefined), DEPS, {});
    const fork = await projectStartPayload(job(FORK_SESSION_ID), DEPS, {});

    // Nothing new rides beside the request: no seed history, no transcript, no record.
    expect(Object.keys(fork).sort()).toEqual(Object.keys(plain).sort());
    // …and on the request, the ONE added key is the id.
    const added = Object.keys(fork.request).filter((key) => !(key in plain.request));
    expect(added).toEqual(['resumeSessionId']);
    expect(fork.request.resumeSessionId).toBe(FORK_SESSION_ID);
    // The parent context is what #2317 narrowed it to, fork or not.
    expect(Object.keys(fork.parentContext).sort()).toEqual(Object.keys(plain.parentContext).sort());
  });

  it('no message array and no copied-conversation or AGENTS.md/CLAUDE.md text crosses the wire', async () => {
    const fork = await projectStartPayload(job(FORK_SESSION_ID), DEPS, {});

    // The wire form is what the child actually receives — structured-clone-equivalent.
    const wire = JSON.stringify(fork);
    expect(wire).toContain(FORK_SESSION_ID);
    expect(wire).not.toContain(COPIED_CONVERSATION_TEXT);
    expect(wire).not.toContain('THE PARENT AGENTS.MD BODY');
    expect(wire).not.toContain('THE PARENT CLAUDE.MD BODY');

    // A conversation is an array of role-bearing objects; the payload has none, at any depth.
    const messageArrays = everyArray(fork).filter((array) =>
      array.some((item) => item !== null && typeof item === 'object' && 'role' in item),
    );
    expect(messageArrays).toEqual([]);
  });
});
