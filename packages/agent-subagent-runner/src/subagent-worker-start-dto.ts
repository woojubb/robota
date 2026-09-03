/**
 * ARCH-044 (issue #2047): the JSON-safe DTOs the child-process start payload carries for the agent
 * definition and the parent's loaded context — OWNED by this process boundary, not indexed out of
 * the in-process runtime types.
 *
 * `IAgentDefinition` and `ILoadedContext` are runtime models; reusing them as the wire shape coupled
 * process-protocol evolution to in-process model evolution and defined no IPC semantics for what a
 * field may hold. Here every field is declared, every field is projected by the encoder and decoded
 * by the decoder, and the serialization mode is plain JSON: strings, finite numbers, string arrays and
 * arrays of flat records. No `Date`, no `undefined` on the wire (an absent optional is simply absent),
 * no tagged representation because nothing here needs one.
 *
 * Field-coverage guard: `AGENT_DEFINITION_DTO_FIELDS` and `PARENT_CONTEXT_DTO_FIELDS` are typed as
 * `Record<keyof Dto, …>`, so adding a DTO field without naming it there — and therefore without the
 * encoder/decoder that the tables drive — is a compile error, not a silent gap.
 */

import type {
  IAgentDefinition,
  IInProcessSubagentRunnerDeps,
  ISubagentParentContext,
} from '@robota-sdk/agent-framework';

/**
 * The parent's loaded-context RUNTIME model (`ILoadedContext`, which the framework barrel does not
 * export). Named here for the encoder/restore signatures only — the wire DTO below never references it.
 */
type TParentContextModel = IInProcessSubagentRunnerDeps['context'];

export interface ISubagentWorkerAgentDefinitionDto {
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly model?: string;
  readonly role?: string;
  readonly maxTurns?: number;
  readonly tools?: readonly string[];
  readonly disallowedTools?: readonly string[];
}

export interface ISubagentWorkerContextFileEntryDto {
  readonly filePath: string;
  readonly content: string;
  readonly contentHash: string;
}

export interface ISubagentWorkerParentContextDto {
  readonly agentsMd: string;
  readonly projectNotesMd: string;
  readonly memoryMd?: string;
  readonly taskContext?: string;
  readonly compactInstructions?: string;
  readonly agentsFileEntries?: readonly ISubagentWorkerContextFileEntryDto[];
  readonly projectNotesFileEntries?: readonly ISubagentWorkerContextFileEntryDto[];
}

type TScalarKind = 'string' | 'number' | 'string[]' | 'file-entry[]';
interface IFieldRule {
  readonly kind: TScalarKind;
  readonly required: boolean;
}

export const AGENT_DEFINITION_DTO_FIELDS: Record<
  keyof ISubagentWorkerAgentDefinitionDto,
  IFieldRule
> = {
  name: { kind: 'string', required: true },
  description: { kind: 'string', required: true },
  systemPrompt: { kind: 'string', required: true },
  model: { kind: 'string', required: false },
  role: { kind: 'string', required: false },
  maxTurns: { kind: 'number', required: false },
  tools: { kind: 'string[]', required: false },
  disallowedTools: { kind: 'string[]', required: false },
};

export const PARENT_CONTEXT_DTO_FIELDS: Record<keyof ISubagentWorkerParentContextDto, IFieldRule> =
  {
    agentsMd: { kind: 'string', required: true },
    projectNotesMd: { kind: 'string', required: true },
    memoryMd: { kind: 'string', required: false },
    taskContext: { kind: 'string', required: false },
    compactInstructions: { kind: 'string', required: false },
    agentsFileEntries: { kind: 'file-entry[]', required: false },
    projectNotesFileEntries: { kind: 'file-entry[]', required: false },
  };

export type TDtoDecodeResult<TDto> =
  { readonly ok: true; readonly value: TDto } | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFileEntry(value: unknown): value is ISubagentWorkerContextFileEntryDto {
  return (
    isRecord(value) &&
    typeof value['filePath'] === 'string' &&
    typeof value['content'] === 'string' &&
    typeof value['contentHash'] === 'string'
  );
}

