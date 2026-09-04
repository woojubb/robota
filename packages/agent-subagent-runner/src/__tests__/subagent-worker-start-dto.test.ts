import { describe, expect, it } from 'vitest';

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
