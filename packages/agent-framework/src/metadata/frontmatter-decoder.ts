import type { TModelEffort } from '@robota-sdk/agent-core';
import type {
  IDecodedAgentFrontmatter,
  IDecodedSkillFrontmatter,
  IFrontmatterDecodeOptions,
  IFrontmatterDiagnostic,
  TFrontmatterDecodeResult,
  TFrontmatterDiagnosticCode,
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
const EFFORTS = new Set<TModelEffort>(['low', 'medium', 'high', 'xhigh', 'max']);

type TFieldMap = Record<string, string>;
type TFieldLines = Record<string, number>;
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
      diagnostic(options, 'missing-opening-marker', 'Frontmatter must begin with ---'),
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
      diagnostic(
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
        diagnostic(
          options,
          'malformed-line',
          'Frontmatter lines must contain key: value',
          index + 1,
        ),
      );
      continue;
    }
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9-]*):\s*(.*)$/);
    if (!match) {
      diagnostics.push(
        diagnostic(
          options,
          'malformed-line',
          'Frontmatter line must contain key: value',
          index + 1,
        ),
      );
      continue;
    }
    const key = match[1]!;
    const rawValue = match[2]!.trim();
    if (!allowed.has(key)) {
      diagnostics.push(
        diagnostic(
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
        diagnostic(options, 'duplicate-key', `Duplicate frontmatter key: ${key}`, index + 1, key),
      );
      continue;
    }
    seen.add(key);
    fields[key] = rawValue;
    fieldLines[key] = index + 1;
    if (rawValue.length === 0) {
      diagnostics.push(
        diagnostic(options, 'empty-value', `Frontmatter value is empty: ${key}`, index + 1, key),
      );
    }
  }

  if (closingLine === 1) {
    diagnostics.push(diagnostic(options, 'empty-block', 'Frontmatter block must not be empty', 2));
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
        diagnostic(
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

function required(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  key: string,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): string | undefined {
  const value = fields[key];
  if (value === undefined || value.length === 0) {
    diagnostics.push(
      diagnostic(
        options,
        'missing-required-field',
        `Required frontmatter field is missing: ${key}`,
        fieldLines[key],
        key,
      ),
    );
    return undefined;
  }
  if (/[[\]{}]/.test(value)) {
    diagnostics.push(
      diagnostic(
        options,
        'wrong-value-shape',
        `${key} must be a scalar string`,
        fieldLines[key],
        key,
      ),
    );
    return undefined;
  }
  return value;
}

function scalarField(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  key: string,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): string | undefined {
  const value = fields[key];
  if (value === undefined) return undefined;
  if (/[[\]{}]/.test(value)) {
    diagnostics.push(
      diagnostic(
        options,
        'wrong-value-shape',
        `${key} must be a scalar string`,
        fieldLines[key],
        key,
      ),
    );
    return undefined;
  }
  return value;
}

function booleanField(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  key: string,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): boolean | undefined {
  const value = fields[key];
  if (value === undefined) return undefined;
  if (value !== 'true' && value !== 'false') {
    diagnostics.push(
      diagnostic(
        options,
        'invalid-boolean',
        `${key} must be exactly true or false`,
        fieldLines[key],
        key,
      ),
    );
    return undefined;
  }
  return value === 'true';
}

function listField(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  key: string,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): string[] | undefined {
  const value = fields[key];
  if (value === undefined) return undefined;
  if (/[[\]{}]/.test(value)) {
    diagnostics.push(
      diagnostic(
        options,
        'wrong-value-shape',
        `${key} must be a comma- or whitespace-separated list`,
        fieldLines[key],
        key,
      ),
    );
    return undefined;
  }
  const values = (value.includes(',') ? value.split(',') : value.split(/\s+/))
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0)
    diagnostics.push(
      diagnostic(
        options,
        'invalid-list',
        `${key} must contain at least one item`,
        fieldLines[key],
        key,
      ),
    );
  return values.length > 0 ? values : undefined;
}

function effortField(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): TModelEffort | undefined {
  const value = fields['effort'];
  if (value === undefined) return undefined;
  if (!EFFORTS.has(value as TModelEffort)) {
    diagnostics.push(
      diagnostic(
        options,
        'invalid-effort',
        'effort must be one of low, medium, high, xhigh, max',
        fieldLines.effort,
        'effort',
      ),
    );
    return undefined;
  }
  return value as TModelEffort;
}

function enumField<T extends string>(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  key: string,
  values: readonly T[],
  code: TFrontmatterDiagnosticCode,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): T | undefined {
  const value = fields[key];
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) {
    diagnostics.push(
      diagnostic(options, code, `${key} must be one of ${values.join(', ')}`, fieldLines[key], key),
    );
    return undefined;
  }
  return value as T;
}

function diagnostic(
  options: IFrontmatterDecodeOptions,
  code: TFrontmatterDiagnosticCode,
  message: string,
  line?: number,
  field?: string,
): IFrontmatterDiagnostic {
  return {
    code,
    source: options.source,
    ...(line === undefined ? {} : { line }),
    ...(field === undefined ? {} : { field }),
    message,
  };
}

function invalid(diagnostics: readonly IFrontmatterDiagnostic[]): TFrontmatterDecodeResult {
  return { status: 'invalid', diagnostics };
}