function valueMatches(kind: TScalarKind, value: unknown): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string[]':
      return isStringArray(value);
    case 'file-entry[]':
      return Array.isArray(value) && value.every(isFileEntry);
  }
}

/** Project exactly the declared fields (undefined optionals dropped), driven by the field table. */
function project<TDto extends object>(
  source: Record<string, unknown>,
  fields: Record<keyof TDto, IFieldRule>,
): TDto {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields)) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  return out as TDto;
}

/** Decode exactly the declared fields; arrays where a record is required, and stray types, fail. */
function decode<TDto extends object>(
  label: string,
  value: unknown,
  fields: Record<keyof TDto, IFieldRule>,
): TDtoDecodeResult<TDto> {
  if (!isRecord(value)) return { ok: false, reason: `${label}: expected an object` };
  for (const [key, rule] of Object.entries(fields) as [string, IFieldRule][]) {
    const field = value[key];
    if (field === undefined) {
      if (rule.required) return { ok: false, reason: `${label}.${key}: required` };
      continue;
    }
    if (!valueMatches(rule.kind, field)) {
      return { ok: false, reason: `${label}.${key}: expected ${rule.kind}` };
    }
  }
  return { ok: true, value: project<TDto>(value, fields) };
}

export function encodeAgentDefinition(
  definition: IAgentDefinition,
): ISubagentWorkerAgentDefinitionDto {
  return project<ISubagentWorkerAgentDefinitionDto>(
    definition as unknown as Record<string, unknown>,
    AGENT_DEFINITION_DTO_FIELDS,
  );
}

export function decodeAgentDefinitionDto(
  value: unknown,
): TDtoDecodeResult<ISubagentWorkerAgentDefinitionDto> {
  return decode<ISubagentWorkerAgentDefinitionDto>(
    'agentDefinition',
    value,
    AGENT_DEFINITION_DTO_FIELDS,
  );
}

/** Explicit restore in the worker: the DTO's fields are the runtime model's, copied, not aliased. */
export function restoreAgentDefinition(dto: ISubagentWorkerAgentDefinitionDto): IAgentDefinition {
  const definition: IAgentDefinition = {
    name: dto.name,
    description: dto.description,
    systemPrompt: dto.systemPrompt,
  };
  if (dto.model !== undefined) definition.model = dto.model;
  if (dto.role !== undefined) definition.role = dto.role;
  if (dto.maxTurns !== undefined) definition.maxTurns = dto.maxTurns;
  if (dto.tools !== undefined) definition.tools = [...dto.tools];
  if (dto.disallowedTools !== undefined) definition.disallowedTools = [...dto.disallowedTools];
  return definition;
}

/** Accepts the issue #2317 projection (or anything wider, structurally); only declared fields cross. */
export function encodeParentContext(
  context: ISubagentParentContext,
): ISubagentWorkerParentContextDto {
  return project<ISubagentWorkerParentContextDto>(
    context as unknown as Record<string, unknown>,
    PARENT_CONTEXT_DTO_FIELDS,
  );
}

export function decodeParentContextDto(
  value: unknown,
): TDtoDecodeResult<ISubagentWorkerParentContextDto> {
  return decode<ISubagentWorkerParentContextDto>('parentContext', value, PARENT_CONTEXT_DTO_FIELDS);
}

export function restoreParentContext(dto: ISubagentWorkerParentContextDto): TParentContextModel {
  const context: TParentContextModel = {
    agentsMd: dto.agentsMd,
    projectNotesMd: dto.projectNotesMd,
  };
  if (dto.memoryMd !== undefined) context.memoryMd = dto.memoryMd;
  if (dto.taskContext !== undefined) context.taskContext = dto.taskContext;
  if (dto.compactInstructions !== undefined) context.compactInstructions = dto.compactInstructions;
  if (dto.agentsFileEntries !== undefined) {
    context.agentsFileEntries = dto.agentsFileEntries.map((entry) => ({ ...entry }));
  }
  if (dto.projectNotesFileEntries !== undefined) {
    context.projectNotesFileEntries = dto.projectNotesFileEntries.map((entry) => ({ ...entry }));
  }
  return context;
}
