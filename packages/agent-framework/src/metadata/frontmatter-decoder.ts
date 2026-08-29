import {
  booleanField,
  effortField,
  enumField,
  listField,
  makeDiagnostic,
  required,
  scalarField,
  type TFieldLines,
  type TFieldMap,
} from './frontmatter-fields.js';

import type {
  IDecodedAgentFrontmatter,
  IDecodedSkillFrontmatter,
  IFrontmatterDecodeOptions,
  IFrontmatterDiagnostic,
  TFrontmatterDecodeResult,
} from '@robota-sdk/agent-interface-command';

const SKILL_KEYS = new Set([
  'name',
  'description',
  'argument-hint',
  'disable-model-invocation',
  'user-invocable',
  'allowed-tools',
  'model',
  'effort',
  'context',
  'agent',
]);
const AGENT_KEYS = new Set([
  'name',
  'description',
  'model',
  'maxTurns',
  'tools',
  'disallowedTools',
]);
type TMutable<T> = { -readonly [K in keyof T]: T[K] };

export function decodeSkillAgentFrontmatter(
  content: string,
  options: IFrontmatterDecodeOptions,
): TFrontmatterDecodeResult {
  const lines = content.split('\n');
  const diagnostics: IFrontmatterDiagnostic[] = [];
  const fields: TFieldMap = {};
  const fieldLines: TFieldLines = {};
  const seen = new Set<string>();
  const allowed = options.kind === 'skill' ? SKILL_KEYS : AGENT_KEYS;

  if (lines[0]?.trim() !== '---') {
    diagnostics.push(
      makeDiagnostic(options, 'missing-opening-marker', 'Frontmatter must begin with ---'),
    );
    return invalid(diagnostics);
  }

  let closingLine = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      closingLine = index;
      break;
    }
  }
  if (closingLine === -1) {
    diagnostics.push(
      makeDiagnostic(
        options,
        'missing-closing-marker',
        'Frontmatter is missing its closing ---',
        lines.length,
      ),
    );
    return invalid(diagnostics);
  }

  for (let index = 1; index < closingLine; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      diagnostics.push(
        makeDiagnostic(
          options,
          'malformed-line',
          'Frontmatter lines must contain key: value',
          index + 1,
        ),
      );
      continue;
    }
    const separator = line.indexOf(':');
    const keyCandidate = separator < 1 ? '' : line.slice(0, separator);
    if (separator < 1 || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(keyCandidate)) {
      diagnostics.push(
        makeDiagnostic(
          options,
          'malformed-line',
          'Frontmatter line must contain key: value',
          index + 1,
        ),
      );
      continue;
    }
    const key = keyCandidate;
    const rawValue = line.slice(separator + 1).trim();
    if (!allowed.has(key)) {
      diagnostics.push(
        makeDiagnostic(
          options,
          'unknown-key',
          `Unknown ${options.kind} frontmatter key: ${key}`,
          index + 1,
          key,
        ),
      );
      continue;
    }
    if (seen.has(key)) {
      diagnostics.push(
        makeDiagnostic(
          options,
          'duplicate-key',
          `Duplicate frontmatter key: ${key}`,
          index + 1,
          key,
        ),
      );
      continue;
    }
    seen.add(key);
    fields[key] = rawValue;
    fieldLines[key] = index + 1;
    if (rawValue.length === 0) {
      diagnostics.push(
        makeDiagnostic(
          options,
          'empty-value',
          `Frontmatter value is empty: ${key}`,
          index + 1,
          key,
        ),
      );
    }
  }

  if (closingLine === 1) {
    diagnostics.push(
      makeDiagnostic(options, 'empty-block', 'Frontmatter block must not be empty', 2),
    );
    return invalid(diagnostics);
  }
  const value =
    options.kind === 'skill'
      ? decodeSkill(fields, fieldLines, options, diagnostics)
      : decodeAgent(fields, fieldLines, options, diagnostics);
  return diagnostics.length > 0 || value === undefined
    ? invalid(diagnostics)
    : { status: 'valid', value };
}

function decodeSkill(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): IDecodedSkillFrontmatter | undefined {
  const name = required(fields, fieldLines, 'name', options, diagnostics);
  const description = required(fields, fieldLines, 'description', options, diagnostics);
  const result: TMutable<IDecodedSkillFrontmatter> = {
    kind: 'skill',
    name: name ?? '',
    description: description ?? '',
  };
  const argumentHint = scalarField(fields, fieldLines, 'argument-hint', options, diagnostics);
  if (argumentHint !== undefined) result.argumentHint = argumentHint;
  const model = scalarField(fields, fieldLines, 'model', options, diagnostics);
  if (model !== undefined) result.model = model;
  const agent = scalarField(fields, fieldLines, 'agent', options, diagnostics);
  if (agent !== undefined) result.agent = agent;
  const disableModelInvocation = booleanField(
    fields,
    fieldLines,
    'disable-model-invocation',
    options,
    diagnostics,
  );
  if (disableModelInvocation !== undefined) result.disableModelInvocation = disableModelInvocation;
  const userInvocable = booleanField(fields, fieldLines, 'user-invocable', options, diagnostics);
  if (userInvocable !== undefined) result.userInvocable = userInvocable;
  const allowedTools = listField(fields, fieldLines, 'allowed-tools', options, diagnostics);
  if (allowedTools) result.allowedTools = allowedTools;
  const effort = effortField(fields, fieldLines, options, diagnostics);
  if (effort) result.effort = effort;
  const context = enumField(
    fields,
    fieldLines,
    'context',
    ['inject', 'fork'] as const,
    'invalid-context',
    options,
    diagnostics,
  );
  if (context) result.context = context;
  return diagnostics.length === 0 ? result : undefined;
}

function decodeAgent(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): IDecodedAgentFrontmatter | undefined {
  const name = required(fields, fieldLines, 'name', options, diagnostics);
  const description = required(fields, fieldLines, 'description', options, diagnostics);
  const result: TMutable<IDecodedAgentFrontmatter> = {
    kind: 'agent',
    name: name ?? '',
    description: description ?? '',
  };
  const model = scalarField(fields, fieldLines, 'model', options, diagnostics);
  if (model !== undefined) result.model = model;
  const maxTurns = fields['maxTurns'];
  if (maxTurns !== undefined) {
    if (!/^[1-9]\d*$/.test(maxTurns) || !Number.isSafeInteger(Number(maxTurns))) {
      diagnostics.push(
        makeDiagnostic(
          options,
          'invalid-positive-integer',
          'maxTurns must be a safe positive integer',
          fieldLines.maxTurns,
          'maxTurns',
        ),
      );
    } else result.maxTurns = Number(maxTurns);
  }
  const tools = listField(fields, fieldLines, 'tools', options, diagnostics);
  if (tools) result.tools = tools;
  const disallowedTools = listField(fields, fieldLines, 'disallowedTools', options, diagnostics);
  if (disallowedTools) result.disallowedTools = disallowedTools;
  return diagnostics.length === 0 ? result : undefined;
}

function invalid(diagnostics: readonly IFrontmatterDiagnostic[]): TFrontmatterDecodeResult {
  return { status: 'invalid', diagnostics };
}
