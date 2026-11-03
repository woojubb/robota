import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createUserSessionStore } from '@robota-sdk/agent-framework';

import { RESUME_HELD_MAX_CHARACTERS } from '../child-process-subagent-ipc.js';
import {
  preflightStartPayloadSealing,
  projectStartPayload,
  projectStartPayloadSealing,
} from '../child-process-subagent-projection.js';
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

/** The parent's registry: the runner refuses a provider it has no definition for. */
const TEST_PROVIDER_DEFINITIONS: readonly IProviderDefinition[] = [
  { type: 'openai', destinationEnvironment: [], createProvider: () => ({}) as never },
];

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
      { providerDefinitions: TEST_PROVIDER_DEFINITIONS },
    );

    expect(payload.agentDefinition.effort).toBe('high');
  });
});

describe('child-process permission mode projection', () => {
  it('carries the mode the parent is in when the subagent starts', async () => {
    const payload = await projectStartPayload(
      {
        taskId: 'agent_1',
        request: {
          agentType: 'a',
          label: 'mode',
          mode: 'background',
          parentSessionId: 'parent',
          depth: 1,
          cwd: '/workspace',
          prompt: 'Continue.',
          permissionPolicy: 'inherit-allowlist',
        },
      },
      {
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
        customAgentRegistry: () => MINIMAL_DEFINITION,
        permissionMode: 'default',
        getParentPermissionMode: () => 'plan',
      },
      { providerDefinitions: TEST_PROVIDER_DEFINITIONS },
    );

    expect(payload.permissionMode).toBe('plan');
  });
});

/**
 * CLI-1994 TC-06 / #3679 — what a FORK job puts on the wire.
 *
 * Plain mode keeps the ARCH-044 argument for Alternative 1 (spec § Decision): the parent writes the
 * copy to the session store and sends the child an id, which the child resolves on its own side, so
 * a plain fork payload is the plain job's payload plus one string on the request. A sealing parent
 * cannot keep to that — a subagent never holds the keys that open a sealed record — so the record it
 * holds crosses, but only as the top-level `resumeHeld` token, beside a write grant that carries no
 * secret, and within a bound. That is a property of the payload PRODUCER, so it is measured here
 * against `projectStartPayloadSealing` and `projectStartPayload`, the functions that build it; the
 * runner adds the grant its sealer issues when it sends the payload, as these cases do.
 */
