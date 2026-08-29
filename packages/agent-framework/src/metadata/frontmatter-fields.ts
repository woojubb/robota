import type { TModelEffort } from '@robota-sdk/agent-core';
import type {
  IFrontmatterDecodeOptions,
  IFrontmatterDiagnostic,
  TFrontmatterDiagnosticCode,
} from '@robota-sdk/agent-interface-command';

export type TFieldMap = Record<string, string>;
export type TFieldLines = Record<string, number>;

const EFFORTS = new Set<TModelEffort>(['low', 'medium', 'high', 'xhigh', 'max']);

export function required(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  key: string,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): string | undefined {
  const value = fields[key];
  if (value === undefined || value.length === 0) {
    diagnostics.push(
      makeDiagnostic(
        options,
        'missing-required-field',
        `Required frontmatter field is missing: ${key}`,
        fieldLines[key],
        key,
      ),
    );
    return undefined;
  }
  return scalarValue(value, key, fieldLines[key], options, diagnostics);
}

export function scalarField(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  key: string,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): string | undefined {
  const value = fields[key];
  return value === undefined
    ? undefined
    : scalarValue(value, key, fieldLines[key], options, diagnostics);
}

export function booleanField(
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
      makeDiagnostic(
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

export function listField(
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
      makeDiagnostic(
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
      makeDiagnostic(
        options,
        'invalid-list',
        `${key} must contain at least one item`,
        fieldLines[key],
        key,
      ),
    );
  return values.length > 0 ? values : undefined;
}

export function effortField(
  fields: TFieldMap,
  fieldLines: TFieldLines,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): TModelEffort | undefined {
  const value = fields.effort;
  if (value === undefined) return undefined;
  if (!EFFORTS.has(value as TModelEffort)) {
    diagnostics.push(
      makeDiagnostic(
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

export function enumField<T extends string>(
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
      makeDiagnostic(
        options,
        code,
        `${key} must be one of ${values.join(', ')}`,
        fieldLines[key],
        key,
      ),
    );
    return undefined;
  }
  return value as T;
}

function scalarValue(
  value: string,
  key: string,
  line: number | undefined,
  options: IFrontmatterDecodeOptions,
  diagnostics: IFrontmatterDiagnostic[],
): string | undefined {
  if (/[[\]{}]/.test(value)) {
    diagnostics.push(
      makeDiagnostic(options, 'wrong-value-shape', `${key} must be a scalar string`, line, key),
    );
    return undefined;
  }
  return value;
}

export function makeDiagnostic(
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