describe('what a fork job puts on the wire (CLI-1994 TC-06, ARCH-044, #3679)', () => {
  const FORK_SESSION_ID = 'session_cli-1994-fork';
  /** Text that exists ONLY in the forked record; finding it outside `resumeHeld` is the failure. */
  const COPIED_CONVERSATION_TEXT = 'Remember the number 42.';
  /** The resolved credential: config loading turns the reference into the value itself. */
  const PROVIDER_SECRET = 'sk-tc06-provider-secret';

  const DEPS: IInProcessSubagentRunnerDeps = {
    config: {
      defaultTrustLevel: 'moderate',
      currentProvider: 'openai',
      provider: {
        name: 'openai',
        model: 'test-model',
        apiKey: PROVIDER_SECRET,
        apiKeyEnv: 'TC06_PROVIDER_KEY',
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

  /** The canary as it appears in plain text and in base64url at each of the three alignments. */
  function canaryForms(text: string): string[] {
    return [0, 1, 2]
      .map((shift) =>
        Buffer.from(`${'x'.repeat(shift)}${text}`)
          .toString('base64url')
          .slice(4, -4),
      )
      .concat(text);
  }

  /** A locked, sealing parent whose `/fork` just wrote the copy holding the canary. */
  function sealedParent() {
    const sealer = createTestArtifactSealer({ locked: true });
    const store = createUserSessionStore(
      join(realpathSync(mkdtempSync(join(tmpdir(), 'tc06-sealed-'))), 'sessions'),
      { sealing: { sealer } },
    );
    store.save(
      {
        id: FORK_SESSION_ID,
        cwd: '/workspace',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        messages: [
          {
            id: 'm-1',
            role: 'user',
            content: COPIED_CONVERSATION_TEXT,
            timestamp: new Date('2026-08-01T00:00:00.000Z'),
            state: 'complete',
          },
        ],
      },
      { handoff: true },
    );
    return { sealer, store, deps: { ...DEPS, resumeSessionStore: store } };
  }

  it('the plain fork payload key set equals the plain one, and its request adds exactly resumeSessionId', async () => {
    const plain = await projectStartPayload(job(undefined), DEPS, {
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
    });
    const fork = await projectStartPayload(job(FORK_SESSION_ID), DEPS, {
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
      ...projectStartPayloadSealing(job(FORK_SESSION_ID), DEPS, 'plain').payload,
    });

    // Nothing new rides beside the request: no seed history, no transcript, no record, no grant.
    expect(Object.keys(fork).sort()).toEqual(Object.keys(plain).sort());
    // …and on the request, the ONE added key is the id.
    const added = Object.keys(fork.request).filter((key) => !(key in plain.request));
    expect(added).toEqual(['resumeSessionId']);
    expect(fork.request.resumeSessionId).toBe(FORK_SESSION_ID);
    // The parent context is what #2317 narrowed it to, fork or not.
    expect(Object.keys(fork.parentContext).sort()).toEqual(Object.keys(plain.parentContext).sort());
  });

  it('tells the worker to keep its credential only when the owner opted it in (#3429)', async () => {
    const plain = await projectStartPayload(job(undefined), DEPS, {
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
    });
    const kept = await projectStartPayload(job(undefined), DEPS, {
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
      keepProviderCredential: true,
    });
    expect('keepProviderCredential' in plain).toBe(false);
    expect(kept.keepProviderCredential).toBe(true);
  });

  it('no message array and no copied-conversation or AGENTS.md/CLAUDE.md text crosses a plain wire', async () => {
    const fork = await projectStartPayload(job(FORK_SESSION_ID), DEPS, {
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
    });

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

  it('sealed: the record crosses only as top-level resumeHeld, beside the grant, and nothing else is added', async () => {
    const { sealer, deps } = sealedParent();
    const plain = await projectStartPayload(job(undefined), DEPS, {
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
    });
    const fork = await projectStartPayload(job(FORK_SESSION_ID), deps, {
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
      ...projectStartPayloadSealing(job(FORK_SESSION_ID), deps, { sealer }).payload,
      writeGrant: sealer.writeGrant(),
    });

    expect(
      Object.keys(fork)
        .filter((key) => !(key in plain))
        .sort(),
    ).toEqual(['resumeHeld', 'writeGrant']);
    expect(Object.keys(fork.request).filter((key) => !(key in plain.request))).toEqual([
      'resumeSessionId',
    ]);
    const held = fork.resumeHeld as string;
    expect(Buffer.from(held.split('.')[3] as string, 'base64url').toString('utf8')).toContain(
      COPIED_CONVERSATION_TEXT,
    );
    const rest = JSON.stringify({ ...fork, resumeHeld: undefined });
    for (const form of canaryForms(COPIED_CONVERSATION_TEXT)) expect(rest).not.toContain(form);
    expect(held.length).toBeLessThanOrEqual(RESUME_HELD_MAX_CHARACTERS);
  });

  it('sealed: no credential and no private key material crosses, and the grant is the sealer’s own', async () => {
    const { sealer, deps } = sealedParent();
    const payload = await projectStartPayload(job(FORK_SESSION_ID), deps, {
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
      ...projectStartPayloadSealing(job(FORK_SESSION_ID), deps, { sealer }).payload,
      writeGrant: sealer.writeGrant(),
    });

    expect(payload.writeGrant).toBe(sealer.writeGrant());
    // The double's grant is a handle into this process — it names a key and never holds one.
    expect(payload.writeGrant).toMatch(/^robota-test-grant\/v1:[0-9a-f-]+$/);
    expect(payload.providerProfile.apiKeyEnv).toBe('TC06_PROVIDER_KEY');
    expect(JSON.stringify(payload)).not.toContain(PROVIDER_SECRET);
  });

  it('sealed: a job that resumes nothing hands over no record, and its grant is read when start is sent', () => {
    const { sealer, deps } = sealedParent();

    expect(projectStartPayloadSealing(job(undefined), deps, { sealer })).toEqual({ payload: {} });
  });

  it('sealed: a held record past its bound fails before anything is spawned, naming the limit', () => {
    const { sealer } = sealedParent();
    const store = {
      load: () => ({ status: 'missing' }),
      exportHeld: () => 'r'.repeat(RESUME_HELD_MAX_CHARACTERS + 1),
    };

    expect(() =>
      projectStartPayloadSealing(
        job(FORK_SESSION_ID),
        { ...DEPS, resumeSessionStore: store as never },
        { sealer },
      ),
    ).toThrow(/too large to hand to a subagent \(the limit is 32 MiB\)/);
  });

  it('sealed: a fork with nothing to hand over while locked fails, telling to /fork again after unlocking', () => {
    const { sealer, deps } = sealedParent();
    projectStartPayloadSealing(job(FORK_SESSION_ID), deps, { sealer });

    expect(() => projectStartPayloadSealing(job(FORK_SESSION_ID), deps, { sealer })).toThrow(
      `Session ${FORK_SESSION_ID} is sealed and could not be handed to its subagent: the keys are ` +
        'locked and this session no longer holds the record. Unlock, then run /fork again.',
    );
  });

  it('sealed: the check before anything is made for a fork job takes nothing and returns nothing', () => {
    const { sealer, deps } = sealedParent();

    for (let check = 0; check < 2; check += 1) {
      expect(preflightStartPayloadSealing(job(FORK_SESSION_ID), deps, { sealer })).toBeUndefined();
    }
    expect(
      projectStartPayloadSealing(job(FORK_SESSION_ID), deps, { sealer }).payload.resumeHeld,
    ).toMatch(/^rsh2\./);
    expect(() => preflightStartPayloadSealing(job(FORK_SESSION_ID), deps, { sealer })).toThrow(
      /Unlock, then run \/fork again\./,
    );
  });

  it('sealed: a sealer that cannot hand its sealing to another process refuses the job', () => {
    const { sealer, deps } = sealedParent();
    const noGrant = { ...sealer, writeGrant: undefined };

    expect(() => projectStartPayloadSealing(job(undefined), deps, { sealer: noGrant })).toThrow(
      /cannot hand its sealing to a subagent/,
    );
  });
});
